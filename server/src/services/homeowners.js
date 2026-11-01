import { db, C } from '../db/index.js';
import { NOTIFICATION_PREF_DEFAULTS } from './notify.js';

// Fields that must never leave the server for a homeowner record.
const PRIVATE_FIELDS = ['passwordHash', 'pendingPasswordHash', 'verification', 'expoPushTokens', 'tokenVersion', 'usageLimitNotices'];

export function publicUser(user) {
  if (!user) return null;
  const out = { ...user };
  for (const f of PRIVATE_FIELDS) delete out[f];
  out.hasAppAccount = Boolean(user.passwordHash);
  out.notificationPreferences = { ...NOTIFICATION_PREF_DEFAULTS, ...user.notificationPreferences };
  out.dailyUsageLimitLiters = user.dailyUsageLimitLiters ?? null;
  return out;
}

/**
 * Ownership scope for a homeowner, always derived on the server from the
 * authenticated user — never from IDs sent by the app.
 */
export async function ownedScope(userId) {
  const houses = await db.list(C.houses, { where: [['userId', '==', userId]] });
  const houseIds = new Set(houses.map((h) => h.id));
  const devices = houseIds.size ? (await db.list(C.devices)).filter((d) => houseIds.has(d.houseId)) : [];
  const deviceIds = new Set(devices.map((d) => d.id));
  return {
    houses,
    houseIds,
    devices,
    deviceIds,
    ownsHouse: (id) => houseIds.has(id),
    ownsDevice: (id) => deviceIds.has(id),
  };
}
