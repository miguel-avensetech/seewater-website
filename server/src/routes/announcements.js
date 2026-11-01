import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';
import { adminBucket } from '../lib/firebaseAdmin.js';

// Deletes an uploaded attachment from Firebase Storage (best effort).
async function deleteAttachment(path) {
  if (!path) return;
  await adminBucket().file(path).delete({ ignoreNotFound: true }).catch((err) => console.error('[storage] delete failed', path, err.message));
}

const router = Router();

// Categories from the manuscript (Fig. 32).
export const CATEGORIES = ['service_advisory', 'billing_notice', 'conservation_reminder', 'customer_tip'];

// Publishes scheduled announcements whose time has come. Called lazily on reads
// and by the background sweep in index.js.
export async function promoteScheduled() {
  const due = await db.list(C.announcements, { where: [['status', '==', 'scheduled']] });
  const now = nowIso();
  for (const a of due) {
    if (a.publishAt && a.publishAt <= now) {
      await db.update(C.announcements, a.id, { status: 'published', publishedAt: a.publishAt });
      await logSystem({ category: 'system_update', action: 'announcement_published', description: `Scheduled announcement "${a.title}" was published`, status: 'success' });
    }
  }
}

const dateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date and time');

const schema = z
  .object({
    title: trimmed(3, 100),
    message: trimmed(10, 5000),
    category: z.enum(CATEGORIES, { errorMap: () => ({ message: 'Choose a category' }) }),
    audience: z.enum(['all_users', 'specific_area']).default('all_users'),
    audienceArea: z.string().trim().max(150).optional().default(''),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    action: z.enum(['draft', 'publish', 'schedule']),
    publishAt: dateTime.optional().nullable(),
    attachmentUrl: z.string().trim().url('Enter a valid link (https://…)').or(z.literal('')).optional().default(''),
    // Set when the file was uploaded to Firebase Storage (announcements/…).
    attachmentPath: z.string().max(300).regex(/^announcements\//, 'Invalid attachment location').nullable().optional().default(null),
    attachmentName: z.string().max(200).nullable().optional().default(null),
    attachmentContentType: z.string().max(100).nullable().optional().default(null),
    attachmentSize: z.number().int().min(0).max(10 * 1024 * 1024).nullable().optional().default(null),
    interruption: z
      .object({ start: dateTime, end: dateTime, area: trimmed(2, 150) })
      .nullable()
      .optional()
      .default(null),
  })
  .superRefine((d, ctx) => {
    if (d.audience === 'specific_area' && !d.audienceArea) ctx.addIssue({ code: 'custom', path: ['audienceArea'], message: 'Enter the target area' });
    if (d.action === 'schedule') {
      if (!d.publishAt) ctx.addIssue({ code: 'custom', path: ['publishAt'], message: 'Choose when to publish' });
      else if (Date.parse(d.publishAt) <= Date.now()) ctx.addIssue({ code: 'custom', path: ['publishAt'], message: 'Must be in the future' });
    }
    if (d.interruption) {
      if (d.category !== 'service_advisory') ctx.addIssue({ code: 'custom', path: ['interruption'], message: 'Only service advisories can include an interruption' });
      if (Date.parse(d.interruption.end) <= Date.parse(d.interruption.start)) ctx.addIssue({ code: 'custom', path: ['interruption.end'], message: 'Must be after the start time' });
    }
  });

function toDoc(data) {
  const { action, publishAt, interruption, ...rest } = data;
  const status = action === 'publish' ? 'published' : action === 'schedule' ? 'scheduled' : 'draft';
  return {
    ...rest,
    status,
    publishAt: action === 'schedule' ? new Date(publishAt).toISOString() : null,
    publishedAt: action === 'publish' ? nowIso() : null,
    interruption: interruption ? { start: new Date(interruption.start).toISOString(), end: new Date(interruption.end).toISOString(), area: interruption.area } : null,
  };
}

const listSchema = listQuery.extend({
  status: z.enum(['draft', 'scheduled', 'published', 'archived']).optional(),
  category: z.enum(CATEGORIES).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await promoteScheduled();
    const q = parse(listSchema, req.query);
    const [all, admins] = await Promise.all([db.list(C.announcements), db.list(C.admins)]);
    const adminName = new Map(admins.map((a) => [a.id, a.fullName]));
    const rows = all
      .filter((a) => !q.status || a.status === q.status)
      .filter((a) => !q.category || a.category === q.category)
      .map((a) => ({ ...a, authorName: adminName.get(a.adminId) ?? 'Unknown' }));
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'createdAt', searchFields: ['title', 'message', 'audienceArea'], allowedSorts: ['createdAt', 'title', 'publishedAt', 'publishAt', 'priority'] }),
      summary: {
        total: all.length,
        published: all.filter((a) => a.status === 'published').length,
        scheduled: all.filter((a) => a.status === 'scheduled').length,
        drafts: all.filter((a) => a.status === 'draft').length,
      },
    });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = parse(schema, req.body);
    const doc = await db.create(C.announcements, { ...toDoc(data), adminId: req.admin.id, createdAt: nowIso(), updatedAt: nowIso() });
    await logSystem({ category: 'admin_action', action: `announcement_${doc.status}`, description: `${doc.status === 'draft' ? 'Saved draft' : doc.status === 'scheduled' ? 'Scheduled' : 'Published'} announcement "${doc.title}"`, status: 'success', actor: req.admin });
    res.status(201).json(doc);
  }),
);

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.announcements, req.params.id);
    if (!existing) throw notFound('Announcement');
    const data = parse(schema, req.body);
    const next = toDoc(data);
    // Keep the original publish time when editing an already-published announcement.
    if (existing.status === 'published' && next.status === 'published') next.publishedAt = existing.publishedAt;
    const updated = await db.update(C.announcements, existing.id, { ...next, updatedAt: nowIso() });
    if (existing.attachmentPath && existing.attachmentPath !== next.attachmentPath) await deleteAttachment(existing.attachmentPath);
    await logSystem({ category: 'admin_action', action: 'announcement_updated', description: `Updated announcement "${updated.title}"`, status: 'info', actor: req.admin });
    res.json(updated);
  }),
);

router.post(
  '/:id/archive',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.announcements, req.params.id);
    if (!existing) throw notFound('Announcement');
    if (existing.status === 'archived') throw badRequest('Already archived.');
    const updated = await db.update(C.announcements, existing.id, { status: 'archived', archivedAt: nowIso() });
    await logSystem({ category: 'admin_action', action: 'announcement_archived', description: `Archived announcement "${existing.title}"`, status: 'info', actor: req.admin });
    res.json(updated);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.announcements, req.params.id);
    if (!existing) throw notFound('Announcement');
    await db.remove(C.announcements, existing.id);
    await deleteAttachment(existing.attachmentPath);
    await logSystem({ category: 'admin_action', action: 'announcement_deleted', description: `Deleted announcement "${existing.title}"`, status: 'warning', actor: req.admin });
    res.status(204).end();
  }),
);

export default router;
