import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logDevice, logSystem } from '../services/activity.js';
import { withStatus } from '../services/deviceStatus.js';
import { loadLookups } from '../services/lookups.js';
import { getSettings } from '../services/settings.js';
import { getThresholdProfile, getVibrationBaseline } from '../services/thresholds.js';
import { activeCodesByDevice, issueActivationCode, revokeCodesForDevice } from '../services/activationCodes.js';

const codeFields = (c) => ({ activationCode: c?.code ?? null, activationCodeExpiresAt: c?.expiresAt ?? null, activationCodeUse: c ? { hardware: Boolean(c.hardwareActivatedAt), homeowner: Boolean(c.homeownerLinkedAt) } : null });

const router = Router();

const mac = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/, 'Use the format AA:BB:CC:DD:EE:FF')
  .or(z.literal(''))
  .optional()
  .default('');

const sensorSchema = z.object({
  sensorType: z.enum(['flow', 'vibration']),
  sensorLocation: trimmed(2, 100),
  model: z.string().trim().max(50).optional().default(''),
});

const deviceSchema = z.object({
  deviceName: trimmed(2, 100),
  deviceType: z.enum(['esp32_gateway', 'esp32_sensor_node']).default('esp32_gateway'),
  macAddress: mac,
  firmwareVersion: z.string().trim().max(50).optional().default(''),
  houseId: z.string().trim().optional().nullable().default(null),
  notes: z.string().trim().max(500).optional().default(''),
});

const createSchema = deviceSchema.extend({
  sensors: z.array(sensorSchema).max(8).default([]),
  includeValve: z.boolean().default(true),
});

const listSchema = listQuery.extend({
  connection: z.enum(['online', 'offline', 'never_connected', 'not_activated']).optional(),
  activation: z.enum(['pending', 'activated', 'deactivated']).optional(),
  houseId: z.string().optional(),
});

async function assertHouse(houseId) {
  if (!houseId) return null;
  const house = await db.get(C.houses, houseId);
  if (!house) throw badRequest('Please correct the highlighted fields.', { fields: { houseId: 'Household not found' } });
  return house;
}

async function assertMacFree(macAddress, exceptId) {
  if (!macAddress) return;
  const [clash] = await db.list(C.devices, { where: [['macAddress', '==', macAddress]], limit: 1 });
  if (clash && clash.id !== exceptId) {
    throw badRequest('Please correct the highlighted fields.', { fields: { macAddress: 'Another device already uses this MAC address' } });
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const [lk, sensors, valves, codes] = await Promise.all([loadLookups(), db.list(C.sensors), db.list(C.valves), activeCodesByDevice()]);
    const sensorCount = new Map();
    for (const s of sensors) sensorCount.set(s.deviceId, (sensorCount.get(s.deviceId) || 0) + 1);
    const valveByDevice = new Map(valves.map((v) => [v.deviceId, v]));

    let rows = lk.devices.map((d) => ({
      ...d,
      ...lk.describeHouse(d.houseId),
      ...codeFields(codes.get(d.id)),
      sensorCount: sensorCount.get(d.id) || 0,
      valveStatus: valveByDevice.get(d.id)?.status ?? null,
    }));
    if (q.connection) rows = rows.filter((r) => r.connectionStatus === q.connection);
    if (q.activation) rows = rows.filter((r) => r.activationStatus === q.activation);
    if (q.houseId) rows = rows.filter((r) => r.houseId === q.houseId);

    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'registeredAt',
        searchFields: ['deviceName', 'macAddress', 'activationCode', 'houseName', 'ownerName', 'firmwareVersion'],
        allowedSorts: ['deviceName', 'registeredAt', 'lastOnline', 'connectionStatus', 'houseName'],
      }),
      summary: {
        total: lk.devices.length,
        online: lk.devices.filter((d) => d.connectionStatus === 'online').length,
        offline: lk.devices.filter((d) => d.connectionStatus === 'offline').length,
        pending: lk.devices.filter((d) => d.activationStatus === 'pending').length,
      },
    });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = parse(createSchema, req.body);
    const house = await assertHouse(data.houseId);
    await assertMacFree(data.macAddress);
    const { sensors, includeValve, ...fields } = data;

    const device = await db.create(C.devices, {
      ...fields,
      houseId: house?.id ?? null,
      activationStatus: 'pending',
      connectionStatus: 'not_activated',
      lastOnline: null,
      isSimulated: false,
      registeredBy: req.admin.id,
      registeredAt: nowIso(),
    });

    for (const s of sensors) {
      await db.create(C.sensors, { ...s, deviceId: device.id, houseId: device.houseId, status: 'active', calibrationStatus: 'not_calibrated', sensitivity: 1, calibrationFactor: s.sensorType === 'flow' ? 7.5 : 1, installedAt: nowIso() });
    }
    if (includeValve) {
      await db.create(C.valves, { deviceId: device.id, houseId: device.houseId, status: 'unknown', commandStatus: 'none', controlType: 'manual', lastUpdated: nowIso() });
    }

    const code = await issueActivationCode(device.id, req.admin);
    await logDevice({ deviceId: device.id, eventType: 'registered', description: `Registered by ${req.admin.fullName}`, status: 'info', source: 'system' });
    await logSystem({ category: 'admin_action', action: 'device_registered', description: `Registered ${device.deviceName}`, status: 'success', actor: req.admin, deviceId: device.id, houseId: device.houseId });
    res.status(201).json({ ...withStatus(device), ...codeFields(code) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const device = await db.get(C.devices, req.params.id);
    if (!device) throw notFound('Device');
    const [sensors, valves, logs, history, settings, lk, codes] = await Promise.all([
      db.list(C.sensors, { where: [['deviceId', '==', device.id]] }),
      db.list(C.valves, { where: [['deviceId', '==', device.id]] }),
      db.list(C.deviceLogs, { where: [['deviceId', '==', device.id]] }),
      db.list(C.deviceStatusHistory, { where: [['deviceId', '==', device.id]] }),
      getSettings(),
      loadLookups(),
      activeCodesByDevice(),
    ]);
    const enriched = await Promise.all(
      sensors.map(async (s) => ({ ...s, threshold: await getThresholdProfile(s, settings), baseline: s.sensorType === 'vibration' ? await getVibrationBaseline(s.id) : null })),
    );
    const registeredBy = device.registeredBy ? await db.get(C.admins, device.registeredBy) : null;
    const linkedUser = device.linkedUserId ? lk.userById.get(device.linkedUserId) : null;
    res.json({
      device: { ...withStatus(device), ...lk.describeHouse(device.houseId), registeredByName: registeredBy?.fullName ?? null, linkedUserName: linkedUser?.fullName ?? null, linkedUserEmail: linkedUser?.email ?? null, ...codeFields(codes.get(device.id)) },
      sensors: enriched,
      valve: valves[0] ?? null,
      logs: logs.sort((a, b) => b.loggedAt.localeCompare(a.loggedAt)).slice(0, 25),
      statusHistory: history.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 50),
    });
  }),
);

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const device = await db.get(C.devices, req.params.id);
    if (!device) throw notFound('Device');
    const data = parse(deviceSchema, req.body);
    const house = await assertHouse(data.houseId);
    await assertMacFree(data.macAddress, device.id);
    // Reassigning to another homeowner's household removes the previous app link.
    const keepLink = device.linkedUserId && house?.userId === device.linkedUserId;
    const updated = await db.update(C.devices, device.id, { ...data, houseId: house?.id ?? null, updatedAt: nowIso(), ...(!keepLink && { linkedUserId: null, linkedAt: null }) });

    if ((house?.id ?? null) !== (device.houseId ?? null)) {
      for (const s of await db.list(C.sensors, { where: [['deviceId', '==', device.id]] })) await db.update(C.sensors, s.id, { houseId: house?.id ?? null });
      for (const v of await db.list(C.valves, { where: [['deviceId', '==', device.id]] })) await db.update(C.valves, v.id, { houseId: house?.id ?? null });
      await logDevice({ deviceId: device.id, eventType: 'household_assigned', description: house ? `Assigned to ${house.houseName}` : 'Unassigned from household', status: 'info', source: 'system' });
    }
    await logSystem({ category: 'admin_action', action: 'device_updated', description: `Updated ${updated.deviceName}`, status: 'info', actor: req.admin, deviceId: device.id });
    res.json(withStatus(updated));
  }),
);

// Issues a new activation code and revokes the current device credentials.
router.post(
  '/:id/activation-code',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const device = await db.get(C.devices, req.params.id);
    if (!device) throw notFound('Device');
    if (device.isSimulated) throw conflict('Simulated test devices keep their seeded credentials.');
    const code = await issueActivationCode(device.id, req.admin);
    const updated = await db.update(C.devices, device.id, {
      activationStatus: 'pending',
      connectionStatus: 'not_activated',
      deviceKeyHash: null,
      activatedAt: null,
    });
    await logDevice({ deviceId: device.id, eventType: 'activation_reset', description: `New activation code issued by ${req.admin.fullName}; previous credentials revoked`, status: 'warning', source: 'system' });
    await logSystem({ category: 'admin_action', action: 'activation_code_regenerated', description: `New activation code for ${device.deviceName}`, status: 'warning', actor: req.admin, deviceId: device.id });
    res.json({ ...withStatus(updated), ...codeFields(code) });
  }),
);

router.post(
  '/:id/deactivate',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const device = await db.get(C.devices, req.params.id);
    if (!device) throw notFound('Device');
    const updated = await db.update(C.devices, device.id, { activationStatus: 'deactivated', connectionStatus: 'not_activated', deviceKeyHash: null });
    await revokeCodesForDevice(device.id, 'deactivated');
    await logDevice({ deviceId: device.id, eventType: 'deactivated', description: `Deactivated by ${req.admin.fullName}`, status: 'warning', source: 'system' });
    await logSystem({ category: 'admin_action', action: 'device_deactivated', description: `Deactivated ${device.deviceName}`, status: 'warning', actor: req.admin, deviceId: device.id });
    res.json(withStatus(updated));
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const device = await db.get(C.devices, req.params.id);
    if (!device) throw notFound('Device');
    const [sensors, valves] = await Promise.all([
      db.list(C.sensors, { where: [['deviceId', '==', device.id]] }),
      db.list(C.valves, { where: [['deviceId', '==', device.id]] }),
    ]);
    for (const s of sensors) {
      await db.remove(C.sensors, s.id);
      await db.remove(C.thresholdProfiles, s.id);
      await db.remove(C.vibrationBaselines, s.id);
    }
    for (const v of valves) await db.remove(C.valves, v.id);
    await revokeCodesForDevice(device.id, 'device_removed');
    await db.remove(C.devices, device.id);
    // Readings, logs and calibration history are retained for the audit trail.
    await logSystem({ category: 'admin_action', action: 'device_removed', description: `Removed ${device.deviceName} (history retained)`, status: 'warning', actor: req.admin, deviceId: device.id });
    res.status(204).end();
  }),
);

router.post(
  '/:id/sensors',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const device = await db.get(C.devices, req.params.id);
    if (!device) throw notFound('Device');
    const data = parse(sensorSchema, req.body);
    const sensor = await db.create(C.sensors, { ...data, deviceId: device.id, houseId: device.houseId, status: 'active', calibrationStatus: 'not_calibrated', sensitivity: 1, calibrationFactor: data.sensorType === 'flow' ? 7.5 : 1, installedAt: nowIso() });
    await logDevice({ deviceId: device.id, eventType: 'sensor_added', description: `${data.sensorType} sensor added at ${data.sensorLocation}`, status: 'info', source: 'system' });
    res.status(201).json(sensor);
  }),
);

export const sensorsRouter = Router();

const sensorUpdateSchema = sensorSchema.omit({ sensorType: true }).extend({ status: z.enum(['active', 'inactive', 'faulty']) });

sensorsRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await db.get(C.sensors, req.params.id);
    if (!sensor) throw notFound('Sensor');
    const data = parse(sensorUpdateSchema, req.body);
    const updated = await db.update(C.sensors, sensor.id, data);
    if (data.status !== sensor.status) {
      await logDevice({ deviceId: sensor.deviceId, eventType: 'sensor_status', description: `${sensor.sensorType} sensor at ${data.sensorLocation} marked ${data.status}`, status: data.status === 'active' ? 'info' : 'warning', source: 'system' });
    }
    res.json(updated);
  }),
);

sensorsRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const sensor = await db.get(C.sensors, req.params.id);
    if (!sensor) throw notFound('Sensor');
    await db.remove(C.sensors, sensor.id);
    await db.remove(C.thresholdProfiles, sensor.id);
    await db.remove(C.vibrationBaselines, sensor.id);
    await logDevice({ deviceId: sensor.deviceId, eventType: 'sensor_removed', description: `${sensor.sensorType} sensor at ${sensor.sensorLocation} removed`, status: 'warning', source: 'system' });
    res.status(204).end();
  }),
);

export default router;
