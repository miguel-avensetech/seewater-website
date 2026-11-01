import { db, C } from '../db/index.js';
import { dayKey } from '../lib/time.js';
import { notifyUser } from './notify.js';

/**
 * Homeowner-set daily water usage threshold (Profile → Notification settings).
 * Notifies the homeowner once per household per day when today's total
 * reaches their limit. Readings for earlier days never trigger it.
 */
export async function checkDailyUsageLimit(houseId, at) {
  const day = dayKey(at);
  if (day !== dayKey(new Date())) return null;
  const house = await db.get(C.houses, houseId);
  if (!house?.userId) return null;
  const user = await db.get(C.users, house.userId);
  const limit = user?.dailyUsageLimitLiters;
  if (!limit || user.usageLimitNotices?.[houseId] === day) return null;

  const docs = await Promise.all(['device', 'simulated'].map((source) => db.get(C.waterUsage, `${houseId}_${day}_${source}`)));
  const liters = docs.reduce((s, d) => s + (d?.litersUsed ?? 0), 0);
  if (liters < limit) return null;

  await db.update(C.users, user.id, { usageLimitNotices: { ...user.usageLimitNotices, [houseId]: day } });
  return notifyUser(user.id, {
    title: 'Daily water limit reached',
    message: `${house.houseName ?? 'Your home'} has used ${Math.round(liters).toLocaleString('en-PH')} L today, reaching your limit of ${limit.toLocaleString('en-PH')} L.`,
    notificationType: 'usage_threshold',
    data: { houseId, date: day, liters, limit },
  });
}
