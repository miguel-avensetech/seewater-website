'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronsLeft, ChevronsRight, LogOut, Menu, X, ChevronRight } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { initials } from '@/lib/format';
import { lookup, ROLE } from '@/lib/labels';
import { useAuth } from './AuthProvider';
import { Wordmark, Logo } from './Logo';
import { NAV, isActive, findNav } from './nav';
import { useLive, useLiveStatus } from './LiveProvider';

const COLLAPSE_KEY = 'sw.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function SidebarContent({ collapsed, counts, onNavigate }) {
  const pathname = usePathname();
  const { admin, logout } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className={clsx('flex h-16 items-center border-b border-white/10', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Link href="/" onClick={onNavigate} aria-label="SeeWater dashboard">
          {collapsed ? <Logo className="h-8 w-8" /> : <Wordmark light />}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
        {NAV.map((group) => (
          <div key={group.group} className="mb-5 last:mb-0">
            {!collapsed ? (
              <p className="mb-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/40">{group.group}</p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const count = item.badge ? counts?.[item.badge] : 0;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'group relative flex items-center gap-3 rounded-lg py-2 text-[13.5px] font-medium transition-colors',
                        collapsed ? 'justify-center px-2' : 'px-2.5',
                        active ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-aqua-400" aria-hidden />}
                      <Icon className={clsx('h-[18px] w-[18px] shrink-0', active ? 'text-aqua-400' : 'text-white/50 group-hover:text-white/80')} aria-hidden />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {count > 0 && (
                        <span
                          className={clsx(
                            'tabular rounded-full bg-crit-600 text-[10.5px] font-bold text-white',
                            collapsed ? 'absolute right-1 top-1 h-2 w-2 p-0 text-[0px]' : 'min-w-5 px-1.5 py-0.5 text-center',
                          )}
                          aria-label={`${count} pending`}
                        >
                          {count > 99 ? '99+' : count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="ripple-bg border-t border-white/10 p-3">
        <div className={clsx('flex items-center gap-3 rounded-lg p-2', collapsed && 'flex-col')}>
          <Link href="/settings" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3" title="Profile & settings">
            {admin.photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={admin.photoURL} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white/20" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-aqua-400 to-ocean-600 text-[13px] font-bold text-white">{initials(admin.fullName)}</span>
            )}
            {!collapsed && (
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-white">{admin.fullName}</span>
                <span className="block truncate text-[11.5px] text-white/50">{lookup(ROLE, admin.role).label}</span>
              </span>
            )}
          </Link>
          <button onClick={logout} className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="Sign out" aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = findNav(pathname);

  // Badge counts: active alerts and new feedback. Refreshed every minute.
  const { liveKey: alertsKey } = useLive(['alerts']);
  const { live } = useLiveStatus();
  const alerts = useApi('/alerts', { query: { status: 'active', pageSize: 1 }, refreshMs: 60000, liveKey: alertsKey });
  const feedback = useApi('/feedback', { query: { status: 'new', pageSize: 1 }, refreshMs: 60000 });
  const counts = { alerts: alerts.data?.summary?.active ?? 0, feedback: feedback.data?.summary?.new ?? 0 };

  useEffect(() => setCollapsed(readCollapsed()), []);
  useEffect(() => setMobileOpen(false), [pathname]);

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });
  }

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className={clsx('fixed inset-y-0 left-0 z-30 hidden bg-navy-900 transition-[width] duration-200 lg:block', collapsed ? 'w-[72px]' : 'w-64')}>
        <SidebarContent collapsed={collapsed} counts={counts} />
        <button
          onClick={toggle}
          className="absolute -right-3 top-[52px] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card hover:text-ink"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </button>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade-in bg-navy-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="relative h-full w-72 max-w-[85vw] animate-slide-in bg-navy-900 shadow-pop">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
            <SidebarContent collapsed={false} counts={counts} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className={clsx('transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button onClick={() => setMobileOpen(true)} className="-ml-1 rounded-lg p-2 text-ink-soft hover:bg-canvas lg:hidden" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="hidden text-faint sm:inline">{current?.group ?? 'SeeWater'}</span>
            <ChevronRight className="hidden h-3.5 w-3.5 text-faint sm:inline" aria-hidden />
            <span className="truncate font-semibold text-ink">{current?.label ?? 'Details'}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={clsx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset md:inline-flex', live ? 'bg-ok-50 text-ok-700 ring-ok-600/20' : 'bg-slate-100 text-slate-600 ring-slate-400/20')}
              title={live ? 'Receiving real-time updates from Firestore' : 'Real-time updates unavailable — refreshing periodically'}
            >
              <span className={clsx('h-1.5 w-1.5 rounded-full', live ? 'bg-ok-600' : 'bg-slate-400')} />
              {live ? 'Live' : 'Auto-refresh'}
            </span>
            {counts.alerts > 0 && (
              <Link href="/alerts?status=active" className="hidden items-center gap-2 rounded-full bg-crit-50 px-3 py-1.5 text-xs font-semibold text-crit-700 ring-1 ring-inset ring-crit-600/20 hover:bg-crit-50/70 sm:flex">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-crit-600 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-crit-600" />
                </span>
                {counts.alerts} active alert{counts.alerts > 1 ? 's' : ''}
              </Link>
            )}
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
