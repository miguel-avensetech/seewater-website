'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Construction, Pencil, Plus, RotateCcw, XCircle, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { ANNOUNCEMENT_TABS, SectionTabs } from '@/components/layout/SectionTabs';
import { PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, toDateTimeInput } from '@/lib/format';
import { INTERRUPTION_STATUS, INTERRUPTION_TYPE, options } from '@/lib/labels';

const empty = { title: '', type: 'planned', reason: '', areas: '', startAt: '', endAt: '', notes: '', notifyHomeowners: true };

function InterruptionModal({ open, item, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(item);
  const form = useForm(empty, {
    validate: (v) => ({
      title: rules.required(v.title, 'Title') || rules.minLen(v.title, 3),
      reason: rules.required(v.reason, 'Reason') || rules.minLen(v.reason, 5),
      areas: rules.required(v.areas, 'Affected areas'),
      startAt: rules.required(v.startAt, 'Start'),
      endAt: v.type === 'planned' && !v.endAt ? 'Planned interruptions need an expected end' : v.endAt && v.startAt && v.endAt <= v.startAt ? 'Must be after the start' : null,
    }),
    onSubmit: async (v) => {
      const body = { ...v, startAt: new Date(v.startAt).toISOString(), endAt: v.endAt ? new Date(v.endAt).toISOString() : null };
      const res = await api(editing ? `/interruptions/${item.id}` : '/interruptions', { method: editing ? 'PATCH' : 'POST', body });
      toast.success(editing ? 'Interruption updated' : 'Interruption created', v.notifyHomeowners && !editing ? `Advisory published · ${res.notified} homeowner${res.notified === 1 ? '' : 's'} notified` : undefined);
      onSaved();
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(item ? { title: item.title, type: item.type, reason: item.reason, areas: item.areas, startAt: toDateTimeInput(item.startAt), endAt: toDateTimeInput(item.endAt), notes: item.notes ?? '', notifyHomeowners: Boolean(item.announcementId) } : empty);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const v = form.values;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      size="lg"
      title={editing ? 'Edit water interruption' : 'New water interruption'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="interruption-form" loading={form.submitting}>{editing ? 'Save changes' : 'Create interruption'}</Button>
        </>
      }
    >
      <form id="interruption-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Title" required className="sm:col-span-2" placeholder="e.g. Main line repair — Banilad" {...form.bind('title')} />
          <Select label="Type" options={options(INTERRUPTION_TYPE)} {...form.bind('type')} />
        </div>
        <Input label="Affected areas" required placeholder="Barangays or streets, comma-separated" hint="Homeowners whose address mentions one of these areas are notified" {...form.bind('areas')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Starts" type="datetime-local" required {...form.bind('startAt')} />
          <Input label={v.type === 'emergency' ? 'Expected restoration (optional)' : 'Expected end'} type="datetime-local" required={v.type === 'planned'} {...form.bind('endAt')} />
        </div>
        <Textarea label="Reason / details for homeowners" required rows={3} {...form.bind('reason')} />
        <Textarea label="Internal notes" rows={2} hint="Not shown to homeowners" {...form.bind('notes')} />
        <div className="rounded-lg border border-line p-4">
          <Switch checked={v.notifyHomeowners} onChange={(c) => form.set('notifyHomeowners', c)} label="Publish advisory and notify homeowners" description={editing ? 'Updates the linked service advisory.' : 'Publishes a service advisory for the affected areas and sends an in-app notification to matching homeowners.'} />
        </div>
      </form>
    </Modal>
  );
}

export default function InterruptionsPage() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const list = useListQuery('/interruptions');
  const { data, params } = list;
  const [modal, setModal] = useState({ open: false, item: null });
  const [closing, setClosing] = useState(null);
  const s = data?.summary;

  return (
    <>
      <SectionTabs tabs={ANNOUNCEMENT_TABS} />
      <PageHeader
        title="Water Interruptions"
        description="Planned maintenance and emergency service interruptions. Status updates automatically from the schedule."
        actions={canEdit && <Button icon={Plus} onClick={() => setModal({ open: true, item: null })}>New interruption</Button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Ongoing" value={s?.ongoing ?? '—'} icon={Zap} accent={s?.ongoing ? 'crit' : 'ok'} />
        <StatCard label="Scheduled" value={s?.scheduled ?? '—'} icon={CalendarClock} accent="ocean" />
        <StatCard label="Completed" value={s?.completed ?? '—'} icon={CheckCircle2} accent="ok" />
        <StatCard label="Cancelled" value={s?.cancelled ?? '—'} icon={XCircle} accent="navy" />
      </div>

      <div className="mb-4 mt-6 overflow-x-auto pb-1">
        <Tabs tabs={[{ value: '', label: 'All' }, ...options(INTERRUPTION_STATUS).map((o) => ({ ...o, count: s?.[o.value] }))]} value={params.status ?? ''} onChange={(v) => list.setFilter('status', v)} />
      </div>
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title, area, reason…" className="md:w-80" />
          <FilterSelect label="Type" value={params.type} onChange={(v) => list.setFilter('type', v)} placeholder="All types" options={options(INTERRUPTION_TYPE)} />
        </TableToolbar>
        <DataTable
          minWidth={960}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'startAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={Construction} title="No water interruptions" message="Record planned maintenance or emergency interruptions so homeowners are informed." action={canEdit && <Button size="sm" icon={Plus} onClick={() => setModal({ open: true, item: null })}>New interruption</Button>} />}
          columns={[
            { key: 'title', header: 'Interruption', sortable: true, className: 'max-w-sm', render: (i) => <div><p className="font-semibold text-ink">{i.title}</p><p className="line-clamp-1 text-xs text-muted">{i.reason}</p></div> },
            { key: 'type', header: 'Type', render: (i) => <StatusBadge map={INTERRUPTION_TYPE} value={i.type} dot={false} /> },
            { key: 'areas', header: 'Affected areas', className: 'max-w-xs text-[13px]' },
            { key: 'startAt', header: 'Window', sortable: true, render: (i) => <div className="tabular whitespace-nowrap text-[13px]"><p>{fmtDateTime(i.startAt)}</p><p className="text-muted">→ {i.restoredAt ? `restored ${fmtDateTime(i.restoredAt)}` : i.endAt ? fmtDateTime(i.endAt) : 'until restored'}</p></div> },
            { key: 'status', header: 'Status', render: (i) => <div className="space-y-1"><StatusBadge map={INTERRUPTION_STATUS} value={i.status} pulse={i.status === 'ongoing'} />{i.announcementId && <p className="text-xs text-muted">Advisory published</p>}</div> },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (i) =>
                (i.status === 'scheduled' || i.status === 'ongoing') && (
                  <div className="flex justify-end gap-1">
                    <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setModal({ open: true, item: i })} />
                    {i.status === 'ongoing' && <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setClosing({ item: i, action: 'restore' })}>Restored</Button>}
                    <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setClosing({ item: i, action: 'cancel' })}>Cancel</Button>
                  </div>
                ),
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <InterruptionModal open={modal.open} item={modal.item} onClose={() => setModal({ open: false, item: null })} onSaved={() => list.reload({ silent: true })} />
      <ConfirmDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        tone={closing?.action === 'restore' ? 'primary' : 'danger'}
        title={closing?.action === 'restore' ? 'Mark water service restored?' : 'Cancel this interruption?'}
        confirmLabel={closing?.action === 'restore' ? 'Mark restored' : 'Cancel interruption'}
        message={`${closing?.item.title}. The linked advisory (if any) is archived.`}
        onConfirm={async () => {
          await api(`/interruptions/${closing.item.id}/close`, { method: 'POST', body: { action: closing.action } });
          toast.success(closing.action === 'restore' ? 'Service marked restored' : 'Interruption cancelled');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}
