import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { isoDate, listQuery, parse, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';
import { loadLookups } from '../services/lookups.js';

const router = Router();

export const ALERT_TYPES = ['possible_leak', 'high_flow', 'device_offline', 'sensor_fault'];

const listSchema = listQuery.extend({
  type: z.enum(ALERT_TYPES).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  status: z.enum(['open', 'acknowledged', 'resolved', 'active']).optional(),
  source: z.enum(['device', 'simulated']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const [alerts, lk] = await Promise.all([db.list(C.alerts, { orderBy: ['createdAt', 'desc'], limit: 5000 }), loadLookups()]);
    const from = q.from ? new Date(`${q.from.slice(0, 10)}T00:00:00`).toISOString() : null;
    const to = q.to ? new Date(`${q.to.slice(0, 10)}T23:59:59.999`).toISOString() : null;

    const rows = alerts
      .filter((a) => !q.type || a.alertType === q.type)
      .filter((a) => !q.severity || a.severityLevel === q.severity)
      .filter((a) => !q.status || (q.status === 'active' ? a.alertStatus !== 'resolved' : a.alertStatus === q.status))
      .filter((a) => !q.source || a.source === q.source)
      .filter((a) => (!from || a.createdAt >= from) && (!to || a.createdAt <= to))
      .map((a) => ({ ...a, deviceName: lk.deviceName(a.deviceId), ...lk.describeHouse(a.houseId) }));

    const active = alerts.filter((a) => a.alertStatus !== 'resolved');
    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'createdAt',
        searchFields: ['description', 'deviceName', 'houseName', 'ownerName', 'possibleLeakArea', 'deviceId'],
        allowedSorts: ['createdAt', 'severityLevel', 'alertType', 'alertStatus'],
      }),
      summary: {
        active: active.length,
        critical: active.filter((a) => a.severityLevel === 'critical').length,
        leaks: active.filter((a) => a.alertType === 'possible_leak').length,
        highFlow: active.filter((a) => a.alertType === 'high_flow').length,
        offline: active.filter((a) => a.alertType === 'device_offline').length,
      },
    });
  }),
);

const updateSchema = z.object({
  alertStatus: z.enum(['acknowledged', 'resolved']),
  resolutionNote: z.string().trim().max(500).optional().default(''),
});

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const alert = await db.get(C.alerts, req.params.id);
    if (!alert) throw notFound('Alert');
    const data = parse(updateSchema, req.body);
    if (alert.alertStatus === 'resolved') throw badRequest('This alert is already resolved.');
    const patch =
      data.alertStatus === 'acknowledged'
        ? { alertStatus: 'acknowledged', acknowledgedAt: nowIso(), acknowledgedBy: req.admin.id }
        : { alertStatus: 'resolved', resolvedAt: nowIso(), resolvedBy: req.admin.id, resolutionNote: data.resolutionNote };
    const updated = await db.update(C.alerts, alert.id, patch);
    await logSystem({
      category: alert.alertType === 'possible_leak' ? 'possible_leak' : alert.alertType === 'high_flow' ? 'high_flow' : 'connectivity',
      action: `alert_${data.alertStatus}`,
      description: `${req.admin.fullName} marked a ${alert.alertType.replace('_', ' ')} alert as ${data.alertStatus}${data.resolutionNote ? `: ${data.resolutionNote}` : ''}`,
      status: 'info',
      actor: req.admin,
      deviceId: alert.deviceId,
      houseId: alert.houseId,
    });
    res.json(updated);
  }),
);

export default router;
