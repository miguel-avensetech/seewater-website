'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bell, CheckCheck, Eye, ShieldAlert, Waves, WifiOff, Gauge } from 'lucide-react';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { useLive } from '@/components/layout/LiveProvider';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { DataSourceBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Textarea } from '@/components/ui/Field';
import { ClearFilters, DateRangeFilter, withSuspense } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { ALERT_STATUS, ALERT_TYPE, SEVERITY, options } from '@/lib/labels';

function ResolveDialog({ alert, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api(`/alerts/${alert.id}`, { method: 'PATCH', body: { alertStatus: 'resolved', resolutionNote: note } });
      toast.success('Alert resolved');
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(alert)}
      onClose={onClose}
      busy={busy}
      size="sm"
      title="Resolve alert"
      description={alert && `${ALERT_TYPE[alert.alertType]?.label} · ${alert.houseName ?? alert.deviceName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} loading={busy} icon={CheckCheck}>Mark resolved</Button>
        </>
      }
    >
      {alert && (
        <div className="space-y-4">
          <p className="rounded-lg bg-canvas p-3 text-[13px] text-ink-soft">{alert.description}</p>
          <Textarea label="Resolution note" hint="What was found or done? Visible in the system log." value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} />
          {error && <p className="text-[13px] font-medium text-crit-700" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function AlertsPage() {
  const sp = useSearchParams();
  const toast = useToast();
  const { canEdit } = useAuth();
  const { liveKey } = useLive(['alerts']);
  const list = useListQuery('/alerts', {
    liveKey,
    initial: { status: sp.get('status') || undefined, type: sp.get('type') || undefined },
    refreshMs: 30000,
  });
  const { data, params } = list;
  const [resolving, setResolving] = useState(null);

  async function acknowledge(a) {
    try {
      await api(`/alerts/${a.id}`, { method: 'PATCH', body: { alertStatus: 'acknowledged' } });
      toast.success('Alert acknowledged');
      list.reload({ silent: true });
    } catch (err) {
      toast.error('Could not acknowledge alert', err.message);
    }
  }

  const s = data?.summary;
  return (
    <>
      <PageHeader title="System Alerts" description="High-flow, possible leak and device connectivity alerts raised by the monitoring rules." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active alerts" value={s?.active ?? '—'} icon={Bell} accent={s?.active ? 'warn' : 'ok'} hint={`${s?.critical ?? 0} critical`} />
        <StatCard label="Possible leaks" value={s?.leaks ?? '—'} icon={Waves} accent={s?.leaks ? 'crit' : 'ok'} hint="Vibration + continuous flow" />
        <StatCard label="High flow" value={s?.highFlow ?? '—'} icon={Gauge} accent={s?.highFlow ? 'warn' : 'ok'} hint="Above flow thresholds" />
        <StatCard label="Devices offline" value={s?.offline ?? '—'} icon={WifiOff} accent={s?.offline ? 'warn' : 'ok'} hint="Stopped reporting" />
      </div>

      <Card className="mt-6">
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search description, household, device…" className="md:w-72" />
          <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="Any status" options={[{ value: 'active', label: 'Active (open + acknowledged)' }, ...options(ALERT_STATUS)]} />
          <FilterSelect label="Type" value={params.type} onChange={(v) => list.setFilter('type', v)} placeholder="All types" options={options(ALERT_TYPE)} />
          <FilterSelect label="Severity" value={params.severity} onChange={(v) => list.setFilter('severity', v)} placeholder="Any severity" options={options(SEVERITY)} />
          <FilterSelect label="Data source" value={params.source} onChange={(v) => list.setFilter('source', v)} placeholder="Any source" options={[{ value: 'device', label: 'Real devices' }, { value: 'simulated', label: 'Simulated' }]} />
          <DateRangeFilter from={params.from} to={params.to} onChange={list.setFilter} />
          <ClearFilters params={params} keys={['status', 'type', 'severity', 'source', 'from', 'to']} onClear={list.clearFilters} />
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
          empty={<EmptyState icon={ShieldAlert} title="No alerts match" message="No alerts for the selected filters — that’s good news." />}
          columns={[
            { key: 'createdAt', header: 'Raised', sortable: true, render: (a) => <div className="whitespace-nowrap"><p className="text-ink">{fmtRelative(a.createdAt)}</p><p className="text-xs text-faint">{fmtDateTime(a.createdAt)}</p></div> },
            { key: 'alertType', header: 'Type', sortable: true, render: (a) => <StatusBadge map={ALERT_TYPE} value={a.alertType} dot={false} /> },
            { key: 'severityLevel', header: 'Severity', sortable: true, render: (a) => <StatusBadge map={SEVERITY} value={a.severityLevel} /> },
            { key: 'house', header: 'Household / device', render: (a) => <div><p className="font-medium text-ink">{a.houseName ?? '—'}</p><p className="font-mono text-xs text-muted">{a.deviceName ?? a.deviceId}</p></div> },
            { key: 'description', header: 'Description', className: 'max-w-md', render: (a) => <div><p className="text-[13px] text-ink-soft">{a.description}</p>{a.possibleLeakArea && <p className="mt-0.5 text-xs text-crit-700">Possible leak area: {a.possibleLeakArea}</p>}{a.resolutionNote && <p className="mt-0.5 text-xs text-ok-700">Resolution: {a.resolutionNote}</p>}</div> },
            { key: 'alertStatus', header: 'Status', sortable: true, render: (a) => <div className="space-y-1"><StatusBadge map={ALERT_STATUS} value={a.alertStatus} /><DataSourceBadge state={a.source === 'simulated' ? 'simulated' : 'device'} className="block w-fit" /></div> },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (a) =>
                a.alertStatus !== 'resolved' && (
                  <div className="flex justify-end gap-1.5">
                    {a.alertStatus === 'open' && <Button size="sm" variant="ghost" icon={Eye} onClick={() => acknowledge(a)}>Acknowledge</Button>}
                    <Button size="sm" variant="secondary" icon={CheckCheck} onClick={() => setResolving(a)}>Resolve</Button>
                  </div>
                ),
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <ResolveDialog alert={resolving} onClose={() => setResolving(null)} onDone={() => list.reload({ silent: true })} />
    </>
  );
}

export default withSuspense(AlertsPage);
