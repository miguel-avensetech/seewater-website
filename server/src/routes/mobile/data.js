import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, C } from '../../db/index.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { addDays, nowIso, startOfDay } from '../../lib/time.js';
import { isoDate, parse, trimmed, z } from '../../lib/validate.js';
import { paginate } from '../../lib/paginate.js';
import { logDevice, logSystem, logUserManagement } from '../../services/activity.js';
import { deviceSnapshots, homeOverview, continuousFlowMinutes, interruptionsForUser } from '../../services/homeownerViews.js';
import { ownedScope } from '../../services/homeowners.js';
import { getSettings } from '../../services/settings.js';
import { DEFAULT_RANGE_DAYS, loadDailyUsage, usageReport } from '../../services/usage.js';
import { computeCharge, LITERS_PER_M3, withRateStatus } from '../rates.js';
import { markCodeUsed, resolveActivationCode } from '../../services/activationCodes.js';
import { acknowledgeValveCommand, cancelValveCommand, recentValveCommands, requestValveCommand } from '../../services/valves.js';

const router = Router();

// Ownership scope resolved once per request from the authenticated user.
router.use(
  asyncHandler(async (req, _res, next) => {
    req.scope = await ownedScope(req.user.id);
    next();
  }),
);

// ── Home ────────────────────────────────────────────────────────────────────
router.get('/home', asyncHandler(async (req, res) => res.json(await homeOverview(req.user, req.scope))));

// ── Devices & activation ────────────────────────────────────────────────────
router.get(
  '/devices',
  asyncHandler(async (req, res) => {
    res.json({ items: await deviceSnapshots(req.scope, await getSettings()) });
  }),
);

const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'Too many activation attempts. Please wait 15 minutes and try again.' } } });

const linkSchema = z.object({
  activationCode: z.string().trim().toUpperCase().regex(/^SW-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Codes look like SW-XXXX-XXXX'),
  address: z.string().trim().max(300).optional().default(''),
});

/**
 * Links an admin-registered device to the signed-in homeowner.
 * - The code is validated on the server and can be used for one homeowner link.
 * - A device MCWD already assigned to another homeowner's household cannot be claimed.
 * - Unassigned devices are attached to the homeowner's household (created if needed).
 * Hardware activation (ESP32 → /api/device-api/activate) is a separate, one-time step.
 */
router.post(
  '/devices/link',
  linkLimiter,
  asyncHandler(async (req, res) => {
    const { activationCode, address } = parse(linkSchema, req.body);
    const invalid = () => badRequest('Please correct the highlighted fields.', { fields: { activationCode: 'This activation code is not valid. Check it and try again.' } });
    const { device, error } = await resolveActivationCode(activationCode, 'homeowner');
    if (error === 'used') {
      const record = await db.get(C.activationCodes, activationCode);
      const linked = record && (await db.get(C.devices, record.deviceId));
      throw conflict(linked?.linkedUserId === req.user.id ? 'This device is already linked to your account.' : 'This activation code has already been used.');
    }
    if (error === 'expired') throw badRequest('Please correct the highlighted fields.', { fields: { activationCode: 'This code has expired. Ask MCWD for a new activation code.' } });
    if (error) throw invalid();
    if (device.linkedUserId) throw conflict(device.linkedUserId === req.user.id ? 'This device is already linked to your account.' : 'This activation code has already been used.');

    let house = device.houseId ? await db.get(C.houses, device.houseId) : null;
    if (house && house.userId !== req.user.id) {
      throw forbidden('This device is registered to a different household. Please contact MCWD to have it reassigned.');
    }
    if (!house) {
      house = req.scope.houses[0];
      if (!house) {
        const addr = address || req.user.address;
        if (!addr || addr.length < 5) throw badRequest('Please correct the highlighted fields.', { fields: { address: 'Enter the address where the device is installed' } });
        const lastName = req.user.fullName.trim().split(/\s+/).at(-1);
        house = await db.create(C.houses, { userId: req.user.id, houseName: `${lastName} Residence`, address: addr, installationDate: nowIso().slice(0, 10), houseStatus: 'monitored', createdAt: nowIso(), createdVia: 'mobile_app' });
      }
    }

    await db.update(C.devices, device.id, { houseId: house.id, linkedUserId: req.user.id, linkedAt: nowIso() });
    await markCodeUsed(activationCode, 'homeowner', req.user.id);
    for (const s of await db.list(C.sensors, { where: [['deviceId', '==', device.id]] })) await db.update(C.sensors, s.id, { houseId: house.id });
    for (const v of await db.list(C.valves, { where: [['deviceId', '==', device.id]] })) await db.update(C.valves, v.id, { houseId: house.id });
    if (house.houseStatus === 'pending_installation') await db.update(C.houses, house.id, { houseStatus: 'monitored' });

    await logDevice({ deviceId: device.id, eventType: 'linked_to_homeowner', description: `Linked to ${req.user.fullName}'s account (${house.houseName}) via the mobile app`, status: 'success', source: 'system' });
    await logSystem({ category: 'admin_action', action: 'device_linked_by_homeowner', description: `${req.user.fullName} linked ${device.deviceName} using its activation code`, status: 'success', deviceId: device.id, houseId: house.id });
    await logUserManagement({ admin: { id: null }, userId: req.user.id, actionType: 'device_linked', remarks: `${device.deviceName} linked via mobile app` });

    const scope = await ownedScope(req.user.id);
    const snapshots = await deviceSnapshots(scope, await getSettings());
    res.status(201).json({ device: snapshots.find((d) => d.id === device.id) });
  }),
);

// ── Monitoring ──────────────────────────────────────────────────────────────
router.get(
  '/monitoring',
  asyncHandler(async (req, res) => {
    const { minutes } = parse(z.object({ minutes: z.coerce.number().int().min(15).max(1440).default(60) }), req.query);
    const settings = await getSettings();
    const since = new Date(Date.now() - Math.max(minutes, 180) * 60000).toISOString();
    const [devices, readings, logs] = await Promise.all([
      deviceSnapshots(req.scope, settings),
      req.scope.devices.length ? db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]], orderBy: ['recordedAt', 'asc'] }) : [],
      req.scope.devices.length ? db.list(C.deviceLogs, { orderBy: ['loggedAt', 'desc'], limit: 400 }) : [],
    ]);
    const own = readings.filter((r) => req.scope.ownsDevice(r.deviceId));
    const windowStart = new Date(Date.now() - minutes * 60000).toISOString();

    // Liters per hour for today, from flow readings.
    const todayStart = startOfDay().toISOString();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, liters: 0 }));
    const todays = own.filter((r) => r.readingType === 'flow' && r.recordedAt >= todayStart && r.waterUsage != null);
    for (const r of todays) hourly[new Date(r.recordedAt).getHours()].liters += r.waterUsage;

    const online = devices.filter((d) => d.connectionStatus === 'online').map((d) => d.id);
    res.json({
      units: { flow: 'L/min', usage: 'L' },
      devices,
      readings: own
        .filter((r) => r.recordedAt >= windowStart)
        .map(({ deviceId, readingType, flowRate, vibrationLevel, waterUsage, recordedAt, source }) => ({ deviceId, readingType, flowRate, vibrationLevel, waterUsage, recordedAt, source })),
      sources: [...new Set(own.map((r) => r.source))],
      hourlyToday: todays.length ? hourly.slice(0, new Date().getHours() + 1) : [],
      continuousFlowMinutes: online.length ? continuousFlowMinutes(own.filter((r) => r.readingType === 'flow' && online.includes(r.deviceId)), settings.leakMinFlowLpm) : null,
      leakMinFlowRate: settings.leakMinFlowLpm,
      activity: logs
        .filter((l) => req.scope.ownsDevice(l.deviceId))
        .slice(0, 15)
        .map(({ id, eventType, description, status, loggedAt, source }) => ({ id, eventType, description, status, loggedAt, source })),
    });
  }),
);

// ── Leak detection & alerts ─────────────────────────────────────────────────
const alertsQuery = z.object({
  type: z.enum(['possible_leak', 'high_flow', 'device_offline']).optional(),
  status: z.enum(['active', 'resolved']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const publicAlert = (a, deviceName) => ({
  id: a.id,
  alertType: a.alertType,
  severityLevel: a.severityLevel,
  alertStatus: a.alertStatus,
  description: a.description,
  sensorLocation: a.possibleLeakArea ?? null,
  metrics: a.metrics ?? null,
  deviceId: a.deviceId,
  deviceName,
  createdAt: a.createdAt,
  acknowledgedAt: a.acknowledgedAt ?? null,
  resolvedAt: a.resolvedAt ?? null,
  resolutionNote: a.resolutionNote ?? null,
  source: a.source ?? 'device',
});

router.get(
  '/alerts',
  asyncHandler(async (req, res) => {
    const q = parse(alertsQuery, req.query);
    const names = new Map(req.scope.devices.map((d) => [d.id, d.deviceName]));
    const all = (await db.list(C.alerts, { orderBy: ['createdAt', 'desc'], limit: 2000 })).filter((a) => req.scope.ownsHouse(a.houseId));
    const rows = all
      .filter((a) => !q.type || a.alertType === q.type)
      .filter((a) => !q.status || (q.status === 'active' ? a.alertStatus !== 'resolved' : a.alertStatus === 'resolved'))
      .map((a) => publicAlert(a, names.get(a.deviceId) ?? null));
    const active = all.filter((a) => a.alertStatus !== 'resolved');
    res.json({
      ...paginate(rows, { page: q.page, pageSize: q.pageSize }),
      summary: { active: active.length, leaks: active.filter((a) => a.alertType === 'possible_leak').length, highFlow: active.filter((a) => a.alertType === 'high_flow').length },
    });
  }),
);

router.get(
  '/alerts/:id',
  asyncHandler(async (req, res) => {
    const alert = await db.get(C.alerts, req.params.id);
    if (!alert || !req.scope.ownsHouse(alert.houseId)) throw notFound('Alert');
    const device = req.scope.devices.find((d) => d.id === alert.deviceId);
    const sensor = alert.sensorId ? await db.get(C.sensors, alert.sensorId) : null;
    const t = Date.parse(alert.createdAt);
    const from = new Date(t - 30 * 60000).toISOString();
    const to = new Date(t + 30 * 60000).toISOString();
    const readings = (await db.list(C.sensorReadings, { where: [['recordedAt', '>=', from]], orderBy: ['recordedAt', 'asc'] })).filter((r) => r.deviceId === alert.deviceId && r.recordedAt <= to);
    res.json({
      alert: publicAlert(alert, device?.deviceName ?? null),
      sensor: sensor && { id: sensor.id, sensorType: sensor.sensorType, location: sensor.sensorLocation, model: sensor.model ?? null },
      readings: readings.map(({ readingType, flowRate, vibrationLevel, recordedAt, source }) => ({ readingType, flowRate, vibrationLevel, recordedAt, source })),
    });
  }),
);

router.post(
  '/alerts/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const alert = await db.get(C.alerts, req.params.id);
    if (!alert || !req.scope.ownsHouse(alert.houseId)) throw notFound('Alert');
    if (alert.alertStatus !== 'open') throw conflict('This alert has already been acknowledged or resolved.');
    const updated = await db.update(C.alerts, alert.id, { alertStatus: 'acknowledged', acknowledgedAt: nowIso(), acknowledgedByHomeowner: req.user.id });
    await logSystem({ category: alert.alertType === 'possible_leak' ? 'possible_leak' : alert.alertType === 'high_flow' ? 'high_flow' : 'connectivity', action: 'alert_acknowledged_by_homeowner', description: `${req.user.fullName} acknowledged a ${alert.alertType.replace('_', ' ')} alert in the mobile app`, status: 'info', deviceId: alert.deviceId, houseId: alert.houseId });
    res.json(publicAlert(updated, null));
  }),
);

// ── Notifications ───────────────────────────────────────────────────────────
const ALERT_TYPES = ['possible_leak', 'high_flow', 'device_offline', 'usage_threshold'];
const notifQuery = z.object({
  filter: z.enum(['all', 'unread', 'alerts', 'system']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

async function ownNotification(req) {
  const n = await db.get(C.notifications, req.params.id);
  if (!n || n.userId !== req.user.id) throw notFound('Notification');
  return n;
}

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const q = parse(notifQuery, req.query);
    const all = (await db.list(C.notifications, { where: [['userId', '==', req.user.id]] })).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const rows = all.filter((n) => q.filter === 'all' || (q.filter === 'unread' ? !n.isRead : q.filter === 'alerts' ? ALERT_TYPES.includes(n.notificationType) : !ALERT_TYPES.includes(n.notificationType)));
    res.json({ ...paginate(rows, { page: q.page, pageSize: q.pageSize }), unreadCount: all.filter((n) => !n.isRead).length });
  }),
);

router.get(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const n = await ownNotification(req);
    const updated = n.isRead ? n : await db.update(C.notifications, n.id, { isRead: true, readAt: nowIso() });
    res.json(updated);
  }),
);

router.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const unread = (await db.list(C.notifications, { where: [['userId', '==', req.user.id]] })).filter((n) => !n.isRead);
    for (const n of unread) await db.update(C.notifications, n.id, { isRead: true, readAt: nowIso() });
    res.json({ updated: unread.length });
  }),
);

router.delete(
  '/notifications/:id',
  asyncHandler(async (req, res) => {
    const n = await ownNotification(req);
    await db.remove(C.notifications, n.id);
    res.status(204).end();
  }),
);

// Clears the homeowner's notification inbox. Alert records themselves are kept.
router.delete(
  '/notifications',
  asyncHandler(async (req, res) => {
    const all = await db.list(C.notifications, { where: [['userId', '==', req.user.id]] });
    for (const n of all) await db.remove(C.notifications, n.id);
    res.json({ removed: all.length });
  }),
);

// ── Announcements (MCWD advisories) ─────────────────────────────────────────
router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const published = await db.list(C.announcements, { where: [['status', '==', 'published']] });
    const areas = [req.user.address, ...req.scope.houses.map((h) => h.address)].filter(Boolean).join(' ').toLowerCase();
    const visible = published.filter((a) => a.audience === 'all_users' || (a.audienceArea && a.audienceArea.toLowerCase().split(/[,;]/).some((t) => t.trim() && areas.includes(t.trim()))));
    res.json({
      items: visible
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, 30)
        .map(({ id, title, message, category, priority, publishedAt, interruption, attachmentUrl, attachmentName }) => ({ id, title, message, category, priority, publishedAt, interruption, attachmentUrl, attachmentName: attachmentName ?? null })),
    });
  }),
);

// ── Water interruptions (from Admin → Interruptions) ────────────────────────
router.get('/interruptions', asyncHandler(async (req, res) => res.json({ items: await interruptionsForUser(req.user, req.scope) })));

// ── Water rates (from Admin → Rates) ────────────────────────────────────────
// Homeowners are on the residential schedule. The estimate uses SeeWater
// readings and is never presented as an official MCWD bill.
const publicRate = ({ id, name, customerClass, effectiveDate, minimumVolumeM3, minimumCharge, tiers, notes, publishedAt, status }) => ({ id, name, customerClass, effectiveDate, minimumVolumeM3, minimumCharge, tiers, notes, publishedAt, status });

router.get(
  '/rates',
  asyncHandler(async (req, res) => {
    const customerClass = 'residential';
    const [rates, announcements] = await Promise.all([db.list(C.waterRates), db.list(C.announcements, { where: [['status', '==', 'published']] })]);
    const published = withRateStatus(rates).filter((r) => r.publishedAt && r.customerClass === customerClass);
    const active = published.find((r) => r.status === 'active') ?? null;

    let estimate = null;
    if (active && req.scope.houseIds.size) {
      const now = new Date();
      const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const rows = (await loadDailyUsage(monthStart, now)).filter((r) => req.scope.ownsHouse(r.houseId));
      const liters = rows.reduce((s, r) => s + r.litersUsed, 0);
      const cubicMeters = liters / LITERS_PER_M3;
      estimate = {
        from: monthStart.toISOString(),
        to: now.toISOString(),
        liters,
        cubicMeters,
        hasData: rows.length > 0,
        sources: [...new Set(rows.map((r) => r.source))],
        ...computeCharge(active, cubicMeters),
        disclaimer: 'Estimate from SeeWater meter readings — not an official MCWD bill.',
      };
    }

    res.json({
      customerClass,
      active: active && publicRate(active),
      upcoming: published.filter((r) => r.status === 'scheduled').sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate)).map(publicRate),
      previous: published.filter((r) => r.status === 'superseded').sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)).slice(0, 3).map(publicRate),
      notices: announcements
        .filter((a) => a.category === 'billing_notice')
        .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
        .slice(0, 5)
        .map(({ id, title, message, publishedAt }) => ({ id, title, message, publishedAt })),
      estimate,
    });
  }),
);

// ── Insights ────────────────────────────────────────────────────────────────
const insightsQuery = z.object({ period: z.enum(['daily', 'weekly', 'monthly']).default('daily'), from: isoDate.optional(), to: isoDate.optional() });

router.get(
  '/insights',
  asyncHandler(async (req, res) => {
    const q = parse(insightsQuery, req.query);
    const to = q.to ? new Date(`${q.to.slice(0, 10)}T23:59:59.999`) : new Date();
    const from = q.from ? startOfDay(new Date(`${q.from.slice(0, 10)}T00:00:00`)) : startOfDay(addDays(to, -(DEFAULT_RANGE_DAYS[q.period] - 1)));
    if (from > to) throw badRequest('Start date must be before end date.');
    if (to - from > 2 * 366 * 86400000) throw badRequest('Date range is limited to 2 years.');
    const { houses, ...report } = await usageReport({ period: q.period, from, to, houseIds: req.scope.houseIds });
    res.json({ ...report, hasDevice: req.scope.devices.length > 0 });
  }),
);

// ── Valve control ───────────────────────────────────────────────────────────
async function ownValve(req) {
  const valve = await db.get(C.valves, req.params.id);
  if (!valve || !req.scope.ownsDevice(valve.deviceId)) throw notFound('Valve');
  return valve;
}

router.get(
  '/valves',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const devices = await deviceSnapshots(req.scope, settings);
    const items = await Promise.all(
      devices
        .filter((d) => d.valve)
        .map(async (d) => ({
          ...d.valve,
          device: { id: d.id, deviceName: d.deviceName, connectionStatus: d.connectionStatus, lastOnline: d.lastOnline, isSimulated: d.isSimulated, house: d.house },
          currentFlowRate: d.flow?.flowRate ?? null,
          commands: (await recentValveCommands(d.valve.id, 10)).map(({ id, action, emergency, requestedByType, requestedByName, status, requestedAt, respondedAt, positionConfirmed, failureReason }) => ({
            id, action, emergency, requestedByType, requestedByName: requestedByType === 'admin' ? 'MCWD administrator' : requestedByName, status, requestedAt, respondedAt, positionConfirmed, failureReason,
          })),
        })),
    );
    res.json({
      items,
      autoShutoffEnabled: settings.autoShutoffOnCriticalLeak,
      // The manuscript's ESP32 + relay design reports relay switching only.
      positionFeedbackAvailable: items.some((v) => v.positionConfirmed),
    });
  }),
);

const commandSchema = z.object({
  action: z.enum(['close', 'open']),
  emergency: z.boolean().default(false),
  reason: z.string().trim().max(300).optional().default(''),
});

router.post(
  '/valves/:id/command',
  asyncHandler(async (req, res) => {
    const valve = await ownValve(req);
    const data = parse(commandSchema, req.body);
    if (data.emergency && data.action !== 'close') throw badRequest('Emergency commands can only stop the water.');
    const updated = await requestValveCommand({
      valveId: valve.id,
      action: data.action,
      reason: data.reason || (data.emergency ? 'Emergency stop from mobile app' : 'Manual control from mobile app'),
      actor: { id: req.user.id, fullName: req.user.fullName },
      actorType: 'homeowner',
      emergency: data.emergency,
    });
    res.status(202).json({ id: updated.id, commandStatus: updated.commandStatus, requestedState: updated.requestedState, requestedAt: updated.requestedAt, command: { id: updated.command.id, status: updated.command.status } });
  }),
);

router.post(
  '/valves/:id/cancel',
  asyncHandler(async (req, res) => {
    const valve = await ownValve(req);
    const updated = await cancelValveCommand({ valve, actor: { id: req.user.id, fullName: req.user.fullName }, actorType: 'homeowner' });
    res.json({ id: updated.id, commandStatus: updated.commandStatus });
  }),
);

// Sample devices only: stands in for the ESP32 response so the flow can be
// demonstrated without hardware. Real devices must answer through the device API.
router.post(
  '/valves/:id/simulate-ack',
  asyncHandler(async (req, res) => {
    const valve = await ownValve(req);
    const device = req.scope.devices.find((d) => d.id === valve.deviceId);
    if (!device?.isSimulated) throw conflict('Only simulated sample devices can be acknowledged from the app.');
    const updated = await acknowledgeValveCommand({ valve, commandId: valve.commandId, state: valve.requestedState, success: true, positionConfirmed: false });
    res.json({ id: updated.id, status: updated.status, commandStatus: updated.commandStatus });
  }),
);

// ── Feedback (appears in Admin → Feedback) ──────────────────────────────────
router.get(
  '/feedback',
  asyncHandler(async (req, res) => {
    const rows = (await db.list(C.feedback, { where: [['userId', '==', req.user.id]] })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ items: rows.map(({ id, type, subject, message, status, response, respondedAt, createdAt }) => ({ id, type, subject, message, status, response: response ?? null, respondedAt: respondedAt ?? null, createdAt })) });
  }),
);

router.post(
  '/feedback',
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ type: z.enum(['suggestion', 'complaint', 'report']), subject: trimmed(3, 120), message: trimmed(10, 2000) }), req.body);
    const fb = await db.create(C.feedback, { ...data, userId: req.user.id, status: 'new', source: 'mobile_app', createdAt: nowIso() });
    res.status(201).json({ id: fb.id, status: fb.status });
  }),
);

export default router;
