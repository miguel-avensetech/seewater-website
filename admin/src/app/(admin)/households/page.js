'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, Cpu, Home, Pencil, Plus, Trash2, Wifi } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { HouseFormModal } from '@/components/domain/UserForms';
import { fmtDate, fmtLiters } from '@/lib/format';
import { HOUSE_STATUS, options } from '@/lib/labels';

export default function HouseholdsPage() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const list = useListQuery('/houses');
  const { data, params } = list;
  const [modal, setModal] = useState({ open: false, house: null });
  const [removing, setRemoving] = useState(null);
  const s = data?.summary;

  return (
    <>
      <PageHeader
        title="Households"
        description="Every monitored home, its owner, installed devices, recent consumption and open alerts."
        actions={canEdit && <Button icon={Plus} onClick={() => setModal({ open: true, house: null })}>Add household</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Households" value={s?.total ?? '—'} icon={Home} />
        <StatCard label="Monitored" value={s?.monitored ?? '—'} icon={Wifi} accent="ok" />
        <StatCard label="Pending installation" value={s?.pending ?? '—'} icon={Cpu} accent="warn" />
        <StatCard label="Without a device" value={s?.withoutDevice ?? '—'} icon={Bell} accent={s?.withoutDevice ? 'warn' : 'ok'} hint="Register a device to start monitoring" />
      </div>

      <Card className="mt-6">
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search household, address, owner, device…" className="md:w-96" />
          <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="All statuses" options={options(HOUSE_STATUS)} />
          <ClearFilters params={params} keys={['status']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={980}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'createdAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={Home} title={params.q || params.status ? 'No households match' : 'No households yet'} message={params.q || params.status ? 'Try a different search or filter.' : 'Add a household for a homeowner, then register a device for it.'} />}
          columns={[
            { key: 'houseName', header: 'Household', sortable: true, render: (h) => <div><p className="font-semibold text-ink">{h.houseName}</p><p className="max-w-xs truncate text-xs text-muted" title={h.address}>{h.address}</p></div> },
            { key: 'ownerName', header: 'Owner', sortable: true, render: (h) => (h.ownerName ? <Link href={`/users/${h.userId}`} className="font-medium text-ocean-700 hover:underline">{h.ownerName}</Link> : <span className="text-warn-700">Unknown</span>) },
            {
              key: 'deviceCount',
              header: 'Devices',
              sortable: true,
              render: (h) =>
                h.deviceCount ? (
                  <div className="text-[13px]"><p className="font-mono text-ink">{h.deviceNames}</p><p className="text-xs text-muted">{h.devicesOnline} of {h.deviceCount} online</p></div>
                ) : (
                  <span className="text-[13px] text-muted">None</span>
                ),
            },
            { key: 'usage30dLiters', header: 'Usage (30 days)', sortable: true, className: 'tabular font-medium text-ink', render: (h) => fmtLiters(h.usage30dLiters) },
            { key: 'activeAlerts', header: 'Open alerts', sortable: true, render: (h) => (h.activeAlerts ? <Badge tone="crit" dot>{h.activeAlerts}</Badge> : <span className="text-[13px] text-muted">0</span>) },
            { key: 'houseStatus', header: 'Status', render: (h) => <StatusBadge map={HOUSE_STATUS} value={h.houseStatus} /> },
            { key: 'createdAt', header: 'Added', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (h) => fmtDate(h.createdAt) },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (h) => (
                <div className="flex justify-end gap-1">
                  <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label={`Edit ${h.houseName}`} onClick={() => setModal({ open: true, house: h })} />
                  <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label={`Remove ${h.houseName}`} onClick={() => setRemoving(h)} />
                </div>
              ),
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <HouseFormModal open={modal.open} house={modal.house} onClose={() => setModal({ open: false, house: null })} onSaved={() => list.reload({ silent: true })} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.houseName}?`}
        confirmLabel="Remove household"
        message={removing?.deviceCount ? 'This household still has devices. Reassign or remove them in Device Management first.' : 'The household record is deleted. Historical usage records are kept.'}
        onConfirm={async () => {
          await api(`/houses/${removing.id}`, { method: 'DELETE' });
          toast.success('Household removed');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}
