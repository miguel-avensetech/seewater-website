'use client';

import Link from 'next/link';
import clsx from 'clsx';
import { ArrowRight, Bell, CalendarClock, CheckCircle2, Cpu, Droplets, Home, Megaphone, MessageSquareText, Users, WifiOff, Wrench } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/components/layout/AuthProvider';
import { useLive } from '@/components/layout/LiveProvider';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { Badge, StatusBadge, SourcesNote } from '@/components/ui/Badge';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/States';
import { ButtonLink } from '@/components/ui/Button';
import { TimeSeriesChart, CHART } from '@/components/charts/Charts';
import { fmtBucket, fmtDateTime, fmtFlow, fmtLiters, fmtNumber, fmtRelative } from '@/lib/format';
import { ANNOUNCEMENT_CATEGORY, ANNOUNCEMENT_STATUS, FEEDBACK_STATUS, FEEDBACK_TYPE, LOG_CATEGORY, LOG_STATUS, lookup } from '@/lib/labels';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { admin } = useAuth();
  const { liveKey } = useLive(['alerts', 'devices', 'logs', 'readings']);
  const { data, error, loading, reload } = useApi('/dashboard/summary', { refreshMs: 60000, liveKey });

  if (loading && !data) return <PageLoader />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { stats, consumption, interruptions, recentAnnouncements, recentFeedback, recentActivity } = data;
  // Full days only (today is still in progress).
  const fullDays = consumption.last7Days.slice(0, -1);
  const weekAvg = fullDays.reduce((s, d) => s + d.liters, 0) / (fullDays.length || 1);

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })}
        title={`${greeting()}, ${admin.fullName.split(' ')[0]}`}
        description="Overview of connected households, devices, and water activity across the SeeWater network."
        actions={<ButtonLink href="/monitoring" variant="secondary" icon={ArrowRight}>Open live monitoring</ButtonLink>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered users" value={fmtNumber(stats.totalUsers)} icon={Users} hint={`${fmtNumber(stats.activeUsers)} active accounts`} footer={<Link href="/users" className="font-semibold text-ocean-700 hover:underline">Manage users →</Link>} />
        <StatCard label="Connected IoT devices" value={<>{fmtNumber(stats.connectedDevices)}<span className="text-base font-semibold text-faint"> / {fmtNumber(stats.totalDevices)}</span></>} icon={Cpu} accent="aqua" hint={stats.offlineDevices ? `${stats.offlineDevices} offline` : 'No devices offline'} footer={<Link href="/devices" className="font-semibold text-ocean-700 hover:underline">View devices →</Link>} />
        <StatCard label="Active alerts" value={fmtNumber(stats.activeAlerts)} icon={Bell} accent={stats.criticalAlerts ? 'crit' : stats.activeAlerts ? 'warn' : 'ok'} hint={stats.criticalAlerts ? `${stats.criticalAlerts} critical` : 'No critical alerts'} footer={<Link href="/alerts?status=active" className="font-semibold text-ocean-700 hover:underline">Review alerts →</Link>} />
        <StatCard label="Water interruptions" value={fmtNumber(stats.waterInterruptions)} icon={Wrench} accent="navy" hint="Ongoing or scheduled" footer={<Link href="/interruptions" className="font-semibold text-ocean-700 hover:underline">Manage interruptions →</Link>} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Households" value={fmtNumber(stats.totalHouseholds)} icon={Home} accent="aqua" footer={<Link href="/households" className="font-semibold text-ocean-700 hover:underline">View households →</Link>} />
        <StatCard label="Devices offline" value={fmtNumber(stats.offlineDevices)} icon={WifiOff} accent={stats.offlineDevices ? 'warn' : 'ok'} hint={`${fmtNumber(stats.totalDevices - stats.connectedDevices - stats.offlineDevices)} not connected yet`} />
        <StatCard label="Published announcements" value={fmtNumber(stats.publishedAnnouncements)} icon={Megaphone} accent="navy" footer={<Link href="/announcements" className="font-semibold text-ocean-700 hover:underline">Announcements →</Link>} />
        <StatCard label="Feedback" value={fmtNumber(stats.totalFeedback)} icon={MessageSquareText} accent="ocean" hint={`${fmtNumber(stats.newFeedback)} new`} footer={<Link href="/feedback" className="font-semibold text-ocean-700 hover:underline">Review feedback →</Link>} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon={Droplets}
            title="Daily water consumption"
            description="Total across all monitored households, last 7 days (liters)"
            actions={<SourcesNote sources={consumption.sources} />}
          />
          <CardBody>
            <div className="mb-4 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted">Today so far</p>
                <p className="tabular text-xl font-bold text-ink">{fmtLiters(consumption.today)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Yesterday (full day)</p>
                <p className="tabular text-xl font-bold text-ink">{fmtLiters(consumption.yesterday)}</p>
                {weekAvg > 0 && <p className="tabular text-xs text-muted">7-day avg {fmtLiters(weekAvg)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted">Peak flow today</p>
                <p className="tabular text-xl font-bold text-ink">{consumption.peakFlowToday == null ? <span className="text-base font-semibold text-faint">No data yet</span> : fmtFlow(consumption.peakFlowToday)}</p>
              </div>
            </div>
            {consumption.last7Days.some((d) => d.liters > 0) ? (
              <TimeSeriesChart kind="bar" data={consumption.last7Days} xKey="date" xFormatter={(k) => fmtBucket(k, 'daily')} yUnit="L" series={[{ key: 'liters', label: 'Consumption', unit: 'L', color: CHART.ocean }]} height={240} />
            ) : (
              <EmptyState icon={Droplets} title="No consumption recorded yet" message="Usage appears here once devices start sending flow readings." />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={CalendarClock} title="Water interruptions" description="Ongoing and scheduled" actions={<Link href="/interruptions" className="text-[13px] font-semibold text-ocean-700 hover:underline">Manage</Link>} />
          <CardBody className="space-y-3">
            {interruptions.length ? (
              interruptions.map((i) => (
                <div key={i.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{i.area}</p>
                    <Badge tone={i.ongoing ? 'crit' : 'info'} dot pulse={i.ongoing}>{i.ongoing ? 'Ongoing' : 'Scheduled'}</Badge>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{i.title}</p>
                  <p className="tabular mt-1.5 text-xs text-ink-soft">{fmtDateTime(i.start)} → {fmtDateTime(i.end)}</p>
                </div>
              ))
            ) : (
              <EmptyState icon={CheckCircle2} title="No interruptions" message="No ongoing or upcoming water interruptions." className="py-6" />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader icon={Megaphone} title="Recent announcements" actions={<Link href="/announcements" className="text-[13px] font-semibold text-ocean-700 hover:underline">View all</Link>} />
          <ul className="divide-y divide-line">
            {recentAnnouncements.length ? (
              recentAnnouncements.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge map={ANNOUNCEMENT_STATUS} value={a.status} />
                    <span className="text-xs text-faint">{lookup(ANNOUNCEMENT_CATEGORY, a.category).label}</span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-ink">{a.title}</p>
                  <p className="text-xs text-muted">{a.status === 'scheduled' ? `Publishes ${fmtDateTime(a.publishAt)}` : fmtRelative(a.publishedAt)}</p>
                </li>
              ))
            ) : (
              <EmptyState title="No announcements yet" className="py-8" />
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader icon={MessageSquareText} title="Recent user reports" actions={<Link href="/feedback" className="text-[13px] font-semibold text-ocean-700 hover:underline">View all</Link>} />
          <ul className="divide-y divide-line">
            {recentFeedback.length ? (
              recentFeedback.map((f) => (
                <li key={f.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink">{f.subject}</p>
                    <StatusBadge map={FEEDBACK_STATUS} value={f.status} />
                  </div>
                  <p className="text-xs text-muted">
                    {f.userName} · {lookup(FEEDBACK_TYPE, f.type).label} · {fmtRelative(f.createdAt)}
                  </p>
                </li>
              ))
            ) : (
              <EmptyState title="No feedback yet" className="py-8" />
            )}
          </ul>
        </Card>

        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Recent system activity" actions={<Link href="/logs/system" className="text-[13px] font-semibold text-ocean-700 hover:underline">Full log</Link>} />
          <ol className="relative space-y-4 px-5 py-4">
            {recentActivity.length ? (
              recentActivity.map((a) => {
                const tone = lookup(LOG_STATUS, a.status).tone;
                return (
                  <li key={a.id} className="flex gap-3">
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', { ok: 'bg-ok-600', warn: 'bg-warn-600', crit: 'bg-crit-600', info: 'bg-ocean-500', neutral: 'bg-slate-400', aqua: 'bg-aqua-500' }[tone])} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink">{a.description}</p>
                      <p className="text-xs text-faint">
                        {lookup(LOG_CATEGORY, a.category).label} · {fmtRelative(a.createdAt)}
                        {a.source === 'simulated' && ' · simulated'}
                      </p>
                    </div>
                  </li>
                );
              })
            ) : (
              <EmptyState title="No activity yet" className="py-4" />
            )}
          </ol>
        </Card>
      </div>
    </>
  );
}
