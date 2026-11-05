'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

// Link tabs for pages grouped under one sidebar item.
export function SectionTabs({ tabs, className }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Section" className={clsx('mb-5 inline-flex rounded-lg border border-line bg-surface p-1 shadow-card', className)}>
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={clsx('rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition-colors', active ? 'bg-navy-900 text-white shadow-sm dark:bg-ocean-600' : 'text-muted hover:bg-canvas hover:text-ink')}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Announcement Management (manuscript Fig. 7.1): announcements, plus the water
// interruption advisories that homeowners see in the app.
export const ANNOUNCEMENT_TABS = [
  { href: '/announcements', label: 'Announcements' },
  { href: '/interruptions', label: 'Water Interruptions' },
];

// System Logs and Device Logs share one sidebar item.
export const LOG_TABS = [
  { href: '/logs/system', label: 'System Logs' },
  { href: '/logs/devices', label: 'Device Logs' },
];
