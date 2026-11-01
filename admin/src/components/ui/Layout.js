import clsx from 'clsx';

export function PageHeader({ title, description, actions, eyebrow }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-aqua-600">{eyebrow}</p>}
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const accents = {
  ocean: 'bg-ocean-50 text-ocean-600',
  aqua: 'bg-aqua-50 text-aqua-600',
  ok: 'bg-ok-50 text-ok-600',
  warn: 'bg-warn-50 text-warn-600',
  crit: 'bg-crit-50 text-crit-600',
  navy: 'bg-navy-900/5 text-navy-700 dark:bg-white/5 dark:text-ink-soft',
};

export function StatCard({ label, value, icon: Icon, accent = 'ocean', hint, footer, className }) {
  return (
    <div className={clsx('relative min-w-0 overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        {Icon && (
          <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', accents[accent])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="tabular mt-1 text-2xl font-bold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {footer && <div className="mt-3 border-t border-line pt-2.5 text-xs">{footer}</div>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div role="tablist" className={clsx('inline-flex rounded-lg border border-line bg-surface p-1 shadow-card', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
            value === t.value ? 'bg-navy-900 text-white shadow-sm dark:bg-ocean-600' : 'text-muted hover:bg-canvas hover:text-ink',
          )}
        >
          {t.label}
          {t.count != null && <span className={clsx('tabular ml-1.5 rounded-full px-1.5 text-[11px]', value === t.value ? 'bg-white/15' : 'bg-canvas')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Label/value pairs for detail panels.
export function DescriptionList({ items, columns = 2 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-4', columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-3' : '')}>
      {items.filter(Boolean).map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-faint">{label}</dt>
          <dd className="mt-1 break-words text-sm text-ink">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
