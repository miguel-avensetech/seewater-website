import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { logDevice, logSystem } from './activity.js';
import { getSettings } from './settings.js';
import { notifyHouseOwner } from './notify.js';
import { nowIso } from '../lib/time.js';

// Connection status is derived from lastOnline so the UI never shows a stale "online".
export function connectionStatus(device, now = Date.now()) {
  if (device.activationStatus !== 'activated') return 'not_activated';
  if (!device.lastOnline) return 'never_connected';
  const ageMin = (now - Date.parse(device.lastOnline)) / 60000;
  return ageMin <= config.deviceOnlineWindowMinutes ? 'online' : 'offline';
}

export function withStatus(device) {
  const { deviceKeyHash, ...safe } = device;
  return { ...safe, connectionStatus: connectionStatus(device) };
}

// Periodic sweep: records a connectivity event when an online device stops reporting.
export async function sweepOfflineDevices() {
  const devices = await db.list(C.devices, { where: [['connectionStatus', '==', 'online']] });
  const settings = await getSettings();
  for (const device of devices) {
    if (connectionStatus(device) !== 'offline') continue;
    await db.update(C.devices, device.id, { connectionStatus: 'offline' });
    await db.create(C.deviceStatusHistory, { deviceId: device.id, status: 'offline', recordedAt: nowIso() });
    const source = device.isSimulated ? 'simulated' : 'device';
    await logDevice({ deviceId: device.id, eventType: 'disconnected', description: `${device.deviceName} stopped reporting`, status: 'warning', source });
    await logSystem({ category: 'connectivity', action: 'device_offline', description: `${device.deviceName} went offline`, status: 'warning', deviceId: device.id, houseId: device.houseId, source });
    if (settings.deviceOfflineAlertsEnabled) {
      await notifyHouseOwner(device.houseId, {
        title: 'SeeWater device offline',
        message: `${device.deviceName} has stopped reporting. Water monitoring and leak detection are paused until it reconnects. Check its power and Wi-Fi.`,
        notificationType: 'device_offline',
      });
      await db.create(C.alerts, {
        sensorId: null,
        deviceId: device.id,
        houseId: device.houseId,
        alertType: 'device_offline',
        possibleLeakArea: null,
        severityLevel: 'warning',
        description: `${device.deviceName} has not reported for over ${config.deviceOnlineWindowMinutes} minutes.`,
        alertStatus: 'open',
        source,
        createdAt: nowIso(),
      });
    }
  }
}
