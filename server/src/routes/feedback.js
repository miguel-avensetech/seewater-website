import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { listQuery, parse, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';
import { notifyUser } from '../services/notify.js';

const router = Router();

const STATUSES = ['new', 'in_review', 'resolved', 'closed'];

const listSchema = listQuery.extend({
  status: z.enum(STATUSES).optional(),
  type: z.enum(['suggestion', 'complaint', 'report']).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const [items, users] = await Promise.all([db.list(C.feedback), db.list(C.users)]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const rows = items
      .filter((f) => !q.status || f.status === q.status)
      .filter((f) => !q.type || f.type === q.type)
      .map((f) => {
        const u = userById.get(f.userId);
        return { ...f, userName: u?.fullName ?? 'Unknown user', userEmail: u?.email ?? null, userAddress: u?.address ?? null };
      });
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'createdAt', searchFields: ['subject', 'message', 'userName', 'userEmail'], allowedSorts: ['createdAt', 'status', 'type', 'userName'] }),
      summary: Object.fromEntries(STATUSES.map((s) => [s, items.filter((f) => f.status === s).length])),
    });
  }),
);

const updateSchema = z
  .object({
    status: z.enum(STATUSES),
    response: z.string().trim().max(2000).optional().default(''),
  })
  .refine((d) => d.status !== 'resolved' || d.response.length >= 5, { path: ['response'], message: 'Write a response to the homeowner before resolving' });

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const existing = await db.get(C.feedback, req.params.id);
    if (!existing) throw notFound('Feedback');
    const data = parse(updateSchema, req.body);
    const patch = { status: data.status, updatedAt: nowIso() };
    if (data.response && data.response !== existing.response) {
      Object.assign(patch, { response: data.response, respondedAt: nowIso(), respondedBy: req.admin.id, respondedByName: req.admin.fullName });
      // Deliver the reply to the homeowner's in-app notifications (NOTIFICATION table).
      await notifyUser(existing.userId, {
        title: `Reply to your ${existing.type}: ${existing.subject}`,
        message: data.response,
        notificationType: 'feedback_response',
        data: { feedbackId: existing.id },
      });
    }
    const updated = await db.update(C.feedback, existing.id, patch);
    await logSystem({ category: 'admin_action', action: 'feedback_updated', description: `Feedback "${existing.subject}" marked ${data.status.replace('_', ' ')}`, status: 'info', actor: req.admin });
    res.json(updated);
  }),
);

export default router;
