import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { addDays, nowIso, startOfDay } from '../lib/time.js';
import { listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem, logUserManagement } from '../services/activity.js';
import { withStatus } from '../services/deviceStatus.js';
import { loadDailyUsage } from '../services/usage.js';
import { publicUser } from '../services/homeowners.js';

const router = Router();

const phone = z
  .string()
  .trim()
  .regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number')
  .or(z.literal(''))
  .optional()
  .default('');

const userSchema = z.object({
  fullName: trimmed(2, 100),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  phone,
  address: trimmed(5, 300),
  accountNumber: z.string().trim().max(30).optional().default(''),
  status: z.enum(['active', 'inactive']).default('active'),
});

const houseSchema = z.object({
  houseName: trimmed(2, 100),
  address: trimmed(5, 300),
  installationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').or(z.literal('')).optional().default(''),
  houseStatus: z.enum(['monitored', 'pending_installation', 'inactive']).default('pending_installation'),
});

const listSchema = listQuery.extend({ status: z.enum(['active', 'inactive']).optional() });

async function ensureEmailFree(email, exceptId) {
  const [existing] = await db.list(C.users, { where: [['email', '==', email]], limit: 1 });
  if (existing && existing.id !== exceptId) {
    throw badRequest('Please correct the highlighted fields.', { fields: { email: 'A user with this email already exists' } });
  }
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const [users, houses, devices, usage] = await Promise.all([
      db.list(C.users),
      db.list(C.houses),
      db.list(C.devices),
      loadDailyUsage(addDays(startOfDay(), -29), new Date()),
    ]);
    const housesByUser = Map.groupBy(houses, (h) => h.userId);
    const devicesByHouse = Map.groupBy(devices, (d) => d.houseId);
    const usageByHouse = new Map();
    for (const u of usage) usageByHouse.set(u.houseId, (usageByHouse.get(u.houseId) || 0) + u.litersUsed);

    let rows = users.map((u) => {
      const hs = housesByUser.get(u.id) || [];
      return {
        ...publicUser(u),
        householdCount: hs.length,
        deviceCount: hs.reduce((s, h) => s + (devicesByHouse.get(h.id)?.length || 0), 0),
        usage30dLiters: hs.reduce((s, h) => s + (usageByHouse.get(h.id) || 0), 0),
      };
    });
    if (q.status) rows = rows.filter((r) => r.status === q.status);

    res.json(
      paginate(rows, {
        ...q,
        sort: q.sort || 'createdAt',
        searchFields: ['fullName', 'email', 'phone', 'address', 'accountNumber'],
        allowedSorts: ['fullName', 'email', 'createdAt', 'deviceCount', 'usage30dLiters', 'status'],
      }),
    );
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = parse(userSchema, req.body);
    await ensureEmailFree(data.email);
    const user = await db.create(C.users, { ...data, createdAt: nowIso(), createdBy: req.admin.id });
    await logUserManagement({ admin: req.admin, userId: user.id, actionType: 'create', remarks: 'Account created by admin' });
    await logSystem({ category: 'admin_action', action: 'user_created', description: `Added homeowner ${user.fullName}`, status: 'success', actor: req.admin });
    res.status(201).json(publicUser(user));
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await db.get(C.users, req.params.id);
    if (!user) throw notFound('User');
    const houses = await db.list(C.houses, { where: [['userId', '==', user.id]] });
    const houseIds = new Set(houses.map((h) => h.id));
    const [devices, usage, alerts, history] = await Promise.all([
      db.list(C.devices),
      loadDailyUsage(addDays(startOfDay(), -29), new Date()),
      db.list(C.alerts, { orderBy: ['createdAt', 'desc'], limit: 200 }),
      db.list(C.userManagement, { where: [['userId', '==', user.id]] }),
    ]);
    const ownDevices = devices.filter((d) => houseIds.has(d.houseId)).map(withStatus);
    const ownUsage = usage.filter((u) => houseIds.has(u.houseId));
    const byDate = new Map();
    for (const u of ownUsage) byDate.set(u.date, (byDate.get(u.date) || 0) + u.litersUsed);

    res.json({
      user: publicUser(user),
      houses,
      devices: ownDevices,
      usage: {
        unit: 'L',
        last30DaysLiters: ownUsage.reduce((s, u) => s + u.litersUsed, 0),
        daily: [...byDate.entries()].sort().map(([date, liters]) => ({ date, liters })),
        sources: [...new Set(ownUsage.map((u) => u.source))],
      },
      recentAlerts: alerts.filter((a) => houseIds.has(a.houseId)).slice(0, 10),
      history: history.sort((a, b) => b.actionDate.localeCompare(a.actionDate)),
    });
  }),
);

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.users, req.params.id);
    if (!existing) throw notFound('User');
    const data = parse(userSchema, req.body);
    await ensureEmailFree(data.email, existing.id);
    const user = await db.update(C.users, existing.id, { ...data, updatedAt: nowIso() });
    const changed = Object.keys(data).filter((k) => data[k] !== existing[k]);
    await logUserManagement({ admin: req.admin, userId: user.id, actionType: data.status !== existing.status ? 'status_change' : 'update', remarks: changed.length ? `Updated ${changed.join(', ')}` : 'No changes' });
    res.json(publicUser(user));
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const user = await db.get(C.users, req.params.id);
    if (!user) throw notFound('User');
    const houses = await db.list(C.houses, { where: [['userId', '==', user.id]] });
    if (houses.length) throw conflict('Remove or reassign this user’s households before deleting the account. You can mark the user inactive instead.');
    await db.remove(C.users, user.id);
    await logUserManagement({ admin: req.admin, userId: user.id, actionType: 'delete', remarks: `Deleted ${user.fullName}` });
    await logSystem({ category: 'admin_action', action: 'user_deleted', description: `Deleted homeowner ${user.fullName}`, status: 'warning', actor: req.admin });
    res.status(204).end();
  }),
);

router.post(
  '/:id/houses',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const user = await db.get(C.users, req.params.id);
    if (!user) throw notFound('User');
    const data = parse(houseSchema, req.body);
    const house = await db.create(C.houses, { ...data, userId: user.id, createdAt: nowIso() });
    await logUserManagement({ admin: req.admin, userId: user.id, actionType: 'household_added', remarks: data.houseName });
    res.status(201).json(house);
  }),
);

export const housesRouter = Router();

const housesListSchema = listQuery.extend({
  status: z.enum(['monitored', 'pending_installation', 'inactive']).optional(),
  ownerId: z.string().optional(),
});

// Without `page`: compact list for dropdowns. With `page`: the Households table
// (search, filter, sort, pagination) enriched with owner, devices, usage and alerts.
housesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [houses, users] = await Promise.all([db.list(C.houses), db.list(C.users)]);
    const userById = new Map(users.map((u) => [u.id, u]));
    if (req.query.page === undefined) {
      return res.json({ items: houses.map((h) => ({ ...h, ownerName: userById.get(h.userId)?.fullName ?? null })).sort((a, b) => a.houseName.localeCompare(b.houseName)) });
    }

    const q = parse(housesListSchema, req.query);
    const [devices, usage, alerts] = await Promise.all([
      db.list(C.devices),
      loadDailyUsage(addDays(startOfDay(), -29), new Date()),
      db.list(C.alerts, { where: [['alertStatus', 'in', ['open', 'acknowledged']]] }),
    ]);
    const usageByHouse = new Map();
    for (const u of usage) usageByHouse.set(u.houseId, (usageByHouse.get(u.houseId) || 0) + u.litersUsed);

    let rows = houses.map((h) => {
      const owner = userById.get(h.userId);
      const own = devices.filter((d) => d.houseId === h.id).map(withStatus);
      return {
        ...h,
        ownerName: owner?.fullName ?? null,
        ownerEmail: owner?.email ?? null,
        deviceCount: own.length,
        devicesOnline: own.filter((d) => d.connectionStatus === 'online').length,
        assignedDeviceIds: own.map((d) => d.id),
        deviceNames: own.map((d) => d.deviceName).join(', '),
        usage30dLiters: usageByHouse.get(h.id) || 0,
        activeAlerts: alerts.filter((a) => a.houseId === h.id).length,
      };
    });
    if (q.status) rows = rows.filter((r) => r.houseStatus === q.status);
    if (q.ownerId) rows = rows.filter((r) => r.userId === q.ownerId);

    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'createdAt',
        searchFields: ['houseName', 'address', 'ownerName', 'ownerEmail', 'deviceNames'],
        allowedSorts: ['houseName', 'ownerName', 'createdAt', 'usage30dLiters', 'deviceCount', 'activeAlerts'],
      }),
      summary: {
        total: houses.length,
        monitored: houses.filter((h) => h.houseStatus === 'monitored').length,
        pending: houses.filter((h) => h.houseStatus === 'pending_installation').length,
        withoutDevice: rows.filter((r) => !r.deviceCount).length,
      },
    });
  }),
);

housesRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { userId, ...data } = parse(houseSchema.extend({ userId: z.string().min(1, 'Choose the homeowner') }), req.body);
    const owner = await db.get(C.users, userId);
    if (!owner) throw badRequest('Please correct the highlighted fields.', { fields: { userId: 'Homeowner not found' } });
    const house = await db.create(C.houses, { ...data, userId, createdAt: nowIso() });
    await logUserManagement({ admin: req.admin, userId, actionType: 'household_added', remarks: data.houseName });
    await logSystem({ category: 'admin_action', action: 'household_created', description: `Added household ${data.houseName} for ${owner.fullName}`, status: 'success', actor: req.admin, houseId: house.id });
    res.status(201).json(house);
  }),
);

housesRouter.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const house = await db.get(C.houses, req.params.id);
    if (!house) throw notFound('Household');
    const data = parse(houseSchema, req.body);
    const updated = await db.update(C.houses, house.id, { ...data, updatedAt: nowIso() });
    await logUserManagement({ admin: req.admin, userId: house.userId, actionType: 'household_updated', remarks: data.houseName });
    res.json(updated);
  }),
);

housesRouter.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const house = await db.get(C.houses, req.params.id);
    if (!house) throw notFound('Household');
    const devices = await db.list(C.devices, { where: [['houseId', '==', house.id]] });
    if (devices.length) throw conflict('Unassign this household’s devices before removing it.');
    await db.remove(C.houses, house.id);
    await logUserManagement({ admin: req.admin, userId: house.userId, actionType: 'household_removed', remarks: house.houseName });
    res.status(204).end();
  }),
);

export default router;
