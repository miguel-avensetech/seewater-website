import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { nowIso } from '../lib/time.js';

// Homeowner-controlled phone alerts (Profile → Notification settings). Every
// notification is still saved to the in-app inbox; possible-leak alerts and
// MCWD replies always alert the phone.
export const NOTIFICATION_PREF_DEFAULTS = { high_flow: true, usage_threshold: true, device_offline: true, valve: true, advisories: true };
const PREF_FOR_TYPE = { high_flow: 'high_flow', usage_threshold: 'usage_threshold', device_offline: 'device_offline', valve: 'valve', system: 'advisories', interruption: 'advisories' };

export function wantsPhoneAlert(user, notificationType) {
  const key = PREF_FOR_TYPE[notificationType];
  return !key || (user?.notificationPreferences?.[key] ?? NOTIFICATION_PREF_DEFAULTS[key]);
}

// Creates an in-app NOTIFICATION record (manuscript Table 10) and, when the
// homeowner has registered an Expo push token, sends a push notification.
export async function notifyUser(userId, { title, message, notificationType, alertId = null, data = {} }) {
  if (!userId) return null;
  const notification = await db.create(C.notifications, {
    userId,
    alertId,
    title,
    message,
    notificationType,
    data,
    isRead: false,
    sentAt: nowIso(),
  });
  sendPush(userId, { title, body: message, data: { notificationId: notification.id, notificationType, alertId, ...data } }).catch((err) =>
    console.error('[push] failed', err.message),
  );
  return notification;
}

export async function notifyHouseOwner(houseId, payload) {
  if (!houseId) return null;
  const house = await db.get(C.houses, houseId);
  return house?.userId ? notifyUser(house.userId, payload) : null;
}

// Expo push service. Best-effort: failures never block the caller.
async function sendPush(userId, { title, body, data }) {
  if (!config.pushEnabled) return;
  const user = await db.get(C.users, userId);
  if (!wantsPhoneAlert(user, data.notificationType)) return;
  const tokens = user?.expoPushTokens ?? [];
  if (!tokens.length) return;

  const urgent = ['possible_leak', 'high_flow'].includes(data.notificationType);
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(config.expoAccessToken && { authorization: `Bearer ${config.expoAccessToken}` }),
    },
    body: JSON.stringify(
      tokens.map((to) => ({ to, title, body, data, sound: 'default', priority: urgent ? 'high' : 'default', channelId: urgent ? 'alerts' : 'default' })),
    ),
  });
  const json = await res.json().catch(() => null);

  // Drop tokens Expo reports as no longer registered.
  const stale = (json?.data ?? []).map((r, i) => (r.status === 'error' && r.details?.error === 'DeviceNotRegistered' ? tokens[i] : null)).filter(Boolean);
  if (stale.length) await db.update(C.users, userId, { expoPushTokens: tokens.filter((t) => !stale.includes(t)) });
}
