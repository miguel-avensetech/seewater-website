import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { addDays, startOfDay } from '../lib/time.js';
import { isoDate, parse, z } from '../lib/validate.js';
import { loadLookups } from '../services/lookups.js';
import { getSettings } from '../services/settings.js';
import { DEFAULT_RANGE_DAYS, usageReport } from '../services/usage.js';

const router = Router();

const query = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  houseId: z.string().optional(),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parse(query, req.query);
    const to = q.to ? new Date(`${q.to.slice(0, 10)}T23:59:59.999`) : new Date();
    const from = q.from ? startOfDay(new Date(`${q.from.slice(0, 10)}T00:00:00`)) : startOfDay(addDays(to, -(DEFAULT_RANGE_DAYS[q.period] - 1)));
    if (from > to) throw badRequest('Start date must be before end date.', { fields: { from: 'Start date must be before end date' } });
    if (to - from > 3 * 366 * 86400000) throw badRequest('Date range is limited to 3 years.');

    const [report, lk, settings] = await Promise.all([usageReport({ period: q.period, from, to, houseId: q.houseId }), loadLookups(), getSettings()]);

    res.json({
      ...report,
      dailyUsageWarningLiters: settings.dailyUsageWarningLiters,
      houses: report.houses
        .map((h) => {
          const status = h.dailyAverage >= settings.dailyUsageWarningLiters * 1.5 ? 'critical' : h.dailyAverage >= settings.dailyUsageWarningLiters ? 'high' : 'normal';
          return { ...h, ...lk.describeHouse(h.houseId), status };
        })
        .sort((a, b) => b.liters - a.liters),
    });
  }),
);

export default router;
