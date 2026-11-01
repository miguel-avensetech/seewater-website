// Live state in Firebase Realtime Database.
//
//   /live/devices/{deviceId}  current status, latest readings and valve state
//   /live/alerts/{alertId}    alerts that are open or acknowledged (removed on resolve)
//
// Firestore stays the system of record (history, relationships, audit); this is a
// small, always-current mirror written only by the API (Admin SDK) after it has
// validated the device and the payload. Browsers and apps can only read it, as
// allowed by firebase/database.rules.json. Mirroring is best-effort: a Realtime
// Database outage never blocks ingestion or admin actions.

import { config } from '../config.js';
// C from collections.js directly: db/index.js imports this module (cycle-safe).
import { C } from '../db/collections.js';
import { db } from '../db/index.js';
import { adminDatabase } from '../lib/firebaseAdmin.js';
import { connectionStatus } from './deviceStatus.js';

const enabled = () => config.dbDriver === 'firestore' && process.env.LIVE_SYNC !== 'false';

async function write(path, value) {
  if (!enabled()) return;
  try {
    const ref = adminDatabase().ref(path);
    if (value === null) await ref.remove();
    else await ref.set(value);
  } catch (err) {
    console.error('[live] write failed', path, err.message);
  }
}

// Rebuilds /live/devices/{id} from Firestore (device, sensors, valve, owner).
export async function syncLiveDevice(deviceId) {
  if (!enabled() || !deviceId) return;
  const device = await db.get(C.devices, deviceId);
  if (!device) return write(`live/devices/${deviceId}`, null);

  const [sensors, valves, house] = await Promise.all([
    db.list(C.sensors, { where: [['deviceId', '==', deviceId]] }),
    db.list(C.valves, { where: [['deviceId', '==', deviceId]] }),
    device.houseId ? db.get(C.houses, device.houseId) : null,
  ]);
  const flow = sensors.find((s) => s.sensorType === 'flow');
  const vib = sensors.find((s) => s.sensorType === 'vibration');
  const valve = valves[0];

  // Missing values are null (never 0): "no data yet" is not "no flow".
  await write(`live/devices/${deviceId}`, {
    deviceName: device.deviceName,
    houseId: device.houseId ?? null,
    ownerId: house?.userId ?? null,
    connectionStatus: connectionStatus(device),
    lastOnline: device.lastOnline ?? null,
    signalStrength: device.signalStrength ?? null,
    isSimulated: Boolean(device.isSimulated),
    flowRate: flow?.lastFlowRate ?? null,
    flowReadingAt: flow?.lastReadingAt ?? null,
    vibrationLevel: vib?.lastVibrationLevel ?? null,
    vibrationReadingAt: vib?.lastReadingAt ?? null,
    valve: valve
      ? {
          id: valve.id,
          status: valve.status ?? 'unknown',
          commandStatus: valve.commandStatus ?? 'none',
          requestedState: valve.requestedState ?? null,
          positionConfirmed: Boolean(valve.positionConfirmed),
          updatedAt: valve.lastUpdated ?? null,
        }
      : null,
    updatedAt: new Date().toISOString(),
  });
}

export async function syncLiveAlert(alertId) {
  if (!enabled() || !alertId) return;
  const alert = await db.get(C.alerts, alertId);
  if (!alert || alert.alertStatus === 'resolved') return write(`live/alerts/${alertId}`, null);
  const house = alert.houseId ? await db.get(C.houses, alert.houseId) : null;
  await write(`live/alerts/${alertId}`, {
    alertType: alert.alertType,
    severityLevel: alert.severityLevel,
    alertStatus: alert.alertStatus,
    deviceId: alert.deviceId ?? null,
    houseId: alert.houseId ?? null,
    ownerId: house?.userId ?? null,
    createdAt: alert.createdAt,
    source: alert.source ?? 'device',
  });
}

// Full rebuild (npm run sync-live) — e.g. after restoring data.
export async function rebuildLive() {
  if (!enabled()) throw new Error('Live sync requires DB_DRIVER=firestore.');
  await adminDatabase().ref('live').remove();
  const [devices, alerts] = await Promise.all([db.list(C.devices), db.list(C.alerts, { where: [['alertStatus', 'in', ['open', 'acknowledged']]] })]);
  for (const d of devices) await syncLiveDevice(d.id);
  for (const a of alerts) await syncLiveAlert(a.id);
  return { devices: devices.length, alerts: alerts.length };
}

// ── Write hooks ─────────────────────────────────────────────────────────────
// The database layer calls noteWrite() after every write; affected live nodes are
// re-synced once per burst (coalesced over 150 ms).
const pendingDevices = new Set();
const pendingAlerts = new Set();
let timer = null;

export function noteWrite(collection, doc) {
  if (!enabled() || !doc) return;
  if (collection === C.devices) pendingDevices.add(doc.id);
  else if ((collection === C.sensors || collection === C.valves) && doc.deviceId) pendingDevices.add(doc.deviceId);
  else if (collection === C.alerts) pendingAlerts.add(doc.id);
  else return;
  timer ??= setTimeout(flushLive, 150);
}

export async function flushLive() {
  clearTimeout(timer);
  timer = null;
  const devices = [...pendingDevices];
  const alerts = [...pendingAlerts];
  pendingDevices.clear();
  pendingAlerts.clear();
  await Promise.all([...devices.map(syncLiveDevice), ...alerts.map(syncLiveAlert)]);
}

const WATCHED = new Set([C.devices, C.sensors, C.valves, C.alerts]);

// Wraps a database driver so writes to watched collections update the live mirror.
export function withLiveSync(driver) {
  return {
    ...driver,
    async create(collection, doc, id) {
      const out = await driver.create(collection, doc, id);
      if (WATCHED.has(collection)) noteWrite(collection, out);
      return out;
    },
    async set(collection, id, doc) {
      const out = await driver.set(collection, id, doc);
      if (WATCHED.has(collection)) noteWrite(collection, out);
      return out;
    },
    async update(collection, id, patch) {
      const out = await driver.update(collection, id, patch);
      if (WATCHED.has(collection)) noteWrite(collection, out);
      return out;
    },
    async remove(collection, id) {
      const before = WATCHED.has(collection) ? await driver.get(collection, id) : null;
      const out = await driver.remove(collection, id);
      if (before) noteWrite(collection, before);
      return out;
    },
  };
}
