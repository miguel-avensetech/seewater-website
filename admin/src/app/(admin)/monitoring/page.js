'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Activity, AlertTriangle, Cpu, Droplets, Gauge, RefreshCw, Waves, Wifi, WifiOff } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useLive } from '@/components/layout/LiveProvider';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { Badge, DataSourceBadge, StatusBadge, SourcesNote } from '@/components/ui/Badge';
import { EmptyState, ErrorState, PageLoader, InlineNotice } from '@/components/ui/States';
import { SearchInput } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TimeSeriesChart, CHART } from '@/components/charts/Charts';
import { ValveControl } from '@/components/domain/ValveControl';
import { ThresholdMeter } from '@/components/domain/FlowMeter';
import { fmtFlow, fmtLiters, fmtRelative, fmtTime } from '@/lib/format';
import { ALERT_TYPE, CONNECTION, FLOW_STATUS, lookup } from '@/lib/labels';

const REFRESH_MS = 15000;

function HouseCard({ house, onOpen, onChanged }) {
  const offline = house.device && house.device.connectionStatus !== 'online';
  return (
    <Card className={clsx('flex flex-col transition-shadow hover:shadow-pop', house.status === 'critical' && 'ring-2 ring-crit-600/30', house.status === 'high' && 'ring-2 ring-warn-600/25')}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <button onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-sm font-semibold text-ink hover:text-ocean-700">{house.houseName}</p>
          <p className="truncate text-xs text-muted">{house.ownerName} · {house.address}</p>
        </button>
        <StatusBadge map={FLOW_STATUS} value={house.status} pulse={house.status === 'critical'} />
      </div>

      <div className="flex-1 space-y-4 px-4 py-3.5">
        {!house.device ? (
          <p className="text-[13px] text-muted">No device installed for this household.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink-soft">
                {offline ? <WifiOff className="h-3.5 w-3.5 text-crit-600" /> : <Wifi className="h-3.5 w-3.5 text-ok-600" />}
                {house.device.deviceName}
                <span className="text-faint">· {lookup(CONNECTION, house.device.connectionStatus).label}{house.device.lastOnline && `, ${fmtRelative(house.device.lastOnline)}`}</span>
              </span>
              <DataSourceBadge state={house.flow?.dataState ?? 'no_data'} />
            </div>
            {house.flow && <ThresholdMeter label={`Flow rate · ${house.flow.location}`} value={offline ? null : house.flow.flowRate} warning={house.flow.warningLevel} critical={house.flow.criticalLevel} unit="L/min" />}
            {house.vibration && <ThresholdMeter label={`Pipe vibration · ${house.vibration.location}`} value={offline ? null : house.vibration.level} critical={house.vibration.limit} unit={house.vibration.limit == null ? 'no baseline' : ''} />}
            <div className="flex items-center justify-between rounded-lg bg-canvas px-3 py-2">
              <span className="text-xs text-muted">Used today</span>
              <span className="tabular text-sm font-bold text-ink">{fmtLiters(house.todayLiters)}</span>
            </div>
            {house.openAlerts.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {house.openAlerts.map((a) => (
                  <Badge key={a.id} tone={a.severityLevel === 'critical' ? 'crit' : 'warn'}>
                    <AlertTriangle className="h-3 w-3" /> {lookup(ALERT_TYPE, a.alertType).label}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {house.device && (
        <div className="border-t border-line px-4 py-3">
          <ValveControl valve={house.valve} device={house.device} onChanged={onChanged} compact />
        </div>
      )}
    </Card>
  );
}

const WINDOWS = [
  { value: 60, label: '1 hour' },
  { value: 360, label: '6 hours' },
  { value: 1440, label: '24 hours' },
];

function HouseDetail({ house, onClose, onChanged }) {
  const [minutes, setMinutes] = useState(60);
  const { data, error, loading, reload } = useApi(house ? `/monitoring/houses/${house.houseId}/readings` : null, { query: { minutes }, refreshMs: REFRESH_MS });
  const flow = data?.readings.filter((r) => r.readingType === 'flow') ?? [];
  const vib = data?.readings.filter((r) => r.readingType === 'vibration') ?? [];

  return (
    <Modal open={Boolean(house)} onClose={onClose} size="lg" title={house?.houseName} description={house && `${house.ownerName} · ${house.address}`}>
      {house && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs tabs={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} value={minutes} onChange={setMinutes} />
            <SourcesNote sources={data?.sources} />
          </div>
          {error ? (
            <ErrorState error={error} onRetry={reload} compact />
          ) : loading && !data ? (
            <div className="h-56 animate-pulse rounded-lg bg-canvas" />
          ) : !data.readings.length ? (
            <EmptyState icon={Activity} title="No readings in this window" message="The device has not reported during the selected period." />
          ) : (
            <>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink">Flow rate (L/min)</p>
                <TimeSeriesChart data={flow} xKey="recordedAt" xFormatter={fmtTime} yUnit="" height={200} series={[{ key: 'flowRate', label: 'Flow', unit: 'L/min', digits: 1, color: CHART.ocean }]} referenceLines={[house.flow?.warningLevel && { y: house.flow.warningLevel, label: 'Warning', color: CHART.warn }, house.flow?.criticalLevel && { y: house.flow.criticalLevel, label: 'Critical', color: CHART.crit }].filter(Boolean)} />
              </div>
              {vib.length > 0 && (
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-ink">Pipe vibration (sensor units)</p>
                  <TimeSeriesChart kind="line" data={vib} xKey="recordedAt" xFormatter={fmtTime} height={180} series={[{ key: 'vibrationLevel', label: 'Vibration', unit: '', color: CHART.aqua }]} referenceLines={house.vibration?.limit ? [{ y: house.vibration.limit, label: 'Leak threshold', color: CHART.crit }] : []} />
                </div>
              )}
            </>
          )}
          <div className="rounded-lg border border-line p-4">
            <ValveControl valve={house.valve} device={house.device} onChanged={onChanged} />
          </div>
          {house.device && (
            <Link href={`/devices/${house.device.id}`} className="inline-block text-[13px] font-semibold text-ocean-700 hover:underline">
              Open device details →
            </Link>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function MonitoringPage() {
  const { liveKey, live } = useLive(['devices', 'readings', 'alerts']);
  // With Firestore listeners connected, refresh on change; otherwise poll.
  const { data, error, loading, reload } = useApi('/monitoring/overview', { refreshMs: live ? 60000 : REFRESH_MS, liveKey });
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);

  const houses = useMemo(() => {
    if (!data) return [];
    const needle = q.toLowerCase();
    const order = { critical: 0, high: 1, normal: 2, no_data: 3 };
    return data.houses
      .filter((h) => !status || h.status === status)
      .filter((h) => !needle || [h.houseName, h.ownerName, h.address, h.device?.deviceName].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => order[a.status] - order[b.status]);
  }, [data, status, q]);

  if (loading && !data) return <PageLoader />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const anySimulated = data.houses.some((h) => h.device?.isSimulated);
  const open = data.houses.find((h) => h.houseId === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Live Monitoring"
        description={`Current flow rates, pipe vibration and device status for every monitored household. ${live ? 'Updates in real time.' : 'Refreshes every 15 seconds.'}`}
        actions={
          <>
            <span className="text-xs text-muted">Updated {fmtTime(data.generatedAt)}</span>
            <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => reload()} loading={loading}>
              Refresh
            </Button>
          </>
        }
      />

      {anySimulated && (
        <InlineNotice tone="warn" icon={AlertTriangle} title="Simulated devices present" className="mb-5">
          Some households use sample devices whose readings come from the seed data or device simulator, not installed hardware. They are labelled <strong>Simulated</strong>.
        </InlineNotice>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Combined flow now" value={data.totalFlowRate == null ? 'No data yet' : fmtFlow(data.totalFlowRate)} icon={Gauge} hint="Online devices only" />
        <StatCard label="Consumption today" value={fmtLiters(data.todayLiters)} icon={Droplets} accent="aqua" />
        <StatCard label="Devices online" value={`${data.devices.online} / ${data.devices.online + data.devices.offline + data.devices.notConnected}`} icon={Cpu} accent={data.devices.offline ? 'warn' : 'ok'} hint={`${data.devices.offline} offline · ${data.devices.notConnected} not connected`} />
        <StatCard label="High / critical" value={`${data.counts.high ?? 0} / ${data.counts.critical ?? 0}`} icon={Activity} accent={data.counts.critical ? 'crit' : data.counts.high ? 'warn' : 'ok'} hint="Households by flow status" />
        <StatCard label="Possible leak events" value={data.leakEvents} icon={Waves} accent={data.leakEvents ? 'crit' : 'ok'} hint={<Link href="/alerts?type=possible_leak&status=active" className="font-semibold text-ocean-700 hover:underline">View leak alerts</Link>} className="col-span-2 lg:col-span-1" />
      </div>

      <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="overflow-x-auto">
          <Tabs
            value={status}
            onChange={setStatus}
            tabs={[
              { value: '', label: 'All', count: data.houses.length },
              { value: 'critical', label: 'Critical', count: data.counts.critical ?? 0 },
              { value: 'high', label: 'High flow', count: data.counts.high ?? 0 },
              { value: 'normal', label: 'Normal', count: data.counts.normal ?? 0 },
              { value: 'no_data', label: 'No data', count: data.counts.no_data ?? 0 },
            ]}
          />
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Search household, owner, device…" className="md:w-72" />
      </div>

      {houses.length ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {houses.map((h) => (
            <HouseCard key={h.houseId} house={h} onOpen={() => setOpenId(h.houseId)} onChanged={reload} />
          ))}
        </div>
      ) : (
        <Card className="mt-4">
          <EmptyState icon={Activity} title={data.houses.length ? 'No households match' : 'No households yet'} message={data.houses.length ? 'Try a different status or search.' : 'Add homeowners and their households in User Management to start monitoring.'} />
        </Card>
      )}

      <HouseDetail house={open} onClose={() => setOpenId(null)} onChanged={reload} />
    </>
  );
}
