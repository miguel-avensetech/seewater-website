// Firmware updates for ESP32 gateways (Admin → IoT Device Management → Firmware Update).
import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logDevice, logSystem } from '../services/activity.js';
import { ACTIVE_FIRMWARE_STATUSES } from '../services/firmware.js';
import { loadLookups } from '../services/lookups.js';

const router = Router();
const STATUSES = ['pending', 'downloading', 'installing', 'installed', 'failed', 'cancelled'];

const listSchema = listQuery.extend({ status: z.enum(STATUSES).optional() });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const [all, lk, admins] = await Promise.all([db.list(C.firmwareUpdates), loadLookups(), db.list(C.admins)]);
    const adminName = new Map(admins.map((a) => [a.id, a.fullName]));
    const rows = all
      .filter((j) => !q.status || j.status === q.status)
      .map((j) => ({ ...j, deviceName: lk.deviceName(j.deviceId) ?? 'Removed device', ...lk.describeHouse(lk.deviceById.get(j.deviceId)?.houseId), requestedByName: adminName.get(j.requestedBy) ?? 'Unknown' }));
    const activated = lk.devices.filter((d) => d.activationStatus === 'activated');
    const active = new Map(all.filter((j) => ACTIVE_FIRMWARE_STATUSES.includes(j.status)).map((j) => [j.deviceId, j]));
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'requestedAt', searchFields: ['deviceName', 'targetVersion', 'fromVersion', 'houseName'], allowedSorts: ['requestedAt', 'deviceName', 'targetVersion', 'status'] }),
      summary: Object.fromEntries(STATUSES.map((s) => [s, all.filter((j) => j.status === s).length])),
      // Device picker for new updates: activated devices and their current version.
      devices: activated
        .map((d) => ({ id: d.id, deviceName: d.deviceName, firmwareVersion: d.firmwareVersion || null, connectionStatus: d.connectionStatus, isSimulated: Boolean(d.isSimulated), houseName: lk.describeHouse(d.houseId).houseName, activeUpdate: active.get(d.id)?.targetVersion ?? null }))
        .sort((a, b) => a.deviceName.localeCompare(b.deviceName)),
      versions: [...Map.groupBy(activated, (d) => d.firmwareVersion || 'unknown')].map(([version, ds]) => ({ version, devices: ds.length })).sort((a, b) => b.devices - a.devices),
    });
  }),
);

const createSchema = z.object({
  deviceIds: z.array(z.string().min(1)).min(1, 'Choose at least one device').max(500),
  targetVersion: z.string().trim().regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/, 'Use a version like 1.3.0'),
  // The ESP32 downloads the image itself, so it must be reachable over HTTPS.
  url: z.string().trim().url('Enter the firmware .bin URL').refine((u) => u.startsWith('https://'), 'The firmware URL must use HTTPS'),
  sha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, 'SHA-256 is 64 hexadecimal characters').or(z.literal('')).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = parse(createSchema, req.body);
    const [lk, all] = await Promise.all([loadLookups(), db.list(C.firmwareUpdates)]);
    const busy = new Set(all.filter((j) => ACTIVE_FIRMWARE_STATUSES.includes(j.status)).map((j) => j.deviceId));
    const created = [];
    const skipped = [];
    for (const id of new Set(data.deviceIds)) {
      const device = lk.deviceById.get(id);
      if (!device) throw notFound('Device');
      if (device.activationStatus !== 'activated') skipped.push({ deviceName: device.deviceName, reason: 'not activated' });
      else if (busy.has(id)) skipped.push({ deviceName: device.deviceName, reason: 'update already in progress' });
      else if (device.firmwareVersion === data.targetVersion) skipped.push({ deviceName: device.deviceName, reason: `already on ${data.targetVersion}` });
      else {
        const at = nowIso();
        const job = await db.create(C.firmwareUpdates, { deviceId: id, fromVersion: device.firmwareVersion || null, targetVersion: data.targetVersion, url: data.url, sha256: data.sha256 || null, notes: data.notes, status: 'pending', message: '', requestedBy: req.admin.id, requestedAt: at, updatedAt: at, completedAt: null });
        await logDevice({ deviceId: id, eventType: 'firmware_update_requested', description: `Firmware update to ${data.targetVersion} queued`, status: 'info', source: 'system' });
        created.push(job);
      }
    }
    if (!created.length) throw badRequest(`No updates were queued: ${skipped.map((s) => `${s.deviceName} (${s.reason})`).join(', ')}.`);
    await logSystem({ category: 'system_update', action: 'firmware_update_requested', description: `Firmware ${data.targetVersion} queued for ${created.length} device${created.length === 1 ? '' : 's'}`, status: 'info', actor: req.admin });
    res.status(201).json({ created: created.length, skipped });
  }),
);

router.post(
  '/:id/cancel',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const job = await db.get(C.firmwareUpdates, req.params.id);
    if (!job) throw notFound('Firmware update');
    if (job.status !== 'pending') throw conflict('Only updates the device hasn’t started can be cancelled.');
    const updated = await db.update(C.firmwareUpdates, job.id, { status: 'cancelled', updatedAt: nowIso(), completedAt: nowIso() });
    await logDevice({ deviceId: job.deviceId, eventType: 'firmware_update_cancelled', description: `Firmware update to ${job.targetVersion} cancelled`, status: 'info', source: 'system' });
    await logSystem({ category: 'system_update', action: 'firmware_update_cancelled', description: `Cancelled firmware ${job.targetVersion} update`, status: 'info', actor: req.admin, deviceId: job.deviceId });
    res.json(updated);
  }),
);

export default router;
