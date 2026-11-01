'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Skeleton, EmptyState, ErrorState } from './States';
import { Button } from './Button';

/**
 * Server-driven table.
 * columns: [{ key, header, sortable, render(row), className, headerClassName }]
 */
export function DataTable({ columns, rows, loading, error, onRetry, sort, order, onSort, onRowClick, rowKey = 'id', empty, minWidth = 720 }) {
  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;
  const showSkeleton = loading && !rows?.length;

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line bg-canvas/70">
            {columns.map((c) => {
              const active = sort === c.key;
              const Icon = active ? (order === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined} className={clsx('px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted', c.headerClassName)}>
                  {c.sortable && onSort ? (
                    <button onClick={() => onSort(c.key)} className={clsx('inline-flex items-center gap-1 uppercase hover:text-ink', active && 'text-ocean-700')}>
                      {c.header}
                      <Icon className={clsx('h-3.5 w-3.5', !active && 'opacity-40')} aria-hidden />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className={clsx('divide-y divide-line', loading && rows?.length && 'opacity-60 transition-opacity')}>
          {showSkeleton &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3.5">
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          {!showSkeleton &&
            rows?.map((row) => (
              <tr
                key={row[rowKey]}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={clsx('transition-colors', onRowClick && 'cursor-pointer hover:bg-ocean-50/50 focus-visible:bg-ocean-50')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx('px-4 py-3 align-middle text-ink-soft', c.className)}>
                    {c.render ? c.render(row) : row[c.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && !error && rows?.length === 0 && (empty ?? <EmptyState title="No records found" message="Try adjusting your search or filters." />)}
    </div>
  );
}

export function Pagination({ page, totalPages, total, pageSize, onPage, onPageSize }) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted sm:flex-row">
      <p className="tabular">
        Showing <span className="font-semibold text-ink">{from}–{to}</span> of <span className="font-semibold text-ink">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
            {[10, 25, 50].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
        <Button variant="secondary" size="icon-sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
        <span className="tabular min-w-16 text-center">
          {page} / {totalPages}
        </span>
        <Button variant="secondary" size="icon-sm" icon={ChevronRight} disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page" />
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className }) {
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-8 text-[13px] placeholder:text-faint focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-ink" aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// Toolbar above a table: search on the left, filters/actions wrap on small screens.
export function TableToolbar({ children, className }) {
  return <div className={clsx('flex flex-col gap-2 border-b border-line px-4 py-3 md:flex-row md:flex-wrap md:items-center', className)}>{children}</div>;
}
