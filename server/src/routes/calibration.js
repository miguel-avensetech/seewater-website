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
import { getThresholdProfile, vibrationLimit } from '../services/thresholds.js';
import { buildDeviceConfig } from '../services/deviceConfig.js';

const router = Router();

// Sensors are due for recalibration after this many days.
export const CALIBRATION_INTERVAL_DAYS = 180;

// With `device`, the status reflects the hardware: a sensor is only
// "calibrated" once its device has been detected (it has sent readings from
// that sensor) and has confirmed it applied the current calibration.
//   no_device       device never connected, or no readings from this sensor yet
//   awaiting_device calibrated here, but the device hasn't confirmed it
export function calibrationStatus(sensor, device, configSync) {
  if (device && (['never_connected', 'not_activated'].includes(device.connectionStatus) || !sensor.lastReadingAt)) return 'no_device';
  if (!sensor.lastCalibratedAt) return 'not_calibrated';
  if (device && configSync !== 'synced') return 'awaiting_device';
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

// ── Calibration cards: one per household device (Admin → Sensor Calibration) ─
// Bundles the piezo sensors (each with its vibration baseline), the main-line
// flow sensor (with its threshold profile), 24-hour reading
// stats used by the radar chart, and whether the device has applied the
// current calibration (see services/deviceConfig.js).
const STATS_HOURS = 24;

function readingStats(readings, field, current) {
  const values = readings.map((r) => r[field]).filter((v) => v != null);
  return {
    now: current ?? null,
    peak: values.length ? Math.max(...values) : null,
    average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null,
    samples: values.length,
  };
}

const sensorFields = (s, device, configSync) => ({
  sensorId: s.id,
  location: s.sensorLocation,
  model: s.model ?? '',
  sensitivity: s.sensitivity ?? 1,
  calibrationFactor: s.calibrationFactor ?? 1,
  calibrationStatus: calibrationStatus(s, device, configSync),
  lastCalibratedAt: s.lastCalibratedAt ?? null,
  lastReadingAt: s.lastReadingAt ?? null,
});

// Short reasons a household needs an administrator's attention (card badges).
function householdIssues({ device, piezos, flow, configSync }) {
  const issues = [];
  if (['never_connected', 'not_activated'].includes(device.connectionStatus)) issues.push('No device detected');
  else if ([...piezos, flow].some((x) => x?.calibrationStatus === 'no_device')) issues.push('No readings from some sensors');
  for (const p of piezos) if (p.stats.now != null && p.limit != null && p.stats.now > p.limit) issues.push(`Vibration above leak level (${p.location})`);
  if (flow?.stats.now != null && flow.threshold && flow.stats.now >= flow.threshold.warningLevel) issues.push('High water flow');
  for (const p of piezos) if (p.limit == null) issues.push(`No leak level set (${p.location})`);
  for (const [name, sensor] of [...piezos.map((p) => [`Piezo ${p.location}`, p]), ['Flow', flow]]) {
    if (sensor && ['not_calibrated', 'due'].includes(sensor.calibrationStatus)) issues.push(`${name} ${sensor.calibrationStatus === 'due' ? 'recalibration due' : 'not calibrated'}`);
  }
  if (configSync !== 'synced' && [...piezos, flow].some((x) => x?.calibrationStatus === 'awaiting_device')) issues.push('Calibration not yet applied on device');
  return issues;
}

const householdsQuery = listQuery.extend({ status: z.enum(['attention', 'ok']).optional() });

router.get(
  '/households',
  asyncHandler(async (req, res) => {
    const q = parse(householdsQuery, req.query);
    const since = new Date(Date.now() - STATS_HOURS * 3600000).toISOString();
    const [lk, sensors, baselines, readings, settings] = await Promise.all([
      loadLookups(),
      db.list(C.sensors),
      db.list(C.vibrationBaselines),
      db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]] }),
      getSettings(),
    ]);
    const sensorsByDevice = Map.groupBy(sensors, (s) => s.deviceId);
    const readingsBySensor = Map.groupBy(readings, (r) => r.sensorId);
    const baselineById = new Map(baselines.map((b) => [b.id, b]));

    const all = await Promise.all(
      lk.devices
        .filter((d) => d.houseId)
        .map(async (device) => {
          const own = sensorsByDevice.get(device.id) ?? [];
          const flow = own.find((s) => s.sensorType === 'flow');
          const profile = flow ? await getThresholdProfile(flow, settings) : null;
          const config = buildDeviceConfig(own);
          // synced: device reported this version · pending: it hasn't yet · never: no device has reported any version
          const configSync = device.appliedConfigVersion === config.version ? 'synced' : device.appliedConfigVersion ? 'pending' : 'never';
          const row = {
            id: device.id,
            houseId: device.houseId,
            ...lk.describeHouse(device.houseId),
            deviceName: device.deviceName,
            device: { id: device.id, deviceName: device.deviceName, connectionStatus: device.connectionStatus, isSimulated: Boolean(device.isSimulated) },
            piezos: own
              .filter((s) => s.sensorType === 'vibration')
              .sort((a, b) => (a.installedAt ?? '').localeCompare(b.installedAt ?? ''))
              .map((vib) => {
                const baseline = baselineById.get(vib.id) ?? null;
                return {
                  ...sensorFields(vib, device, configSync),
                  baseline: baseline && { baselineValue: baseline.baselineValue, acceptableRange: baseline.acceptableRange, detectionThreshold: baseline.detectionThreshold ?? null, environment: baseline.environment },
                  limit: vibrationLimit(baseline),
                  stats: readingStats(readingsBySensor.get(vib.id) ?? [], 'vibrationLevel', vib.lastVibrationLevel),
                };
              }),
            flow: flow && {
              ...sensorFields(flow, device, configSync),
              threshold: profile && { minValue: profile.minValue, maxValue: profile.maxValue, warningLevel: profile.warningLevel, criticalLevel: profile.criticalLevel, isDefault: Boolean(profile.isDefault) },
              stats: readingStats(readingsBySensor.get(flow.id) ?? [], 'flowRate', flow.lastFlowRate),
            },
            configSync,
            configAppliedAt: device.configAppliedAt ?? null,
          };
          return { ...row, issues: householdIssues(row) };
        }),
    );
    const rows = q.status ? all.filter((r) => (q.status === 'attention' ? r.issues.length > 0 : !r.issues.length)) : all;
    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'ownerName',
        order: q.order || 'asc',
        searchFields: ['ownerName', 'houseName', 'address', 'deviceName'],
        allowedSorts: ['ownerName', 'houseName', 'deviceName'],
      }),
      summary: {
        total: all.length,
        attention: all.filter((r) => r.issues.length).length,
        needsCalibration: all.filter((r) => [...r.piezos, r.flow].some((s) => s && s.calibrationStatus !== 'calibrated')).length,
        noLeakLevel: all.filter((r) => r.piezos.some((p) => p.limit == null)).length,
        statsHours: STATS_HOURS,
        intervalDays: CALIBRATION_INTERVAL_DAYS,
      },
    });
  }),
);

// ── Auto-calibration helpers for the flow sensor (nothing is saved) ─────────
async function flowSensor(id) {
  const sensor = await db.get(C.sensors, id);
  if (!sensor || sensor.sensorType !== 'flow') throw notFound('Flow sensor');
  return sensor;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const round1 = (v) => Math.round(v * 10) / 10;

// Suggests warning / critical levels from the household's normal peak flow:
// the 95th percentile of running-water readings over the last `days` days.
router.post(
  '/sensors/:id/suggest-levels',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await flowSensor(req.params.id);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(30).default(7) }), req.body ?? {});
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const values = (await db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]] }))
      .filter((r) => r.sensorId === sensor.id && r.flowRate > 0)
      .map((r) => r.flowRate)
      .sort((a, b) => a - b);
    if (values.length < 20) {
      throw badRequest(`Not enough running-water readings in the last ${days} days (found ${values.length}, need at least 20). Let the household use water normally for a while, then try again.`);
    }
    const p95 = percentile(values, 0.95);
    const warningLevel = Math.max(round1(p95 * 1.25), 1);
    res.json({ days, samples: values.length, stats: { p95, max: values.at(-1), median: percentile(values, 0.5) }, proposed: { warningLevel, criticalLevel: round1(warningLevel * 1.5) } });
  }),
);

// Bucket test: fill a container of known volume, then compare it with the
// liters the sensor counted over the same minutes. The pulses-per-L/min factor
// scales by counted / actual (the sensor over-counts when the factor is too low).
router.post(
  '/sensors/:id/flow-test',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await flowSensor(req.params.id);
    const { actualLiters, minutes } = parse(
      z.object({
        actualLiters: z.coerce.number().positive('Enter the liters you collected').max(1000),
        minutes: z.coerce.number().int().min(1).max(120).default(10),
      }),
      req.body,
    );
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const rows = (await db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]] })).filter((r) => r.sensorId === sensor.id && r.waterUsage != null);
    const countedLiters = round1(rows.reduce((t, r) => t + r.waterUsage, 0));
    if (!countedLiters) throw badRequest(`The sensor counted no water in the last ${minutes} minutes. Check that the device is online and run the test again.`);
    const current = sensor.calibrationFactor ?? 7.5;
    res.json({ minutes, readings: rows.length, actualLiters, countedLiters, errorPercent: round1(((countedLiters - actualLiters) / actualLiters) * 100), current, proposed: { calibrationFactor: Math.round(current * (countedLiters / actualLiters) * 100) / 100 } });
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
