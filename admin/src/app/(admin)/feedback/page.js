'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Inbox, MessageSquareText, Reply, Search as SearchIcon, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { DescriptionList, PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { DataSourceBadge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Select, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { FEEDBACK_STATUS, FEEDBACK_TYPE, options } from '@/lib/labels';

function FeedbackModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const { canEdit } = useAuth();
  const [status, setStatus] = useState('new');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (item) {
      setStatus(item.status === 'new' ? 'in_review' : item.status);
      setResponse(item.response ?? '');
      setError(null);
    }
  }, [item]);

  async function save() {
    if (status === 'resolved' && response.trim().length < 5) {
      setError('Write a response to the homeowner before resolving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/feedback/${item.id}`, { method: 'PATCH', body: { status, response } });
      toast.success('Feedback updated', response !== (item.response ?? '') ? 'Response sent to the homeowner’s notifications.' : undefined);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.fields?.response || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={item?.subject}
      description={item && `${FEEDBACK_TYPE[item.type]?.label} from ${item.userName} · ${fmtDateTime(item.createdAt)}`}
      footer={
        canEdit && (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} loading={busy} icon={Reply}>Save & notify</Button>
          </>
        )
      }
    >
      {item && (
        <div className="space-y-5">
          {item.source === 'simulated' && <DataSourceBadge state="simulated" />}
          <DescriptionList
            items={[
              { label: 'Homeowner', value: item.userName },
              { label: 'Email', value: item.userEmail },
              { label: 'Address', value: item.userAddress },
              { label: 'Current status', value: <StatusBadge map={FEEDBACK_STATUS} value={item.status} /> },
            ]}
          />
          <div className="rounded-lg bg-canvas p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">Message</p>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">{item.message}</p>
          </div>
          {item.respondedAt && (
            <p className="text-xs text-muted">Last response by {item.respondedByName ?? 'an administrator'} {fmtRelative(item.respondedAt)}.</p>
          )}
          {canEdit ? (
            <div className="space-y-4">
              <Select label="Status" options={options(FEEDBACK_STATUS)} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-60" />
              <Textarea label="Response to homeowner" rows={4} maxLength={2000} value={response} onChange={(e) => setResponse(e.target.value)} hint="Sent to the homeowner’s in-app notifications when changed." placeholder="Thank you for reporting this. Our team will…" />
              {error && <InlineNotice tone="crit">{error}</InlineNotice>}
            </div>
          ) : (
            item.response && (
              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">Response</p>
                <p className="mt-1.5 text-sm text-ink">{item.response}</p>
              </div>
            )
          )}
        </div>
      )}
    </Modal>
  );
}

export default function FeedbackPage() {
  const list = useListQuery('/feedback');
  const { data, params } = list;
  const [open, setOpen] = useState(null);
  const s = data?.summary;

  return (
    <>
      <PageHeader title="Feedback" description="Suggestions, complaints and reports submitted by homeowners through the SeeWater app." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="New" value={s?.new ?? '—'} icon={Inbox} accent={s?.new ? 'ocean' : 'ok'} />
        <StatCard label="In review" value={s?.in_review ?? '—'} icon={SearchIcon} accent="warn" />
        <StatCard label="Resolved" value={s?.resolved ?? '—'} icon={CheckCircle2} accent="ok" />
        <StatCard label="Closed" value={s?.closed ?? '—'} icon={XCircle} accent="navy" />
      </div>

      <div className="mb-4 mt-6 overflow-x-auto pb-1">
        <Tabs tabs={[{ value: '', label: 'All' }, ...options(FEEDBACK_STATUS).map((o) => ({ ...o, count: s?.[o.value] }))]} value={params.status ?? ''} onChange={(v) => list.setFilter('status', v)} />
      </div>
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search subject, message, homeowner…" className="md:w-80" />
          <FilterSelect label="Type" value={params.type} onChange={(v) => list.setFilter('type', v)} placeholder="All types" options={options(FEEDBACK_TYPE)} />
        </TableToolbar>
        <DataTable
          minWidth={860}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'createdAt'}
          order={params.order}
          onSort={list.toggleSort}
          onRowClick={setOpen}
          empty={<EmptyState icon={MessageSquareText} title="No feedback" message="Homeowner feedback submitted from the mobile app appears here." />}
          columns={[
            { key: 'userName', header: 'Homeowner', sortable: true, render: (f) => <div><p className="font-semibold text-ink">{f.userName}</p><p className="text-xs text-muted">{f.userEmail}</p></div> },
            { key: 'type', header: 'Type', sortable: true, render: (f) => <StatusBadge map={FEEDBACK_TYPE} value={f.type} dot={false} /> },
            { key: 'subject', header: 'Message', className: 'max-w-md', render: (f) => <div><p className="font-medium text-ink">{f.subject}</p><p className="line-clamp-1 text-xs text-muted">{f.message}</p></div> },
            { key: 'createdAt', header: 'Date', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (f) => fmtDateTime(f.createdAt) },
            { key: 'status', header: 'Status', sortable: true, render: (f) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge map={FEEDBACK_STATUS} value={f.status} />{f.source === 'simulated' && <DataSourceBadge state="simulated" />}</div> },
          ]}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <FeedbackModal item={open} onClose={() => setOpen(null)} onSaved={() => list.reload({ silent: true })} />
    </>
  );
}
