import clsx from 'clsx';
import { AlertOctagon, Inbox, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />;
}

export function EmptyState({ icon: Icon = Inbox, title, message, action, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ocean-50 text-ocean-600">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-[13px] text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, compact = false }) {
  return (
    <div role="alert" className={clsx('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-crit-50 text-crit-600">
        <AlertOctagon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-3 text-sm font-semibold text-ink">Couldn’t load this data</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{error?.message || 'An unexpected error occurred.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" icon={RefreshCw} onClick={() => onRetry()}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function InlineNotice({ tone = 'info', icon: Icon, title, children, className }) {
  const tones = {
    info: 'border-ocean-200 bg-ocean-50 text-ocean-800',
    warn: 'border-warn-600/30 bg-warn-50 text-warn-700',
    crit: 'border-crit-600/30 bg-crit-50 text-crit-700',
    ok: 'border-ok-600/30 bg-ok-50 text-ok-700',
  };
  return (
    <div className={clsx('flex gap-3 rounded-lg border px-3.5 py-3 text-[13px]', tones[tone], className)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={clsx(title && 'mt-0.5', 'opacity-90')}>{children}</div>
      </div>
    </div>
  );
}
