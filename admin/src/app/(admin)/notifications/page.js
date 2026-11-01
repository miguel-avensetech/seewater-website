'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BellRing, Eye, MailOpen, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useListQuery } from '@/hooks/useListQuery';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Input, Select, Textarea } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { NOTIFICATION_KIND, lookup } from '@/lib/labels';

function SendDialog({ open, onClose, onSent }) {
  const toast = useToast();
  const users = useApi(open ? '/users' : null, { query: { pageSize: 100, sort: 'fullName', order: 'asc', status: 'active' } });
  const form = useForm(
    { audience: 'all', userId: '', title: '', message: '' },
    {
      validate: (v) => ({
        userId: v.audience === 'user' ? rules.required(v.userId, 'Homeowner') : null,
        title: rules.required(v.title, 'Title') || rules.minLen(v.title, 3),
        message: rules.required(v.message, 'Message') || rules.minLen(v.message, 5),
      }),
      onSubmit: async (v) => {
        const res = await api('/notifications', { method: 'POST', body: { audience: v.audience, userId: v.audience === 'user' ? v.userId : undefined, title: v.title, message: v.message } });
        toast.success(res.sent ? `Sent to ${res.sent} homeowner${res.sent === 1 ? '' : 's'}` : 'No active homeowners to notify');
        onSent();
        onClose();
        form.reset();
      },
    },
  );
  const v = form.values;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      title="Send notification"
      description="Delivered to the homeowners’ in-app inbox, and as a push notification on phones that registered for push."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="send-form" icon={Send} loading={form.submitting}>Send</Button>
        </>
      }
    >
      <form id="send-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        <Select label="Recipients" options={[{ value: 'all', label: 'All active homeowners' }, { value: 'user', label: 'One homeowner' }]} {...form.bind('audience')} />
        {v.audience === 'user' && (
          <Select label="Homeowner" required placeholder={users.loading ? 'Loading…' : users.data?.items.length ? 'Choose a homeowner' : 'No active homeowners yet'} options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.fullName} — ${u.email}` }))} {...form.bind('userId')} />
        )}
        <Input label="Title" required maxLength={100} {...form.bind('title')} />
        <Textarea label="Message" required rows={4} maxLength={1000} {...form.bind('message')} />
      </form>
    </Modal>
  );
}

export default function NotificationsPage() {
  const { canEdit } = useAuth();
  const list = useListQuery('/notifications');
  const { data, params } = list;
  const [sendOpen, setSendOpen] = useState(false);
  const s = data?.summary;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Messages delivered to homeowners — leak and high-flow alerts, device and valve updates, feedback replies and announcements from MCWD."
        actions={canEdit && <Button icon={Send} onClick={() => setSendOpen(true)}>Send notification</Button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Sent" value={s?.total ?? '—'} icon={BellRing} />
        <StatCard label="Unread by homeowners" value={s?.unread ?? '—'} icon={MailOpen} accent={s?.unread ? 'warn' : 'ok'} />
        <StatCard label="Alert notifications" value={s?.alerts ?? '—'} icon={Eye} accent="crit" className="col-span-2 lg:col-span-1" />
      </div>

      <Card className="mt-6">
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title, message, homeowner…" className="md:w-80" />
          <FilterSelect label="Type" value={params.type} onChange={(v) => list.setFilter('type', v)} placeholder="All types" options={(data?.types ?? []).map((t) => ({ value: t, label: lookup(NOTIFICATION_KIND, t).label }))} />
          <FilterSelect label="Read status" value={params.read} onChange={(v) => list.setFilter('read', v)} placeholder="Read & unread" options={[{ value: 'false', label: 'Unread' }, { value: 'true', label: 'Read' }]} />
          <ClearFilters params={params} keys={['type', 'read']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={900}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'sentAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={BellRing} title="No notifications yet" message="Notifications are created automatically for alerts, valve changes and feedback replies, or you can send one." action={canEdit && <Button size="sm" icon={Send} onClick={() => setSendOpen(true)}>Send notification</Button>} />}
          columns={[
            { key: 'sentAt', header: 'Sent', sortable: true, render: (n) => <div className="whitespace-nowrap"><p className="text-ink">{fmtRelative(n.sentAt)}</p><p className="text-xs text-faint">{fmtDateTime(n.sentAt)}</p></div> },
            { key: 'notificationType', header: 'Type', sortable: true, render: (n) => <StatusBadge map={NOTIFICATION_KIND} value={n.notificationType} dot={false} /> },
            { key: 'title', header: 'Message', className: 'max-w-md', render: (n) => <div><p className="font-medium text-ink">{n.title}</p><p className="line-clamp-2 text-xs text-muted">{n.message}</p></div> },
            { key: 'userName', header: 'Homeowner', render: (n) => <Link href={`/users/${n.userId}`} className="text-[13px] font-medium text-ocean-700 hover:underline">{n.userName}</Link> },
            { key: 'isRead', header: 'Status', render: (n) => (n.isRead ? <span className="text-[13px] text-muted">Read {n.readAt ? fmtRelative(n.readAt) : ''}</span> : <span className="text-[13px] font-semibold text-ocean-700">Unread</span>) },
          ]}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
      <SendDialog open={sendOpen} onClose={() => setSendOpen(false)} onSent={() => list.reload({ silent: true })} />
    </>
  );
}
