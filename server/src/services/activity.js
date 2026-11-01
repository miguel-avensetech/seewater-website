import { db, C } from '../db/index.js';
import { nowIso } from '../lib/time.js';

// System log categories shown on the System Logs page.
export const SYSTEM_CATEGORIES = [
  'high_flow',
  'possible_leak',
  'sensor_event',
  'connectivity',
  'valve_operation',
  'system_update',
  'admin_action',
];

export async function logSystem({ category, action, description, status = 'info', actor, deviceId, houseId, source = 'system' }) {
  return db.create(C.systemLogs, {
    category,
    action,
    description,
    status,
    actorId: actor?.id ?? null,
    actorName: actor?.fullName ?? null,
    deviceId: deviceId ?? null,
    houseId: houseId ?? null,
    source,
    createdAt: nowIso(),
  });
}

// DEVICE_LOG entries (manuscript Table 16): operational events reported by or about a device.
export async function logDevice({ deviceId, eventType, description, status = 'info', source = 'device' }) {
  return db.create(C.deviceLogs, {
    deviceId,
    eventType,
    description,
    status,
    source,
    loggedAt: nowIso(),
  });
}

// USER_MANAGEMENT entries (manuscript Table 14).
export async function logUserManagement({ admin, userId, actionType, remarks = '' }) {
  return db.create(C.userManagement, {
    adminId: admin.id,
    userId,
    actionType,
    remarks,
    actionDate: nowIso(),
  });
}
