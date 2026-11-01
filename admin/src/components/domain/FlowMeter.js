import clsx from 'clsx';
import { fmtNumber } from '@/lib/format';

/**
 * Horizontal meter for a reading against warning/critical thresholds.
 * Scale extends 20% beyond the critical level.
 */
export function ThresholdMeter({ value, warning, critical, unit, label }) {
  const max = Math.max((critical ?? 1) * 1.2, value ?? 0);
  const pct = value == null ? 0 : Math.min(100, (value / max) * 100);
  const tone = value == null ? 'none' : critical != null && value >= critical ? 'crit' : warning != null && value >= warning ? 'warn' : 'ok';
  const bar = { ok: 'bg-gradient-to-r from-aqua-400 to-ocean-500', warn: 'bg-warn-600', crit: 'bg-crit-600', none: 'bg-slate-300' }[tone];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <span className={clsx('tabular text-lg font-bold', { ok: 'text-ink', warn: 'text-warn-700', crit: 'text-crit-700', none: 'text-faint' }[tone])}>
          {value == null ? '—' : fmtNumber(value, unit === 'L/min' ? 1 : 0)}
          <span className="ml-1 text-xs font-semibold text-faint">{unit}</span>
        </span>
      </div>
      <div className="relative mt-1.5 h-2 rounded-full bg-slate-100" role="meter" aria-label={label} aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={max}>
        <div className={clsx('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${pct}%` }} />
        {warning != null && <span className="absolute top-[-3px] h-[14px] w-px bg-warn-600/70" style={{ left: `${(warning / max) * 100}%` }} title={`Warning ${warning} ${unit}`} />}
        {critical != null && <span className="absolute top-[-3px] h-[14px] w-px bg-crit-600/70" style={{ left: `${(critical / max) * 100}%` }} title={`Critical ${critical} ${unit}`} />}
      </div>
    </div>
  );
}
