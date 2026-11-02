// Endpoints called by the ESP32 gateway firmware (and the simulator script).
// Authentication: X-Device-Id / X-Device-Key headers, issued once at activation.

import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { parse, z } from '../lib/validate.js';
import { hashKey, requireDevice } from '../middleware/deviceAuth.js';
import { logDevice, logSystem } from '../services/activity.js';
import { ingestReadings, recordHeartbeat } from '../services/ingest.js';
import { acknowledgeValveCommand } from '../services/valves.js';
import { markCodeUsed, resolveActivationCode } from '../services/activationCodes.js';
import { deviceConfig } from '../services/deviceConfig.js';
import { activeFirmwareUpdate, setFirmwareStatus } from '../services/firmware.js';

const router = Router();

const activateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

const activateSchema = z.object({
  activationCode: z.string().trim().toUpperCase().regex(/^SW-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Invalid activation code format'),
  macAddress: z.string().trim().toUpperCase().regex(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/).optional(),
  firmwareVersion: z.string().trim().max(50).optional(),
});

router.post(
  '/activate',
  activateLimiter,
  asyncHandler(async (req, res) => {
    const data = parse(activateSchema, req.body);
    const { device, error } = await resolveActivationCode(data.activationCode, 'hardware');
    if (error || device.activationStatus !== 'pending') throw unauthorized(error === 'expired' ? 'Activation code has expired. Ask MCWD for a new one.' : 'Activation code is invalid or already used.');
    if (device.macAddress && data.macAddress && device.macAddress !== data.macAddress) {
      throw unauthorized('This code was issued for a different device.');
    }

    const deviceKey = crypto.randomBytes(32).toString('base64url');
    await db.update(C.devices, device.id, {
      activationStatus: 'activated',
      activatedAt: nowIso(),
      deviceKeyHash: hashKey(deviceKey),
      connectionStatus: 'never_connected',
      ...(data.macAddress && { macAddress: data.macAddress }),
      ...(data.firmwareVersion && { firmwareVersion: data.firmwareVersion }),
    });
    await markCodeUsed(data.activationCode, 'hardware');
    const [sensors, valves] = await Promise.all([
      db.list(C.sensors, { where: [['deviceId', '==', device.id]] }),
      db.list(C.valves, { where: [['deviceId', '==', device.id]] }),
    ]);
    await logDevice({ deviceId: device.id, eventType: 'activated', description: 'Device activated with activation code', status: 'success' });
    await logSystem({ category: 'connectivity', action: 'device_activated', description: `${device.deviceName} was activated`, status: 'success', deviceId: device.id, houseId: device.houseId });

    // The key is returned exactly once; only its hash is stored.
    res.status(201).json({
      deviceId: device.id,
      deviceKey,
      sensors: sensors.map((s) => ({ id: s.id, sensorType: s.sensorType, sensorLocation: s.sensorLocation, sensitivity: s.sensitivity, calibrationFactor: s.calibrationFactor })),
      valveId: valves[0]?.id ?? null,
    });
  }),
);

router.use(requireDevice);

const heartbeatSchema = z.object({
  firmwareVersion: z.string().trim().max(50).optional(),
  signalStrength: z.number().min(-120).max(0).optional(),
  batteryLevel: z.number().min(0).max(100).optional(),
  // config.version from GET /commands, once the device has applied it.
  configVersion: z.string().trim().max(40).optional(),
});

router.post(
  '/heartbeat',
  asyncHandler(async (req, res) => {
    await recordHeartbeat(req.device, parse(heartbeatSchema, req.body));
    res.json({ ok: true, serverTime: nowIso() });
  }),
);

const readingsSchema = z.object({
  readings: z
    .array(
      z.object({
        sensorId: z.string().min(1),
        flowRate: z.number().min(0).max(500).optional(), // L/min
        waterUsage: z.number().min(0).max(100000).optional(), // liters since previous reading
        vibrationLevel: z.number().min(0).max(1023).optional(),
        recordedAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1)
    .max(100),
});

router.post(
  '/readings',
  asyncHandler(async (req, res) => {
    const { readings } = parse(readingsSchema, req.body);
    const now = Date.now();
    for (const r of readings) {
      if (r.recordedAt && Date.parse(r.recordedAt) > now + 5 * 60000) throw badRequest('recordedAt is in the future — check the device clock.');
    }
    res.status(201).json(await ingestReadings(req.device, readings));
  }),
);

const logSchema = z.object({
  eventType: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(500),
  status: z.enum(['info', 'success', 'warning', 'error']).default('info'),
});

router.post(
  '/logs',
  asyncHandler(async (req, res) => {
    const data = parse(logSchema, req.body);
    const log = await logDevice({ deviceId: req.device.id, ...data, source: req.device.isSimulated ? 'simulated' : 'device' });
    res.status(201).json({ id: log.id });
  }),
);

router.get(
  '/commands',
  asyncHandler(async (req, res) => {
    const valves = await db.list(C.valves, { where: [['deviceId', '==', req.device.id]] });
    const commands = valves
      .filter((v) => v.commandStatus === 'pending')
      .map((v) => ({ type: 'valve', valveId: v.id, commandId: v.commandId, state: v.requestedState, requestedAt: v.requestedAt }));
    // Repeated until the job finishes, so a device that rebooted mid-update can resume.
    const fw = await activeFirmwareUpdate(req.device.id);
    if (fw) commands.push({ type: 'firmware', updateId: fw.id, version: fw.targetVersion, url: fw.url, sha256: fw.sha256, status: fw.status, requestedAt: fw.requestedAt });
    // Current sensor calibration; apply it when config.version differs from the
    // one the device last applied, then report that version in the heartbeat.
    res.json({ commands, config: await deviceConfig(req.device.id) });
  }),
);

const ackSchema = z.object({
  valveId: z.string().min(1),
  commandId: z.string().min(1),
  state: z.enum(['open', 'closed']),
  success: z.boolean(),
  message: z.string().max(300).optional(),
  // Only true when the hardware verified the valve position (e.g. a reed/limit switch).
  positionConfirmed: z.boolean().optional().default(false),
});

router.post(
  '/valve-ack',
  asyncHandler(async (req, res) => {
    const data = parse(ackSchema, req.body);
    const valve = await db.get(C.valves, data.valveId);
    if (!valve || valve.deviceId !== req.device.id) throw notFound('Valve');
    res.json(await acknowledgeValveCommand({ valve, ...data }));
  }),
);

const firmwareStatusSchema = z.object({
  updateId: z.string().min(1),
  status: z.enum(['downloading', 'installing', 'installed', 'failed']),
  message: z.string().trim().max(300).optional().default(''),
});

router.post(
  '/firmware-status',
  asyncHandler(async (req, res) => {
    const data = parse(firmwareStatusSchema, req.body);
    const job = await db.get(C.firmwareUpdates, data.updateId);
    if (!job || job.deviceId !== req.device.id) throw notFound('Firmware update');
    if (!['pending', 'downloading', 'installing'].includes(job.status)) throw badRequest(`This update is already ${job.status}.`);
    const updated = await setFirmwareStatus(job, req.device, data);
    res.json({ id: updated.id, status: updated.status });
  }),
);

export default router;
