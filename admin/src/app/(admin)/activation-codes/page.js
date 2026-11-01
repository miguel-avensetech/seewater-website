'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, Clock, KeyRound, ShieldOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { CopyButton } from '@/components/domain/DeviceForms';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { CODE_STATUS, options } from '@/lib/labels';

export default function ActivationCodesPage() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const list = useListQuery('/activation-codes');
  const { data, params } = list;
  const [revoking, setRevoking] = useState(null);
  const s = data?.summary;

  return (
    <>
      <PageHeader
        title="Activation Codes"
        description="One-time codes issued when a device is registered. Each code can activate the ESP32 hardware once and link a homeowner’s app once. Codes are only ever validated by the SeeWater server."
        actions={canEdit && <ButtonLink href="/devices" icon={KeyRound}>Register a device</ButtonLink>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active" value={s?.active ?? '—'} icon={KeyRound} accent="ok" />
        <StatCard label="Used" value={s?.used ?? '—'} icon={CheckCircle2} accent="ocean" hint="Hardware activated and homeowner linked" />
        <StatCard label="Expired" value={s?.expired ?? '—'} icon={Clock} accent={s?.expired ? 'warn' : 'ok'} />
        <StatCard label="Revoked" value={s?.revoked ?? '—'} icon={ShieldOff} accent="navy" />
      </div>

      <Card className="mt-6">
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search code, device, household…" className="md:w-80" />
          <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="Any status" options={options(CODE_STATUS)} />
          <ClearFilters params={params} keys={['status']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={980}
          rows={data?.items}
          rowKey="code"
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'createdAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={KeyRound} title="No activation codes yet" message="A code is generated automatically when you register a device." action={canEdit && <ButtonLink href="/devices" size="sm">Go to Device Management</ButtonLink>} />}
          columns={[
            { key: 'code', header: 'Code', render: (c) => <span className="flex items-center gap-2"><span className="select-all font-mono font-bold tracking-wider text-ink">{c.code}</span>{c.status === 'active' && <CopyButton value={c.code} label="Copy" />}</span> },
            { key: 'deviceName', header: 'Device', sortable: true, render: (c) => <div><Link href={`/devices/${c.deviceId}`} className="font-mono text-[13px] font-semibold text-ocean-700 hover:underline">{c.deviceName}</Link><p className="text-xs text-muted">{c.houseName ?? 'No household'}{c.ownerName ? ` · ${c.ownerName}` : ''}</p></div> },
            { key: 'status', header: 'Status', sortable: true, render: (c) => <StatusBadge map={CODE_STATUS} value={c.status} /> },
            { key: 'use', header: 'Used by', render: (c) => <div className="text-[13px]"><p className={c.hardwareActivatedAt ? 'text-ok-700' : 'text-muted'}>{c.hardwareActivatedAt ? `✓ Hardware · ${fmtDate(c.hardwareActivatedAt)}` : '○ Hardware'}</p><p className={c.homeownerLinkedAt ? 'text-ok-700' : 'text-muted'}>{c.homeownerLinkedAt ? `✓ ${c.activatedByName ?? 'Homeowner'} · ${fmtDate(c.homeownerLinkedAt)}` : '○ Homeowner app'}</p></div> },
            { key: 'createdAt', header: 'Issued', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (c) => fmtDateTime(c.createdAt) },
            { key: 'expiresAt', header: 'Expires', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (c) => fmtDate(c.expiresAt) },
            canEdit && { key: 'actions', header: <span className="sr-only">Actions</span>, render: (c) => c.status === 'active' && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setRevoking(c)}>Revoke</Button> },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title={`Revoke ${revoking?.code}?`}
        confirmLabel="Revoke code"
        message="The code stops working immediately for both the hardware and the homeowner app. Devices already activated keep working. You can issue a new code from the device page."
        onConfirm={async () => {
          await api(`/activation-codes/${revoking.code}/revoke`, { method: 'POST' });
          toast.success('Activation code revoked');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}
