// Cross-device operational views: valve command history, activation codes and
// homeowner notifications (with admin-sent messages).
import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, conflict, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { isoDate, listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logDevice, logSystem } from '../services/activity.js';
import { loadLookups } from '../services/lookups.js';
import { notifyUser } from '../services/notify.js';

const dayRange = (q) => ({
  from: q.from ? new Date(`${q.from.slice(0, 10)}T00:00:00`).toISOString() : null,
  to: q.to ? new Date(`${q.to.slice(0, 10)}T23:59:59.999`).toISOString() : null,
});

// ── Valve operations ────────────────────────────────────────────────────────
export const valveCommandsRouter = Router();

const valveListSchema = listQuery.extend({
  status: z.enum(['pending', 'acknowledged', 'failed', 'cancelled']).optional(),
  requestedByType: z.enum(['admin', 'homeowner', 'automatic']).optional(),
  emergency: z.enum(['true', 'false']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

valveCommandsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(valveListSchema, req.query);
    const { from, to } = dayRange(q);
    const [all, lk] = await Promise.all([db.list(C.valveCommands, { orderBy: ['requestedAt', 'desc'], limit: 5000 }), loadLookups()]);
    const rows = all
      .filter((c) => (!q.status || c.status === q.status) && (!q.requestedByType || c.requestedByType === q.requestedByType))
      .filter((c) => !q.emergency || String(Boolean(c.emergency)) === q.emergency)
      .filter((c) => (!from || c.requestedAt >= from) && (!to || c.requestedAt <= to))
      .map((c) => ({ ...c, deviceName: lk.deviceName(c.deviceId) ?? 'Removed device', ...lk.describeHouse(c.houseId) }));
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'requestedAt', searchFields: ['deviceName', 'houseName', 'ownerName', 'requestedByName', 'reason'], allowedSorts: ['requestedAt', 'status', 'deviceName'] }),
      summary: {
        total: all.length,
        pending: all.filter((c) => c.status === 'pending').length,
        acknowledged: all.filter((c) => c.status === 'acknowledged').length,
        failed: all.filter((c) => c.status === 'failed').length,
        emergency: all.filter((c) => c.emergency).length,
        positionConfirmed: all.filter((c) => c.positionConfirmed).length,
      },
    });
  }),
);

// ── Activation codes ────────────────────────────────────────────────────────
export const activationCodesRouter = Router();

const codeListSchema = listQuery.extend({ status: z.enum(['active', 'used', 'expired', 'revoked']).optional() });

activationCodesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(codeListSchema, req.query);
    const [all, lk] = await Promise.all([db.list(C.activationCodes), loadLookups()]);
    const now = nowIso();
    // Show expiry without waiting for the next redemption attempt to mark it.
    const withStatus = all.map((c) => ({ ...c, status: c.status === 'active' && c.expiresAt < now ? 'expired' : c.status }));
    const rows = withStatus
      .filter((c) => !q.status || c.status === q.status)
      .map((c) => {
        const device = lk.deviceById.get(c.deviceId);
        return { ...c, deviceName: device?.deviceName ?? 'Removed device', ...lk.describeHouse(device?.houseId), activatedByName: c.activatedBy ? lk.userById.get(c.activatedBy)?.fullName ?? null : null };
      });
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'createdAt', searchFields: ['code', 'deviceName', 'houseName', 'ownerName'], allowedSorts: ['createdAt', 'expiresAt', 'status', 'deviceName'] }),
      summary: Object.fromEntries(['active', 'used', 'expired', 'revoked'].map((s) => [s, withStatus.filter((c) => c.status === s).length])),
    });
  }),
);

activationCodesRouter.post(
  '/:code/revoke',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const code = await db.get(C.activationCodes, req.params.code);
    if (!code) throw notFound('Activation code');
    if (code.status !== 'active') throw conflict(`This code is already ${code.status}.`);
    await db.update(C.activationCodes, code.id, { status: 'revoked', revokedAt: nowIso(), revokedReason: 'revoked_by_admin', revokedBy: req.admin.id });
    await logDevice({ deviceId: code.deviceId, eventType: 'activation_code_revoked', description: `Activation code revoked by ${req.admin.fullName}`, status: 'warning', source: 'system' });
    await logSystem({ category: 'admin_action', action: 'activation_code_revoked', description: `Revoked activation code ${code.id}`, status: 'warning', actor: req.admin, deviceId: code.deviceId });
    res.json({ ...code, status: 'revoked' });
  }),
);

// ── Notifications ───────────────────────────────────────────────────────────
export const notificationsRouter = Router();

const notifListSchema = listQuery.extend({
  type: z.string().max(40).optional(),
  read: z.enum(['true', 'false']).optional(),
  userId: z.string().optional(),
});

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(notifListSchema, req.query);
    const [all, users] = await Promise.all([db.list(C.notifications, { orderBy: ['sentAt', 'desc'], limit: 5000 }), db.list(C.users)]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const rows = all
      .filter((n) => (!q.type || n.notificationType === q.type) && (!q.read || String(Boolean(n.isRead)) === q.read) && (!q.userId || n.userId === q.userId))
      .map((n) => ({ ...n, userName: userById.get(n.userId)?.fullName ?? 'Removed user', userEmail: userById.get(n.userId)?.email ?? null }));
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'sentAt', searchFields: ['title', 'message', 'userName', 'userEmail'], allowedSorts: ['sentAt', 'notificationType'] }),
      summary: { total: all.length, unread: all.filter((n) => !n.isRead).length, alerts: all.filter((n) => ['possible_leak', 'high_flow', 'device_offline'].includes(n.notificationType)).length },
      types: [...new Set(all.map((n) => n.notificationType))].sort(),
    });
  }),
);

const sendSchema = z
  .object({
    audience: z.enum(['all', 'user']),
    userId: z.string().optional(),
    title: trimmed(3, 100),
    message: trimmed(5, 1000),
  })
  .refine((d) => d.audience === 'all' || d.userId, { path: ['userId'], message: 'Choose a homeowner' });

// Sends an in-app (and push, when registered) message from MCWD.
notificationsRouter.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = parse(sendSchema, req.body);
    const users = data.audience === 'all' ? (await db.list(C.users)).filter((u) => u.status === 'active') : [await db.get(C.users, data.userId)].filter(Boolean);
    if (data.audience === 'user' && !users.length) throw notFound('Homeowner');
    for (const u of users) await notifyUser(u.id, { title: data.title, message: data.message, notificationType: 'system', data: { sentBy: req.admin.id } });
    await logSystem({ category: 'admin_action', action: 'notification_sent', description: `Sent "${data.title}" to ${data.audience === 'all' ? `${users.length} homeowner(s)` : users[0].fullName}`, status: 'success', actor: req.admin });
    res.status(201).json({ sent: users.length });
  }),
);
