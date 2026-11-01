'use client';

import { Suspense } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from './Button';
import { PageLoader } from './States';

export function DateRangeFilter({ from, to, onChange }) {
  const cls = 'h-9 rounded-lg border border-line-strong bg-surface px-2 text-[13px] text-ink focus:border-ocean-500 focus:outline-none';
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-muted">
      <input type="date" aria-label="From date" value={from ?? ''} max={to || undefined} onChange={(e) => onChange('from', e.target.value)} className={cls} />
      <span>–</span>
      <input type="date" aria-label="To date" value={to ?? ''} min={from || undefined} onChange={(e) => onChange('to', e.target.value)} className={cls} />
    </div>
  );
}

export function ClearFilters({ params, keys, onClear }) {
  const active = keys.some((k) => params[k]) || params.q;
  if (!active) return null;
  return (
    <Button variant="ghost" size="sm" icon={RotateCcw} onClick={onClear}>
      Clear
    </Button>
  );
}

// Pages that read URL search params must render inside Suspense.
export function withSuspense(Component) {
  return function Wrapped(props) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Component {...props} />
      </Suspense>
    );
  };
}
