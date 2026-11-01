'use client';

import { ScrollText } from 'lucide-react';
import { useListQuery } from '@/hooks/useListQuery';
import { useLive } from '@/components/layout/LiveProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { DataSourceBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { ClearFilters, DateRangeFilter } from '@/components/ui/Filters';
import { EmptyState } from '@/components/ui/States';
import { fmtDateTime } from '@/lib/format';
import { LOG_CATEGORY, LOG_STATUS, options } from '@/lib/labels';

const CATEGORY_TABS = [
  { value: '', label: 'All' },
  { value: 'high_flow', label: 'High flow' },
  { value: 'possible_leak', label: 'Leak alerts' },
  { value: 'sensor_event', label: 'Sensor events' },
  { value: 'connectivity', label: 'Connectivity' },
  { value: 'valve_operation', label: 'Valve operations' },
  { value: 'system_update', label: 'System updates' },
  { value: 'admin_action', label: 'Admin actions' },
];

export default function SystemLogsPage() {
  const { liveKey } = useLive(['logs']);
  const list = useListQuery('/logs/system', { refreshMs: 30000, liveKey });
  const { data, params } = list;

  return (
    <>
      <PageHeader title="System Logs" description="Chronological record of detections, sensor events, connectivity changes, valve operations, system updates and administrator actions." />
      <div className="mb-4 overflow-x-auto pb-1">
        <Tabs tabs={CATEGORY_TABS} value={params.category ?? ''} onChange={(v) => list.setFilter('category', v)} />
      </div>
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search description, device, admin…" className="md:w-80" />
          <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="Any status" options={options(LOG_STATUS)} />
          <DateRangeFilter from={params.from} to={params.to} onChange={list.setFilter} />
          <ClearFilters params={params} keys={['category', 'status', 'from', 'to']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={900}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'createdAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={ScrollText} title="No log entries" message="Nothing recorded for these filters." />}
          columns={[
            { key: 'createdAt', header: 'Time', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (l) => fmtDateTime(l.createdAt) },
            { key: 'category', header: 'Category', sortable: true, render: (l) => <StatusBadge map={LOG_CATEGORY} value={l.category} dot={false} /> },
            { key: 'description', header: 'Event', render: (l) => <div><p className="text-[13px] text-ink">{l.description}</p><p className="font-mono text-[11px] text-faint">{l.action}</p></div> },
            { key: 'source', header: 'Source / location', render: (l) => <div className="text-[13px]"><p className="text-ink-soft">{l.actorName ? `Admin: ${l.actorName}` : l.deviceName ?? 'System'}</p>{l.houseName && <p className="text-xs text-muted">{l.houseName}</p>}</div> },
            { key: 'status', header: 'Status', sortable: true, render: (l) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge map={LOG_STATUS} value={l.status} />{l.source === 'simulated' && <DataSourceBadge state="simulated" />}</div> },
          ]}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
    </>
  );
}
