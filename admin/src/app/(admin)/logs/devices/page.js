'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { HardDrive } from 'lucide-react';
import { useListQuery } from '@/hooks/useListQuery';
import { LOG_TABS, SectionTabs } from '@/components/layout/SectionTabs';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/Layout';
import { DataSourceBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { ClearFilters, DateRangeFilter, withSuspense } from '@/components/ui/Filters';
import { EmptyState } from '@/components/ui/States';
import { fmtDateTime } from '@/lib/format';
import { LOG_STATUS, options } from '@/lib/labels';

const eventLabel = (e) => e.replaceAll('_', ' ').replace(/^\w/, (c) => c.toUpperCase());

function DeviceLogsPage() {
  const sp = useSearchParams();
  const list = useListQuery('/logs/devices', { initial: { deviceId: sp.get('deviceId') || undefined }, refreshMs: 30000 });
  const { data, params } = list;

  return (
    <>
      <SectionTabs tabs={LOG_TABS} />
      <PageHeader title="Device Logs" description="Operational events from registered ESP32 devices: sensor readings and detections, valve operations, connectivity, firmware and calibration changes." />
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search event, description, device…" className="md:w-72" />
          <FilterSelect label="Device" value={params.deviceId} onChange={(v) => list.setFilter('deviceId', v)} placeholder="All devices" options={(data?.devices ?? []).map((d) => ({ value: d.id, label: d.deviceName }))} />
          <FilterSelect label="Event type" value={params.eventType} onChange={(v) => list.setFilter('eventType', v)} placeholder="All events" options={(data?.eventTypes ?? []).map((e) => ({ value: e, label: eventLabel(e) }))} />
          <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="Any status" options={options(LOG_STATUS)} />
          <DateRangeFilter from={params.from} to={params.to} onChange={list.setFilter} />
          <ClearFilters params={params} keys={['deviceId', 'eventType', 'status', 'from', 'to']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={880}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'loggedAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={HardDrive} title="No device events" message="No events recorded for these filters." />}
          columns={[
            { key: 'loggedAt', header: 'Timestamp', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (l) => fmtDateTime(l.loggedAt) },
            { key: 'deviceName', header: 'Device ID', sortable: true, render: (l) => <Link href={`/devices/${l.deviceId}`} className="font-mono text-[13px] font-semibold text-ocean-700 hover:underline">{l.deviceName}</Link> },
            { key: 'eventType', header: 'Event type', sortable: true, render: (l) => <span className="text-[13px] font-medium text-ink">{eventLabel(l.eventType)}</span> },
            { key: 'description', header: 'Description', className: 'text-[13px]' },
            { key: 'status', header: 'Status', sortable: true, render: (l) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge map={LOG_STATUS} value={l.status} />{l.source === 'simulated' && <DataSourceBadge state="simulated" />}</div> },
          ]}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
    </>
  );
}

export default withSuspense(DeviceLogsPage);
