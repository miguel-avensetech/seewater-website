'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fmtNumber } from '@/lib/format';

export const CHART = {
  ocean: '#0e63c2',
  aqua: '#0eb5cf',
  navy: '#1b4275',
  // CSS variables so the grid and axis follow the light/dark theme.
  grid: 'var(--color-line)',
  axis: 'var(--color-faint)',
  ok: '#12925b',
  yellow: '#e2b203',
  warn: '#c97a06',
  crit: '#d23b3b',
};

const axisProps = { stroke: CHART.axis, fontSize: 11.5, tickLine: false, axisLine: false };

function ChartTooltip({ active, payload, label, labelFormatter, series }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 font-semibold text-ink">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p) => {
        const s = series.find((x) => x.key === p.dataKey);
        return (
          <p key={p.dataKey} className="tabular flex items-center gap-2 text-ink-soft">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke || p.fill }} />
            {s?.label ?? p.name}: <span className="font-semibold text-ink">{fmtNumber(p.value, s?.digits ?? 0)} {s?.unit}</span>
          </p>
        );
      })}
    </div>
  );
}

/**
 * Generic time-series chart.
 * series: [{ key, label, unit, color, digits, type?: 'area'|'bar'|'line' }]
 */
export function TimeSeriesChart({ data, xKey, series, kind = 'area', height = 260, xFormatter, labelFormatter, yUnit, referenceLines = [] }) {
  const Chart = kind === 'bar' ? BarChart : kind === 'line' ? LineChart : AreaChart;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={xFormatter} minTickGap={24} {...axisProps} />
          <YAxis width={yUnit ? 72 : 48} tickFormatter={(v) => `${fmtNumber(v)}${yUnit ? ` ${yUnit}` : ''}`} {...axisProps} />
          <Tooltip content={<ChartTooltip series={series} labelFormatter={labelFormatter ?? xFormatter} />} cursor={{ fill: 'rgb(14 99 194 / 0.06)', stroke: CHART.grid }} />
          {referenceLines.map((r) => (
            <ReferenceLine key={r.label} y={r.y} stroke={r.color} strokeDasharray="4 4" label={{ value: r.label, position: 'insideTopRight', fill: r.color, fontSize: 11 }} />
          ))}
          {series.map((s) =>
            kind === 'bar' ? (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={36} />
            ) : kind === 'line' ? (
              <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} type="monotone" connectNulls />
            ) : (
              <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#fill-${s.key})`} type="monotone" connectNulls />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

// Tiny trend line for table cells and cards.
export function Sparkline({ data, dataKey, color = CHART.ocean, height = 32 }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area dataKey={dataKey} stroke={color} strokeWidth={1.5} fill={`url(#spark-${dataKey})`} type="monotone" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
