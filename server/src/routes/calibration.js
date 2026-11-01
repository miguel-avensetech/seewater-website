import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { listQuery, parse, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logDevice, logSystem } from '../services/activity.js';
import { loadLookups } from '../services/lookups.js';
import { getSettings } from '../services/settings.js';
import { getThresholdProfile } from '../services/thresholds.js';

const router = Router();

// Sensors are due for recalibration after this many days.
export const CALIBRATION_INTERVAL_DAYS = 180;

export function calibrationStatus(sensor) {
  if (!sensor.lastCalibratedAt) return 'not_calibrated';
  const ageDays = (Date.now() - Date.parse(sensor.lastCalibratedAt)) / 86400000;
  return ageDays > CALIBRATION_INTERVAL_DAYS ? 'due' : 'calibrated';
}

const listSchema = listQuery.extend({
  type: z.enum(['flow', 'vibration']).optional(),
  calibration: z.enum(['calibrated', 'not_calibrated', 'due']).optional(),
});

router.get(
  '/sensors',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const [sensors, lk, settings] = await Promise.all([db.list(C.sensors), loadLookups(), getSettings()]);
    let rows = await Promise.all(
      sensors.map(async (s) => ({
        ...s,
        ...lk.describeHouse(s.houseId),
        deviceName: lk.deviceName(s.deviceId),
        calibrationStatus: calibrationStatus(s),
        threshold: await getThresholdProfile(s, settings),
      })),
    );
    if (q.type) rows = rows.filter((r) => r.sensorType === q.type);
    if (q.calibration) rows = rows.filter((r) => r.calibrationStatus === q.calibration);
    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'deviceName',
        order: q.order || 'asc',
        searchFields: ['deviceName', 'sensorLocation', 'houseName', 'ownerName', 'model'],
        allowedSorts: ['deviceName', 'sensorLocation', 'lastCalibratedAt', 'sensorType', 'houseName'],
      }),
      summary: {
        total: rows.length,
        calibrated: rows.filter((r) => r.calibrationStatus === 'calibrated').length,
        due: rows.filter((r) => r.calibrationStatus === 'due').length,
        notCalibrated: rows.filter((r) => r.calibrationStatus === 'not_calibrated').length,
        intervalDays: CALIBRATION_INTERVAL_DAYS,
      },
    });
  }),
);

router.get(
  '/sensors/:id',
  asyncHandler(async (req, res) => {
    const sensor = await db.get(C.sensors, req.params.id);
    if (!sensor) throw notFound('Sensor');
    const [history, settings, lk, admins] = await Promise.all([
      db.list(C.calibrations, { where: [['sensorId', '==', sensor.id]] }),
      getSettings(),
      loadLookups(),
      db.list(C.admins),
    ]);
    const adminName = new Map(admins.map((a) => [a.id, a.fullName]));
    res.json({
      sensor: { ...sensor, ...lk.describeHouse(sensor.houseId), deviceName: lk.deviceName(sensor.deviceId), calibrationStatus: calibrationStatus(sensor) },
      threshold: await getThresholdProfile(sensor, settings),
      history: history
        .map((h) => ({ ...h, performedByName: adminName.get(h.performedBy) ?? 'Unknown' }))
        .sort((a, b) => b.calibrationDate.localeCompare(a.calibrationDate)),
    });
  }),
);

// One CALIBRATION record per changed parameter (manuscript Table 19: old/new value).
async function recordChanges({ sensor, changes, admin, remarks, at, what }) {
  for (const [calibrationType, [oldValue, newValue]] of changes.length ? changes : [['verification', [null, null]]]) {
    await db.create(C.calibrations, { sensorId: sensor.id, deviceId: sensor.deviceId, calibrationType, oldValue: oldValue ?? null, newValue: newValue ?? null, performedBy: admin.id, calibrationDate: at, remarks });
  }
  const summary = changes.map(([k, [o, n]]) => `${k} ${o ?? '—'} → ${n ?? '—'}`).join(', ') || 'values verified';
  await logDevice({ deviceId: sensor.deviceId, eventType: what === 'threshold' ? 'threshold_updated' : 'sensor_calibrated', description: `${sensor.sensorType} sensor at ${sensor.sensorLocation}: ${summary}`, status: 'success', source: 'system' });
  await logSystem({ category: 'sensor_event', action: what === 'threshold' ? 'threshold_profile_updated' : 'sensor_calibrated', description: `${what === 'threshold' ? 'Updated threshold profile of' : 'Calibrated'} ${sensor.sensorType} sensor at ${sensor.sensorLocation}`, status: 'success', actor: admin, deviceId: sensor.deviceId, houseId: sensor.houseId });
}

// ── Piezo / flow calibration: sensor sensitivity and calibration factor ──────
const calibrateSchema = z.object({
  sensitivity: z.coerce.number().min(0.1, 'Minimum 0.1').max(10, 'Maximum 10'),
  calibrationFactor: z.coerce.number().positive('Must be greater than 0').max(1000),
  remarks: z.string().trim().max(500).optional().default(''),
});

router.post(
  '/sensors/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await db.get(C.sensors, req.params.id);
    if (!sensor) throw notFound('Sensor');
    const data = parse(calibrateSchema, req.body);
    const at = nowIso();
    const changes = Object.entries({
      sensitivity: [sensor.sensitivity, data.sensitivity],
      calibrationFactor: [sensor.calibrationFactor, data.calibrationFactor],
    }).filter(([, [oldV, newV]]) => oldV !== newV);
    if (!changes.length && sensor.lastCalibratedAt) throw badRequest('No calibration values were changed.');

    const updated = await db.update(C.sensors, sensor.id, { sensitivity: data.sensitivity, calibrationFactor: data.calibrationFactor, lastCalibratedAt: at, calibrationStatus: 'calibrated' });
    await recordChanges({ sensor, changes, admin: req.admin, remarks: data.remarks, at, what: 'calibration' });
    res.json({ sensor: { ...updated, calibrationStatus: 'calibrated' }, changes: changes.length });
  }),
);

// ── Threshold profiles: operating range and warning / critical levels ────────
const thresholdListSchema = listQuery.extend({
  type: z.enum(['flow', 'vibration']).optional(),
  profile: z.enum(['custom', 'default', 'none']).optional(),
});

router.get(
  '/thresholds',
  asyncHandler(async (req, res) => {
    const q = parse(thresholdListSchema, req.query);
    const [sensors, lk, settings] = await Promise.all([db.list(C.sensors), loadLookups(), getSettings()]);
    let rows = await Promise.all(
      sensors.map(async (s) => {
        const t = await getThresholdProfile(s, settings);
        return {
          id: s.id,
          sensorType: s.sensorType,
          sensorLocation: s.sensorLocation,
          deviceId: s.deviceId,
          deviceName: lk.deviceName(s.deviceId),
          ...lk.describeHouse(s.houseId),
          profile: !t ? 'none' : t.isDefault ? 'default' : 'custom',
          minValue: t?.minValue ?? null,
          maxValue: t?.maxValue ?? null,
          warningLevel: t?.warningLevel ?? null,
          criticalLevel: t?.criticalLevel ?? null,
          updatedAt: t && !t.isDefault ? t.updatedAt : null,
        };
      }),
    );
    if (q.type) rows = rows.filter((r) => r.sensorType === q.type);
    if (q.profile) rows = rows.filter((r) => r.profile === q.profile);
    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'deviceName',
        order: q.order || 'asc',
        searchFields: ['deviceName', 'sensorLocation', 'houseName', 'ownerName'],
        allowedSorts: ['deviceName', 'sensorLocation', 'houseName', 'warningLevel', 'criticalLevel', 'updatedAt'],
      }),
      summary: {
        total: rows.length,
        custom: rows.filter((r) => r.profile === 'custom').length,
        default: rows.filter((r) => r.profile === 'default').length,
        none: rows.filter((r) => r.profile === 'none').length,
        defaults: { warningLevel: settings.highFlowWarningLpm, criticalLevel: settings.highFlowCriticalLpm },
      },
    });
  }),
);

const thresholdSchema = z
  .object({
    minValue: z.coerce.number().min(0),
    maxValue: z.coerce.number().positive(),
    warningLevel: z.coerce.number().positive(),
    criticalLevel: z.coerce.number().positive(),
    remarks: z.string().trim().max(500).optional().default(''),
  })
  .superRefine((d, ctx) => {
    if (d.minValue >= d.warningLevel) ctx.addIssue({ code: 'custom', path: ['warningLevel'], message: 'Must be above the minimum value' });
    if (d.warningLevel >= d.criticalLevel) ctx.addIssue({ code: 'custom', path: ['criticalLevel'], message: 'Must be above the warning level' });
    if (d.criticalLevel > d.maxValue) ctx.addIssue({ code: 'custom', path: ['maxValue'], message: 'Must be at least the critical level' });
  });

const THRESHOLD_FIELDS = ['minValue', 'maxValue', 'warningLevel', 'criticalLevel'];

router.put(
  '/thresholds/:sensorId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await db.get(C.sensors, req.params.sensorId);
    if (!sensor) throw notFound('Sensor');
    const data = parse(thresholdSchema, req.body);
    const before = await getThresholdProfile(sensor, await getSettings());
    const changes = THRESHOLD_FIELDS.map((k) => [k, [before?.[k], data[k]]]).filter(([, [o, n]]) => o !== n);
    if (!changes.length && before && !before.isDefault) throw badRequest('No threshold values were changed.');
    const at = nowIso();
    const profile = await db.set(C.thresholdProfiles, sensor.id, {
      sensorId: sensor.id,
      ...Object.fromEntries(THRESHOLD_FIELDS.map((k) => [k, data[k]])),
      createdAt: before && !before.isDefault ? before.createdAt : at,
      updatedAt: at,
    });
    await recordChanges({ sensor, changes, admin: req.admin, remarks: data.remarks, at, what: 'threshold' });
    res.json({ profile, changes: changes.length });
  }),
);

// Removes a custom profile: flow sensors fall back to the system defaults
// (Settings), vibration sensors to none (leak detection uses the baseline).
router.delete(
  '/thresholds/:sensorId',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await db.get(C.sensors, req.params.sensorId);
    if (!sensor) throw notFound('Sensor');
    const existing = await db.get(C.thresholdProfiles, sensor.id);
    if (!existing) throw badRequest('This sensor has no custom threshold profile.');
    await db.remove(C.thresholdProfiles, sensor.id);
    const after = await getThresholdProfile(sensor, await getSettings());
    const changes = THRESHOLD_FIELDS.map((k) => [k, [existing[k], after?.[k]]]).filter(([, [o, n]]) => o !== n);
    await recordChanges({ sensor, changes, admin: req.admin, remarks: 'Reset to system default', at: nowIso(), what: 'threshold' });
    res.status(204).end();
  }),
);

export default router;
