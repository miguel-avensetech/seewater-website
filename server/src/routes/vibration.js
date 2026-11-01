import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { parse, z } from '../lib/validate.js';
import { requireRole } from '../middleware/auth.js';
import { logDevice, logSystem } from '../services/activity.js';
import { loadLookups } from '../services/lookups.js';
import { getSettings } from '../services/settings.js';
import { vibrationLimit } from '../services/thresholds.js';

const router = Router();

async function vibrationSensor(id) {
  const sensor = await db.get(C.sensors, id);
  if (!sensor || sensor.sensorType !== 'vibration') throw notFound('Vibration sensor');
  return sensor;
}

router.get(
  '/baselines',
  asyncHandler(async (_req, res) => {
    const [sensors, baselines, lk] = await Promise.all([
      db.list(C.sensors, { where: [['sensorType', '==', 'vibration']] }),
      db.list(C.vibrationBaselines),
      loadLookups(),
    ]);
    const byId = new Map(baselines.map((b) => [b.id, b]));
    const items = sensors.map((s) => {
      const baseline = byId.get(s.id) ?? null;
      return {
        sensorId: s.id,
        sensorLocation: s.sensorLocation,
        deviceId: s.deviceId,
        deviceName: lk.deviceName(s.deviceId),
        isSimulated: Boolean(lk.deviceById.get(s.deviceId)?.isSimulated),
        ...lk.describeHouse(s.houseId),
        lastVibrationLevel: s.lastVibrationLevel ?? null,
        lastReadingAt: s.lastReadingAt ?? null,
        baseline,
        limit: vibrationLimit(baseline),
      };
    });
    res.json({ items, summary: { total: items.length, configured: items.filter((i) => i.baseline).length } });
  }),
);

router.get(
  '/sensors/:id',
  asyncHandler(async (req, res) => {
    const sensor = await vibrationSensor(req.params.id);
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const [baseline, history, readings, lk, admins] = await Promise.all([
      db.get(C.vibrationBaselines, sensor.id),
      db.list(C.vibrationBaselineHistory, { where: [['sensorId', '==', sensor.id]] }),
      db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]], orderBy: ['recordedAt', 'asc'] }),
      loadLookups(),
      db.list(C.admins),
    ]);
    const adminName = new Map(admins.map((a) => [a.id, a.fullName]));
    const own = readings.filter((r) => r.sensorId === sensor.id && r.vibrationLevel != null);
    res.json({
      sensor: { ...sensor, deviceName: lk.deviceName(sensor.deviceId), ...lk.describeHouse(sensor.houseId) },
      baseline,
      limit: vibrationLimit(baseline),
      history: history
        .map((h) => ({ ...h, recordedByName: adminName.get(h.recordedBy) ?? 'Unknown' }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      readings: own.map((r) => ({ recordedAt: r.recordedAt, vibrationLevel: r.vibrationLevel, source: r.source })),
      sources: [...new Set(own.map((r) => r.source))],
    });
  }),
);

const measureSchema = z.object({ minutes: z.coerce.number().int().min(5).max(1440).default(60) });

/**
 * Records a background vibration measurement from stored readings.
 * Samples taken while water was flowing are excluded, so the baseline reflects
 * environmental vibration only (traffic, machinery, appliances). Nothing is
 * saved until the admin applies the proposed values.
 */
router.post(
  '/sensors/:id/measure',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await vibrationSensor(req.params.id);
    const { minutes } = parse(measureSchema, req.body);
    const settings = await getSettings();
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const readings = (await db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]] })).filter((r) => r.deviceId === sensor.deviceId);

    const flowAt = readings.filter((r) => r.readingType === 'flow' && r.flowRate != null).map((r) => [Date.parse(r.recordedAt), r.flowRate]);
    const flowingNear = (t) => flowAt.some(([ft, f]) => Math.abs(ft - t) <= 60000 && f >= settings.leakMinFlowLpm);
    const vib = readings.filter((r) => r.sensorId === sensor.id && r.vibrationLevel != null);
    const quiet = vib.filter((r) => !flowingNear(Date.parse(r.recordedAt)));
    const values = quiet.map((r) => r.vibrationLevel).sort((a, b) => a - b);

    if (values.length < 5) {
      throw badRequest(`Not enough no-flow vibration readings in the last ${minutes} minutes (found ${values.length}, need at least 5). Make sure the device is online and no water is running, then try again.`);
    }

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
    const round = (v) => Math.round(v * 10) / 10;

    res.json({
      sensorId: sensor.id,
      windowMinutes: minutes,
      samples: values.length,
      excludedWhileFlowing: vib.length - quiet.length,
      sources: [...new Set(quiet.map((r) => r.source))],
      stats: { mean: round(mean), stdDev: round(std), min: values[0], max: values.at(-1), p95 },
      proposed: { baselineValue: round(mean), acceptableRange: round(Math.max(3 * std, p95 - mean, 1)) },
    });
  }),
);

const baselineSchema = z.object({
  baselineValue: z.coerce.number().min(0, 'Must be 0 or more').max(1023, 'Sensor range is 0–1023'),
  acceptableRange: z.coerce.number().positive('Must be greater than 0').max(1023),
  detectionThreshold: z.coerce.number().positive().max(1023).nullable().optional().default(null),
  environment: z.enum(['quiet', 'moderate', 'high_traffic']),
  remarks: z.string().trim().max(500).optional().default(''),
  measurement: z
    .object({ samples: z.number().int(), windowMinutes: z.number().int(), mean: z.number(), stdDev: z.number(), max: z.number() })
    .nullable()
    .optional()
    .default(null),
});

router.put(
  '/sensors/:id/baseline',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await vibrationSensor(req.params.id);
    const data = parse(baselineSchema, req.body);
    if (data.detectionThreshold != null && data.detectionThreshold <= data.baselineValue) {
      throw badRequest('Please correct the highlighted fields.', { fields: { detectionThreshold: 'Must be above the baseline value' } });
    }
    const previous = await db.get(C.vibrationBaselines, sensor.id);
    const at = nowIso();
    const { remarks, measurement, ...values } = data;

    const baseline = await db.set(C.vibrationBaselines, sensor.id, {
      sensorId: sensor.id,
      deviceId: sensor.deviceId,
      ...values,
      recordedBy: req.admin.id,
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
    });
    await db.create(C.vibrationBaselineHistory, {
      sensorId: sensor.id,
      deviceId: sensor.deviceId,
      previous: previous ? { baselineValue: previous.baselineValue, acceptableRange: previous.acceptableRange, detectionThreshold: previous.detectionThreshold ?? null } : null,
      ...values,
      measurement,
      remarks,
      recordedBy: req.admin.id,
      createdAt: at,
    });
    await db.create(C.calibrations, {
      sensorId: sensor.id,
      deviceId: sensor.deviceId,
      calibrationType: 'vibration_baseline',
      oldValue: previous?.baselineValue ?? null,
      newValue: values.baselineValue,
      performedBy: req.admin.id,
      calibrationDate: at,
      remarks,
    });
    await db.update(C.sensors, sensor.id, { lastCalibratedAt: at, calibrationStatus: 'calibrated' });
    await logDevice({ deviceId: sensor.deviceId, eventType: 'baseline_updated', description: `Vibration baseline ${previous?.baselineValue ?? '—'} → ${values.baselineValue} (±${values.acceptableRange})`, status: 'success', source: 'system' });
    await logSystem({ category: 'sensor_event', action: 'vibration_baseline_updated', description: `Vibration baseline updated for sensor at ${sensor.sensorLocation}`, status: 'success', actor: req.admin, deviceId: sensor.deviceId, houseId: sensor.houseId });
    res.json({ baseline, limit: vibrationLimit(baseline) });
  }),
);

export default router;
