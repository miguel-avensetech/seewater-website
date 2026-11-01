import { db, C } from '../db/index.js';
import { addDays, dayKey, monthKey, startOfDay, weekKey } from '../lib/time.js';

// Aggregates WATER_USAGE daily summaries (liters) into daily / weekly / monthly buckets.

const bucketKey = { daily: dayKey, weekly: weekKey, monthly: monthKey };

export const DEFAULT_RANGE_DAYS = { daily: 14, weekly: 7 * 12, monthly: 365 };

function bucketsBetween(period, from, to) {
  const keys = [];
  const seen = new Set();
  for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) {
    const k = bucketKey[period](d);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

export async function loadDailyUsage(from, to) {
  // Single range filter on `date` (string YYYY-MM-DD) — no composite index needed.
  return db.list(C.waterUsage, {
    where: [
      ['date', '>=', dayKey(from)],
      ['date', '<=', dayKey(to)],
    ],
  });
}

export async function usageReport({ period, from, to, houseId, houseIds }) {
  const [docs, prevDocs] = await Promise.all([
    loadDailyUsage(from, to),
    loadDailyUsage(new Date(from.getTime() - (to - from) - 86400000), addDays(from, -1)),
  ]);
  const scope = (rows) => rows.filter((r) => (!houseId || r.houseId === houseId) && (!houseIds || houseIds.has(r.houseId)));
  const rows = scope(docs);
  const prevRows = scope(prevDocs);

  const keys = bucketsBetween(period, from, to);
  const series = new Map(keys.map((k) => [k, { key: k, liters: 0, peakFlowRate: 0, flowRateSum: 0, readings: 0 }]));
  const perHouse = new Map();
  const sources = new Set();

  for (const r of rows) {
    sources.add(r.source);
    const b = series.get(bucketKey[period](`${r.date}T12:00:00`));
    if (b) {
      b.liters += r.litersUsed;
      b.peakFlowRate = Math.max(b.peakFlowRate, r.peakFlowRate);
      b.flowRateSum += r.flowRateSum;
      b.readings += r.readingsCount;
    }
    const h = perHouse.get(r.houseId) || { houseId: r.houseId, liters: 0, peakFlowRate: 0, flowRateSum: 0, readings: 0, days: new Set() };
    h.liters += r.litersUsed;
    h.peakFlowRate = Math.max(h.peakFlowRate, r.peakFlowRate);
    h.flowRateSum += r.flowRateSum;
    h.readings += r.readingsCount;
    h.days.add(r.date);
    perHouse.set(r.houseId, h);
  }

  const totalLiters = rows.reduce((s, r) => s + r.litersUsed, 0);
  const previousLiters = prevRows.reduce((s, r) => s + r.litersUsed, 0);
  const readings = rows.reduce((s, r) => s + r.readingsCount, 0);
  const flowSum = rows.reduce((s, r) => s + r.flowRateSum, 0);

  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    unit: 'L',
    flowUnit: 'L/min',
    sources: [...sources],
    totals: {
      liters: totalLiters,
      previousLiters,
      changePct: previousLiters ? ((totalLiters - previousLiters) / previousLiters) * 100 : null,
      avgFlowRate: readings ? flowSum / readings : null,
      peakFlowRate: rows.length ? rows.reduce((m, r) => Math.max(m, r.peakFlowRate), 0) : null,
      averagePerBucket: keys.length ? totalLiters / keys.length : 0,
    },
    series: [...series.values()].map(({ flowRateSum, readings: n, ...b }) => ({ ...b, avgFlowRate: n ? flowRateSum / n : 0 })),
    houses: [...perHouse.values()].map(({ flowRateSum, readings: n, days, ...h }) => ({
      ...h,
      avgFlowRate: n ? flowRateSum / n : 0,
      dailyAverage: days.size ? h.liters / days.size : 0,
    })),
  };
}
