import { db, C } from '../db/index.js';
import { nowIso } from '../lib/time.js';
import { logDevice, logSystem } from './activity.js';

// Firmware update jobs (collection: firmwareUpdates), one per device:
//   pending → downloading → installing → installed | failed, or cancelled by MCWD while pending.
// The ESP32 receives the job from GET /api/device-api/commands, downloads the
// image over HTTPS (checking sha256 when given) and reports progress.
export const ACTIVE_FIRMWARE_STATUSES = ['pending', 'downloading', 'installing'];

export async function activeFirmwareUpdate(deviceId) {
  const jobs = await db.list(C.firmwareUpdates, { where: [['deviceId', '==', deviceId]] });
  return jobs.filter((j) => ACTIVE_FIRMWARE_STATUSES.includes(j.status)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0] ?? null;
}

export async function setFirmwareStatus(job, device, { status, message = '' }) {
  const at = nowIso();
  const done = status === 'installed' || status === 'failed';
  const updated = await db.update(C.firmwareUpdates, job.id, { status, message, updatedAt: at, ...(done && { completedAt: at }) });
  if (status === 'installed' && device.firmwareVersion !== job.targetVersion) {
    await db.update(C.devices, device.id, { firmwareVersion: job.targetVersion });
  }
  if (done) {
    const source = device.isSimulated ? 'simulated' : 'device';
    const ok = status === 'installed';
    const description = ok ? `Firmware ${job.fromVersion || '—'} → ${job.targetVersion} installed` : `Firmware update to ${job.targetVersion} failed${message ? `: ${message}` : ''}`;
    await logDevice({ deviceId: device.id, eventType: ok ? 'firmware_updated' : 'firmware_failed', description, status: ok ? 'success' : 'error', source });
    await logSystem({ category: 'system_update', action: ok ? 'firmware_updated' : 'firmware_failed', description: `${device.deviceName}: ${description}`, status: ok ? 'success' : 'error', deviceId: device.id, houseId: device.houseId, source });
  }
  return updated;
}

// A device that reboots into the target version completes its job even if it
// never sent an explicit "installed" status.
export async function completeFirmwareFromHeartbeat(device, firmwareVersion) {
  const job = await activeFirmwareUpdate(device.id);
  if (job && job.targetVersion === firmwareVersion) await setFirmwareStatus(job, device, { status: 'installed', message: 'Confirmed by heartbeat' });
}
