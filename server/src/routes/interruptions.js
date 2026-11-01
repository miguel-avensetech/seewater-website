import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';
import { notifyUser } from '../services/notify.js';

// Water interruptions (collection: waterInterruptions). Status is derived from
// the schedule so it is always current:
//   cancelled → cancelled · restored or past end → completed · started → ongoing · else scheduled
const router = Router();

export function interruptionStatus(i, now = nowIso()) {
  if (i.cancelledAt) return 'cancelled';
  if (i.restoredAt || (i.endAt && i.endAt <= now)) return 'completed';
  if (i.startAt <= now) return 'ongoing';
  return 'scheduled';
}

// Used by the dashboard: ongoing and upcoming interruptions.
export async function activeInterruptions() {
  const all = await db.list(C.waterInterruptions);
  return all
    .map((i) => ({ ...i, status: interruptionStatus(i) }))
    .filter((i) => i.status === 'ongoing' || i.status === 'scheduled')
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((i) => ({ id: i.id, title: i.title, area: i.areas, start: i.startAt, end: i.endAt, type: i.type, ongoing: i.status === 'ongoing' }));
}

const dateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time');

const schema = z
  .object({
    title: trimmed(3, 120),
    type: z.enum(['planned', 'emergency']),
    reason: trimmed(5, 1000),
    areas: trimmed(2, 300),
    startAt: dateTime,
    endAt: dateTime.nullable().optional().default(null),
    notes: z.string().trim().max(1000).optional().default(''),
    // Publish a linked service advisory + notify homeowners in the affected areas.
    notifyHomeowners: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.type === 'planned' && !d.endAt) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Planned interruptions need an expected end time' });
    if (d.endAt && Date.parse(d.endAt) <= Date.parse(d.startAt)) ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'Must be after the start time' });
  });

const toIso = (v) => (v ? new Date(v).toISOString() : null);

// Homeowners whose address mentions any listed area (comma-separated).
async function affectedUsers(areas) {
  const tokens = areas.toLowerCase().split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  const [users, houses] = await Promise.all([db.list(C.users), db.list(C.houses)]);
  const housesByUser = Map.groupBy(houses, (h) => h.userId);
  return users.filter((u) => u.status === 'active' && [u.address, ...(housesByUser.get(u.id) ?? []).map((h) => h.address)].filter(Boolean).some((a) => tokens.some((t) => a.toLowerCase().includes(t))));
}

async function publishAdvisory(interruption, admin, existingId) {
  const doc = {
    title: interruption.title,
    message: `${interruption.reason}\n\nAffected areas: ${interruption.areas}`,
    category: 'service_advisory',
    audience: 'specific_area',
    audienceArea: interruption.areas,
    priority: interruption.type === 'emergency' ? 'urgent' : 'high',
    status: 'published',
    publishAt: null,
    publishedAt: nowIso(),
    attachmentUrl: '',
    interruptionId: interruption.id,
    // Mirrored so the mobile app can show the window on the advisory.
    interruption: { start: interruption.startAt, end: interruption.endAt, area: interruption.areas },
    adminId: admin.id,
    updatedAt: nowIso(),
  };
  if (existingId && (await db.get(C.announcements, existingId))) return db.update(C.announcements, existingId, doc);
  return db.create(C.announcements, { ...doc, createdAt: nowIso() });
}

const listSchema = listQuery.extend({
  status: z.enum(['scheduled', 'ongoing', 'completed', 'cancelled']).optional(),
  type: z.enum(['planned', 'emergency']).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const all = (await db.list(C.waterInterruptions)).map((i) => ({ ...i, status: interruptionStatus(i) }));
    const rows = all.filter((i) => (!q.status || i.status === q.status) && (!q.type || i.type === q.type));
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'startAt', searchFields: ['title', 'areas', 'reason'], allowedSorts: ['startAt', 'endAt', 'title', 'createdAt'] }),
      summary: Object.fromEntries(['scheduled', 'ongoing', 'completed', 'cancelled'].map((s) => [s, all.filter((i) => i.status === s).length])),
    });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { notifyHomeowners, ...data } = parse(schema, req.body);
    let item = await db.create(C.waterInterruptions, { ...data, startAt: toIso(data.startAt), endAt: toIso(data.endAt), restoredAt: null, cancelledAt: null, announcementId: null, createdBy: req.admin.id, createdAt: nowIso(), updatedAt: nowIso() });
    let notified = 0;
    if (notifyHomeowners) {
      const advisory = await publishAdvisory(item, req.admin);
      item = await db.update(C.waterInterruptions, item.id, { announcementId: advisory.id });
      for (const u of await affectedUsers(item.areas)) {
        await notifyUser(u.id, { title: `${item.type === 'emergency' ? 'Emergency' : 'Scheduled'} water interruption`, message: `${item.title} — ${item.areas}.`, notificationType: 'interruption', data: { interruptionId: item.id } });
        notified++;
      }
    }
    await logSystem({ category: 'system_update', action: 'interruption_created', description: `${item.type === 'emergency' ? 'Emergency' : 'Planned'} interruption: ${item.title} (${item.areas})`, status: item.type === 'emergency' ? 'warning' : 'info', actor: req.admin });
    res.status(201).json({ ...item, status: interruptionStatus(item), notified });
  }),
);

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.waterInterruptions, req.params.id);
    if (!existing) throw notFound('Interruption');
    if (existing.cancelledAt) throw conflict('Cancelled interruptions cannot be edited.');
    const { notifyHomeowners, ...data } = parse(schema, req.body);
    let item = await db.update(C.waterInterruptions, existing.id, { ...data, startAt: toIso(data.startAt), endAt: toIso(data.endAt), updatedAt: nowIso() });
    if (existing.announcementId || notifyHomeowners) {
      const advisory = await publishAdvisory(item, req.admin, existing.announcementId);
      if (advisory.id !== existing.announcementId) item = await db.update(C.waterInterruptions, item.id, { announcementId: advisory.id });
    }
    await logSystem({ category: 'system_update', action: 'interruption_updated', description: `Updated interruption: ${item.title}`, status: 'info', actor: req.admin });
    res.json({ ...item, status: interruptionStatus(item) });
  }),
);

const closeSchema = z.object({ action: z.enum(['restore', 'cancel']), note: z.string().trim().max(500).optional().default('') });

// Marks service restored, or cancels an interruption that won't happen.
router.post(
  '/:id/close',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.waterInterruptions, req.params.id);
    if (!existing) throw notFound('Interruption');
    const { action, note } = parse(closeSchema, req.body);
    const status = interruptionStatus(existing);
    if (status === 'cancelled' || status === 'completed') throw conflict(`This interruption is already ${status}.`);
    if (action === 'restore' && status !== 'ongoing') throw badRequest('Only an ongoing interruption can be marked restored. Cancel it instead.');
    const patch = action === 'restore' ? { restoredAt: nowIso(), closeNote: note } : { cancelledAt: nowIso(), closeNote: note };
    const item = await db.update(C.waterInterruptions, existing.id, { ...patch, updatedAt: nowIso() });
    if (existing.announcementId) {
      await db.update(C.announcements, existing.announcementId, { status: 'archived', archivedAt: nowIso() }).catch(() => {});
    }
    await logSystem({ category: 'system_update', action: action === 'restore' ? 'interruption_restored' : 'interruption_cancelled', description: `${existing.title}: ${action === 'restore' ? 'water service restored' : 'cancelled'}`, status: 'success', actor: req.admin });
    res.json({ ...item, status: interruptionStatus(item) });
  }),
);

export default router;
