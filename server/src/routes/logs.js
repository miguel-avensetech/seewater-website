import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler } from '../lib/errors.js';
import { isoDate, listQuery, parse, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { SYSTEM_CATEGORIES } from '../services/activity.js';
import { loadLookups } from '../services/lookups.js';

const router = Router();

const range = (q) => ({
  from: q.from ? new Date(`${q.from.slice(0, 10)}T00:00:00`).toISOString() : null,
  to: q.to ? new Date(`${q.to.slice(0, 10)}T23:59:59.999`).toISOString() : null,
});

const systemSchema = listQuery.extend({
  category: z.enum(SYSTEM_CATEGORIES).optional(),
  status: z.string().max(20).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

router.get(
  '/system',
  asyncHandler(async (req, res) => {
    const q = parse(systemSchema, req.query);
    const { from, to } = range(q);
    const [logs, lk] = await Promise.all([db.list(C.systemLogs, { orderBy: ['createdAt', 'desc'], limit: 5000 }), loadLookups()]);
    const rows = logs
      .filter((l) => !q.category || l.category === q.category)
      .filter((l) => !q.status || l.status === q.status)
      .filter((l) => (!from || l.createdAt >= from) && (!to || l.createdAt <= to))
      .map((l) => ({ ...l, deviceName: lk.deviceName(l.deviceId), houseName: lk.describeHouse(l.houseId).houseName }));
    res.json(
      paginate(rows, {
        ...q,
        sort: q.sort || 'createdAt',
        searchFields: ['description', 'action', 'deviceName', 'houseName', 'actorName', 'deviceId'],
        allowedSorts: ['createdAt', 'category', 'status'],
      }),
    );
  }),
);

const deviceSchema = listQuery.extend({
  deviceId: z.string().optional(),
  eventType: z.string().max(50).optional(),
  status: z.string().max(20).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

router.get(
  '/devices',
  asyncHandler(async (req, res) => {
    const q = parse(deviceSchema, req.query);
    const { from, to } = range(q);
    const [logs, lk] = await Promise.all([db.list(C.deviceLogs, { orderBy: ['loggedAt', 'desc'], limit: 5000 }), loadLookups()]);
    const rows = logs
      .filter((l) => !q.deviceId || l.deviceId === q.deviceId)
      .filter((l) => !q.eventType || l.eventType === q.eventType)
      .filter((l) => !q.status || l.status === q.status)
      .filter((l) => (!from || l.loggedAt >= from) && (!to || l.loggedAt <= to))
      .map((l) => ({ ...l, deviceName: lk.deviceName(l.deviceId) ?? 'Removed device' }));
    res.json({
      ...paginate(rows, {
        ...q,
        sort: q.sort || 'loggedAt',
        searchFields: ['description', 'eventType', 'deviceName', 'deviceId'],
        allowedSorts: ['loggedAt', 'eventType', 'status', 'deviceName'],
      }),
      eventTypes: [...new Set(logs.map((l) => l.eventType))].sort(),
      devices: lk.devices.map((d) => ({ id: d.id, deviceName: d.deviceName })),
    });
  }),
);

export default router;
