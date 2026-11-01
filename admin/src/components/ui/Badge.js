import clsx from 'clsx';
import { FlaskConical, History, Radio, CircleSlash } from 'lucide-react';
import { lookup } from '@/lib/labels';

const tones = {
  ok: 'bg-ok-50 text-ok-700 ring-ok-600/20',
  warn: 'bg-warn-50 text-warn-700 ring-warn-600/25',
  crit: 'bg-crit-50 text-crit-700 ring-crit-600/20',
  info: 'bg-ocean-50 text-ocean-700 ring-ocean-500/20',
  aqua: 'bg-aqua-50 text-aqua-600 ring-aqua-500/25',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-400/20',
};

const dots = { ok: 'bg-ok-600', warn: 'bg-warn-600', crit: 'bg-crit-600', info: 'bg-ocean-500', aqua: 'bg-aqua-500', neutral: 'bg-slate-400' };

export function Badge({ tone = 'neutral', dot = false, pulse = false, className, children }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', tones[tone], className)}>
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && <span className={clsx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', dots[tone])} />}
          <span className={clsx('relative inline-flex h-1.5 w-1.5 rounded-full', dots[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}

// Renders an enum value using a label map from lib/labels.
export function StatusBadge({ map, value, dot = true, pulse }) {
  const { label, tone } = lookup(map, value);
  return (
    <Badge tone={tone} dot={dot} pulse={pulse}>
      {label}
    </Badge>
  );
}

const DATA_STATES = {
  live: { label: 'Live', tone: 'ok', icon: Radio, title: 'Real device reading received within the last few minutes' },
  stored: { label: 'Stored', tone: 'info', icon: History, title: 'Historical reading from a real device' },
  simulated: { label: 'Simulated', tone: 'warn', icon: FlaskConical, title: 'Sample or simulator data — not from installed hardware' },
  device: { label: 'Device data', tone: 'info', icon: History, title: 'Recorded from installed hardware' },
  no_data: { label: 'No data', tone: 'neutral', icon: CircleSlash, title: 'No readings received yet' },
};

// Always shown next to IoT data so simulated readings are never mistaken for live hardware.
export function DataSourceBadge({ state, className }) {
  const s = DATA_STATES[state] ?? DATA_STATES.no_data;
  const Icon = s.icon;
  return (
    <span title={s.title} className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', tones[s.tone], className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {s.label}
    </span>
  );
}

// Summarises the sources present in a dataset (e.g. ['simulated', 'device']).
export function SourcesNote({ sources = [] }) {
  if (!sources.length) return null;
  if (sources.includes('simulated')) {
    return <DataSourceBadge state="simulated" />;
  }
  return <DataSourceBadge state="device" />;
}
