import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { nowIso, startOfDay } from '../lib/time.js';
import { listQuery, parse, trimmed, z } from '../lib/validate.js';
import { paginate } from '../lib/paginate.js';
import { requireRole } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';
import { loadDailyUsage } from '../services/usage.js';

// Water rate schedules (collection: waterRates).
//
// Tariffs are published in ₱ per cubic metre (m³), as on MCWD bills; SeeWater
// measures in liters, so conversions are explicit (1 m³ = 1,000 L).
// This module manages rate information only (admins don't post billing notices). It does
// NOT produce official bills or process payments; estimates are labelled as such.

const router = Router();
export const LITERS_PER_M3 = 1000;

const CLASSES = ['residential', 'commercial', 'government', 'industrial'];

// draft · scheduled (published, effective later) · active (latest effective) · superseded
export function withRateStatus(rates, now = nowIso()) {
  const latestActive = new Map();
  for (const r of rates) {
    if (!r.publishedAt || r.effectiveDate > now) continue;
    const cur = latestActive.get(r.customerClass);
    if (!cur || r.effectiveDate > cur.effectiveDate) latestActive.set(r.customerClass, r);
  }
  return rates.map((r) => ({
    ...r,
    status: !r.publishedAt ? 'draft' : r.effectiveDate > now ? 'scheduled' : latestActive.get(r.customerClass)?.id === r.id ? 'active' : 'superseded',
  }));
}

// Charge for a volume: minimum charge covers the first `minimumVolumeM3`, then tiers.
export function computeCharge(rate, cubicMeters) {
  let total = rate.minimumCharge;
  const lines = [{ label: `First ${rate.minimumVolumeM3} m³ (minimum charge)`, m3: Math.min(cubicMeters, rate.minimumVolumeM3), amount: rate.minimumCharge }];
  for (const t of rate.tiers) {
    const upper = t.toM3 ?? Infinity;
    const used = Math.max(0, Math.min(cubicMeters, upper) - t.fromM3);
    if (used <= 0) continue;
    const amount = used * t.ratePerM3;
    total += amount;
    lines.push({ label: `${t.fromM3}–${t.toM3 ?? '∞'} m³ @ ₱${t.ratePerM3.toFixed(2)}`, m3: used, amount });
  }
  return { total, lines };
}

const money = z.coerce.number().min(0, 'Must be 0 or more').max(100000);

const schema = z
  .object({
    name: trimmed(3, 120),
    customerClass: z.enum(CLASSES),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the effective date'),
    minimumVolumeM3: z.coerce.number().int().min(0).max(1000),
    minimumCharge: money,
    tiers: z
      .array(z.object({ fromM3: z.coerce.number().min(0), toM3: z.coerce.number().positive().nullable(), ratePerM3: z.coerce.number().positive('Rate must be greater than 0').max(10000) }))
      .min(1, 'Add at least one tier')
      .max(12),
    notes: z.string().trim().max(1000).optional().default(''),
  })
  .superRefine((d, ctx) => {
    let expected = d.minimumVolumeM3;
    d.tiers.forEach((t, i) => {
      if (t.fromM3 !== expected) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'fromM3'], message: `Tier ${i + 1} must start at ${expected} m³` });
      const last = i === d.tiers.length - 1;
      if (last && t.toM3 !== null) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'toM3'], message: 'The last tier must be open-ended' });
      if (!last && (t.toM3 === null || t.toM3 <= t.fromM3)) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'toM3'], message: 'Must be above the tier start' });
      expected = t.toM3 ?? expected;
    });
  });

const listSchema = listQuery.extend({
  status: z.enum(['draft', 'scheduled', 'active', 'superseded']).optional(),
  customerClass: z.enum(CLASSES).optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(listSchema, req.query);
    const all = withRateStatus(await db.list(C.waterRates));
    const rows = all.filter((r) => (!q.status || r.status === q.status) && (!q.customerClass || r.customerClass === q.customerClass));
    res.json({
      ...paginate(rows, { ...q, sort: q.sort || 'effectiveDate', searchFields: ['name', 'notes'], allowedSorts: ['effectiveDate', 'name', 'createdAt'] }),
      active: all.filter((r) => r.status === 'active'),
      summary: Object.fromEntries(['draft', 'scheduled', 'active', 'superseded'].map((s) => [s, all.filter((r) => r.status === s).length])),
    });
  }),
);

router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const data = parse(schema, req.body);
    const rate = await db.create(C.waterRates, { ...data, publishedAt: null, createdBy: req.admin.id, createdAt: nowIso(), updatedAt: nowIso() });
    await logSystem({ category: 'system_update', action: 'rate_draft_created', description: `Rate schedule drafted: ${rate.name}`, status: 'info', actor: req.admin });
    res.status(201).json(withRateStatus([rate])[0]);
  }),
);

async function getDraft(id) {
  const rate = await db.get(C.waterRates, id);
  if (!rate) throw notFound('Rate schedule');
  if (rate.publishedAt) throw conflict('Published rate schedules can’t be changed. Create a new schedule instead.');
  return rate;
}

router.patch(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rate = await getDraft(req.params.id);
    const data = parse(schema, req.body);
    const updated = await db.update(C.waterRates, rate.id, { ...data, updatedAt: nowIso() });
    res.json(withRateStatus([updated])[0]);
  }),
);

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rate = await getDraft(req.params.id);
    await db.remove(C.waterRates, rate.id);
    res.status(204).end();
  }),
);

// Publishing makes the schedule official. Homeowners see it under Water rates.
router.post(
  '/:id/publish',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const rate = await getDraft(req.params.id);
    const updated = await db.update(C.waterRates, rate.id, { publishedAt: nowIso(), publishedBy: req.admin.id, updatedAt: nowIso() });
    await logSystem({ category: 'system_update', action: 'rate_published', description: `Rate schedule published: ${rate.name} (effective ${rate.effectiveDate})`, status: 'success', actor: req.admin });
    res.json(withRateStatus(await db.list(C.waterRates)).find((r) => r.id === updated.id));
  }),
);

// Estimated charge for a household's month-to-date (or given month) usage under
// the currently active schedule. Not an official bill.
router.get(
  '/estimate',
  asyncHandler(async (req, res) => {
    const { houseId, customerClass } = parse(z.object({ houseId: z.string().min(1, 'Choose a household'), customerClass: z.enum(CLASSES).default('residential') }), req.query);
    const house = await db.get(C.houses, houseId);
    if (!house) throw notFound('Household');
    const rate = withRateStatus(await db.list(C.waterRates)).find((r) => r.status === 'active' && r.customerClass === customerClass);
    if (!rate) throw badRequest(`There is no active ${customerClass} rate schedule yet. Publish one first.`);
    const now = new Date();
    const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const rows = (await loadDailyUsage(monthStart, now)).filter((r) => r.houseId === houseId);
    const liters = rows.reduce((s, r) => s + r.litersUsed, 0);
    const m3 = liters / LITERS_PER_M3;
    res.json({
      houseId,
      houseName: house.houseName,
      period: { from: monthStart.toISOString(), to: now.toISOString() },
      liters,
      cubicMeters: m3,
      hasData: rows.length > 0,
      sources: [...new Set(rows.map((r) => r.source))],
      rate: { id: rate.id, name: rate.name, effectiveDate: rate.effectiveDate },
      estimate: computeCharge(rate, m3),
      disclaimer: 'Estimate from SeeWater meter readings — not an official MCWD bill.',
    });
  }),
);

export default router;
