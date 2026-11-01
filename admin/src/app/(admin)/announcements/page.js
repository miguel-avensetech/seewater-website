'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Archive, CalendarClock, FileText, Megaphone, Pencil, Plus, Send, Trash2, Paperclip, Upload, Wrench, X } from 'lucide-react';
import { ATTACHMENT_TYPES, fmtBytes, safeName, uploadFile, validateFile } from '@/lib/upload';
import { storageEnabled } from '@/lib/firebase';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { ANNOUNCEMENT_TABS, SectionTabs } from '@/components/layout/SectionTabs';
import { PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Input, Select, Textarea } from '@/components/ui/Field';
import { withSuspense } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, toDateTimeInput } from '@/lib/format';
import { ANNOUNCEMENT_CATEGORY, ANNOUNCEMENT_STATUS, PRIORITY, options } from '@/lib/labels';
import clsx from 'clsx';

const empty = {
  title: '',
  category: '',
  audience: 'all_users',
  audienceArea: '',
  priority: 'normal',
  message: '',
  action: 'publish',
  publishAt: '',
  attachmentUrl: '',
  // Uploaded file already stored on the announcement (Firebase Storage).
  attachment: null,
  hasInterruption: false,
  interruptionStart: '',
  interruptionEnd: '',
  interruptionArea: '',
};

function toForm(a) {
  if (!a) return empty;
  return {
    title: a.title,
    category: a.category,
    audience: a.audience,
    audienceArea: a.audienceArea ?? '',
    priority: a.priority,
    message: a.message,
    action: a.status === 'scheduled' ? 'schedule' : a.status === 'published' ? 'publish' : 'draft',
    publishAt: toDateTimeInput(a.publishAt),
    attachmentUrl: a.attachmentPath ? '' : a.attachmentUrl ?? '',
    attachment: a.attachmentPath ? { url: a.attachmentUrl, path: a.attachmentPath, name: a.attachmentName, contentType: a.attachmentContentType, size: a.attachmentSize } : null,
    hasInterruption: Boolean(a.interruption),
    interruptionStart: toDateTimeInput(a.interruption?.start),
    interruptionEnd: toDateTimeInput(a.interruption?.end),
    interruptionArea: a.interruption?.area ?? '',
  };
}

function AnnouncementModal({ open, announcement, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(announcement);
  const fileInput = useRef(null);
  const [file, setFile] = useState(null); // new file chosen, uploaded on save
  const [fileError, setFileError] = useState(null);
  const [progress, setProgress] = useState(null);
  const form = useForm(empty, {
    validate: (v) => ({
      title: rules.required(v.title, 'Title') || rules.minLen(v.title, 3),
      category: rules.required(v.category, 'Category'),
      message: rules.required(v.message, 'Message') || rules.minLen(v.message, 10),
      audienceArea: v.audience === 'specific_area' ? rules.required(v.audienceArea, 'Target area') : null,
      publishAt: v.action === 'schedule' ? rules.required(v.publishAt, 'Publish date') || (new Date(v.publishAt) <= new Date() ? 'Must be in the future' : null) : null,
      attachmentUrl: v.attachmentUrl && !/^https?:\/\/\S+$/.test(v.attachmentUrl) ? 'Enter a valid link (https://…)' : null,
    }),
    onSubmit: async (v) => {
      // Upload a newly chosen file to Firebase Storage first.
      let attachment = v.attachment;
      if (file) {
        setProgress(0);
        try {
          attachment = await uploadFile(`announcements/${crypto.randomUUID()}/${safeName(file.name)}`, file, { onProgress: setProgress });
        } finally {
          setProgress(null);
        }
      }
      const body = {
        title: v.title,
        category: v.category,
        audience: v.audience,
        audienceArea: v.audience === 'specific_area' ? v.audienceArea : '',
        priority: v.priority,
        message: v.message,
        action: v.action,
        publishAt: v.action === 'schedule' ? new Date(v.publishAt).toISOString() : null,
        attachmentUrl: attachment ? attachment.url : v.attachmentUrl,
        attachmentPath: attachment?.path ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentContentType: attachment?.contentType ?? null,
        attachmentSize: attachment?.size ?? null,
        // Interruption windows are managed on the Water Interruptions page; keep any linked snapshot.
        interruption: announcement?.interruption ?? null,
      };
      await api(editing ? `/announcements/${announcement.id}` : '/announcements', { method: editing ? 'PATCH' : 'POST', body });
      toast.success({ draft: 'Draft saved', publish: 'Announcement published', schedule: 'Announcement scheduled' }[v.action], v.title);
      onSaved();
      onClose();
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(toForm(announcement));
      setFile(null);
      setFileError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, announcement]);

  const v = form.values;
  const fieldErr = (k) => form.errors[k] || form.errors[`interruption.${k.replace('interruption', '').toLowerCase()}`];
  const submitLabel = { draft: 'Save draft', publish: editing && announcement.status === 'published' ? 'Save & keep published' : 'Publish now', schedule: 'Schedule' }[v.action];

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      size="lg"
      title={editing ? 'Edit announcement' : 'New announcement'}
      description="Announcements appear in the SeeWater mobile app for the selected audience."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="announcement-form" loading={form.submitting} icon={v.action === 'draft' ? FileText : v.action === 'schedule' ? CalendarClock : Send}>{submitLabel}</Button>
        </>
      }
    >
      <form id="announcement-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        <Input label="Title" required maxLength={100} {...form.bind('title')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Category" required placeholder="Choose…" options={options(ANNOUNCEMENT_CATEGORY)} {...form.bind('category')} />
          <Select label="Priority" options={options(PRIORITY)} {...form.bind('priority')} />
          <Select label="Audience" options={[{ value: 'all_users', label: 'All users' }, { value: 'specific_area', label: 'Specific area' }]} {...form.bind('audience')} />
        </div>
        {v.audience === 'specific_area' && <Input label="Target area" placeholder="e.g. Banilad, Talamban" required {...form.bind('audienceArea')} />}
        <Textarea label="Message" required rows={5} maxLength={5000} hint={`${v.message.length} / 5000`} {...form.bind('message')} />
        <div className="space-y-2 rounded-lg border border-line p-4">
          <p className="text-[13px] font-semibold text-ink-soft">Attachment <span className="font-normal text-muted">(optional)</span></p>
          {file || v.attachment ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                <Paperclip className="h-4 w-4 shrink-0 text-ocean-600" />
                {file ? (
                  <span className="truncate text-ink">{file.name} <span className="text-muted">· {fmtBytes(file.size)} · uploads when you save{progress !== null ? ` (${progress}%)` : ''}</span></span>
                ) : (
                  <a href={v.attachment.url} target="_blank" rel="noreferrer noopener" className="truncate font-medium text-ocean-700 hover:underline">{v.attachment.name} <span className="text-muted">· {fmtBytes(v.attachment.size)}</span></a>
                )}
              </span>
              <Button size="sm" variant="ghost" icon={X} disabled={form.submitting} onClick={() => { setFile(null); form.set('attachment', null); }}>Remove</Button>
            </div>
          ) : (
            <>
              <input
                ref={fileInput}
                type="file"
                accept={ATTACHMENT_TYPES.join(',')}
                className="hidden"
                aria-label="Upload attachment"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  const problem = f && validateFile(f, { types: ATTACHMENT_TYPES, maxBytes: 10 * 1024 * 1024 });
                  setFileError(problem || null);
                  if (f && !problem) {
                    setFile(f);
                    form.set('attachmentUrl', '');
                  }
                }}
              />
              {storageEnabled ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" icon={Upload} onClick={() => fileInput.current?.click()}>Upload file</Button>
                  <span className="text-xs text-muted">PDF, PNG, JPG or WebP up to 10 MB — or paste a link:</span>
                </div>
              ) : (
                <p className="text-xs text-muted">Paste a link to a PDF or image (file uploads need Firebase Storage, which isn’t enabled for this project).</p>
              )}
              <Input placeholder="https://…" aria-label="Attachment link" {...form.bind('attachmentUrl')} />
            </>
          )}
          {fileError && <p className="text-xs font-medium text-crit-700" role="alert">{fileError}</p>}
        </div>

        {v.category === 'service_advisory' && (
          <InlineNotice tone="info">
            Planning a water interruption? Create it on the <a href="/interruptions" className="font-semibold underline">Water Interruptions</a> page — it publishes the advisory and notifies affected homeowners for you.
          </InlineNotice>
        )}

        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink-soft">Publishing</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ['publish', 'Publish now', Send],
              ['schedule', 'Schedule', CalendarClock],
              ['draft', 'Save as draft', FileText],
            ].map(([value, label, Icon]) => (
              <label key={value} className={clsx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors', v.action === value ? 'border-ocean-500 bg-ocean-50 text-ocean-800' : 'border-line-strong text-ink-soft hover:bg-canvas')}>
                <input type="radio" name="action" value={value} checked={v.action === value} onChange={() => form.set('action', value)} className="sr-only" />
                <Icon className="h-4 w-4" /> {label}
              </label>
            ))}
          </div>
          {v.action === 'schedule' && <Input className="mt-3 sm:w-72" label="Publish on" type="datetime-local" required min={toDateTimeInput(new Date())} {...form.bind('publishAt')} />}
        </fieldset>
      </form>
    </Modal>
  );
}

function AnnouncementsPage() {
  const sp = useSearchParams();
  const toast = useToast();
  const { canEdit } = useAuth();
  const list = useListQuery('/announcements', { initial: { category: sp.get('category') || undefined } });
  const { data, params } = list;
  const [modal, setModal] = useState({ open: false, item: null });
  const [confirm, setConfirm] = useState(null);
  const s = data?.summary;

  async function publishDraft(a) {
    try {
      const { title, category, audience, audienceArea, priority, message, attachmentUrl, attachmentPath, attachmentName, attachmentContentType, attachmentSize, interruption } = a;
      await api(`/announcements/${a.id}`, { method: 'PATCH', body: { title, category, audience, audienceArea, priority, message, attachmentUrl, attachmentPath, attachmentName, attachmentContentType, attachmentSize, interruption, action: 'publish' } });
      toast.success('Announcement published', a.title);
      list.reload({ silent: true });
    } catch (err) {
      toast.error('Could not publish', err.message);
    }
  }

  return (
    <>
      <SectionTabs tabs={ANNOUNCEMENT_TABS} />
      <PageHeader
        title="Announcements"
        description="Service advisories, billing notices, water conservation reminders and customer tips for homeowners."
        actions={canEdit && <Button icon={Plus} onClick={() => setModal({ open: true, item: null })}>New announcement</Button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total" value={s?.total ?? '—'} icon={Megaphone} />
        <StatCard label="Published" value={s?.published ?? '—'} icon={Send} accent="ok" />
        <StatCard label="Scheduled" value={s?.scheduled ?? '—'} icon={CalendarClock} accent="aqua" />
        <StatCard label="Drafts" value={s?.drafts ?? '—'} icon={FileText} accent="navy" />
      </div>

      <div className="mb-4 mt-6 overflow-x-auto pb-1">
        <Tabs tabs={[{ value: '', label: 'All' }, ...options(ANNOUNCEMENT_STATUS).map((o) => ({ value: o.value, label: o.label }))]} value={params.status ?? ''} onChange={(v) => list.setFilter('status', v)} />
      </div>
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search title or message…" className="md:w-80" />
          <FilterSelect label="Category" value={params.category} onChange={(v) => list.setFilter('category', v)} placeholder="All categories" options={options(ANNOUNCEMENT_CATEGORY)} />
        </TableToolbar>
        <DataTable
          minWidth={960}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'createdAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={Megaphone} title="No announcements" message="Create an announcement to notify homeowners." action={canEdit && <Button icon={Plus} onClick={() => setModal({ open: true, item: null })}>New announcement</Button>} />}
          columns={[
            {
              key: 'title',
              header: 'Announcement',
              sortable: true,
              className: 'max-w-md',
              render: (a) => (
                <div>
                  <p className="font-semibold text-ink">{a.title}</p>
                  <p className="line-clamp-1 text-xs text-muted">{a.message}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-faint">
                    {a.interruption && <span className="inline-flex items-center gap-1 text-warn-700"><Wrench className="h-3 w-3" />Interruption: {a.interruption.area}, {fmtDateTime(a.interruption.start)}</span>}
                    {a.attachmentUrl && <a href={a.attachmentUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-ocean-700 hover:underline"><Paperclip className="h-3 w-3" />{a.attachmentName ?? 'Attachment'}</a>}
                  </div>
                </div>
              ),
            },
            { key: 'category', header: 'Category', render: (a) => <StatusBadge map={ANNOUNCEMENT_CATEGORY} value={a.category} dot={false} /> },
            { key: 'audience', header: 'Audience', className: 'text-[13px]', render: (a) => (a.audience === 'all_users' ? 'All users' : a.audienceArea) },
            { key: 'priority', header: 'Priority', sortable: true, render: (a) => <StatusBadge map={PRIORITY} value={a.priority} /> },
            { key: 'status', header: 'Status', render: (a) => <div><StatusBadge map={ANNOUNCEMENT_STATUS} value={a.status} /><p className="tabular mt-1 whitespace-nowrap text-xs text-faint">{a.status === 'scheduled' ? fmtDateTime(a.publishAt) : a.status === 'published' ? fmtDateTime(a.publishedAt) : `Edited ${fmtDateTime(a.updatedAt)}`}</p></div> },
            { key: 'authorName', header: 'Author', className: 'text-[13px]' },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (a) => (
                <div className="flex justify-end gap-1">
                  {a.status === 'draft' && <Button size="sm" variant="ghost" icon={Send} onClick={() => publishDraft(a)}>Publish</Button>}
                  {a.status !== 'archived' && <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setModal({ open: true, item: a })} />}
                  {a.status === 'published' && <Button size="icon-sm" variant="ghost" icon={Archive} aria-label="Archive" onClick={() => setConfirm({ type: 'archive', item: a })} />}
                  <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => setConfirm({ type: 'delete', item: a })} />
                </div>
              ),
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <AnnouncementModal open={modal.open} announcement={modal.item} onClose={() => setModal({ open: false, item: null })} onSaved={() => list.reload({ silent: true })} />
      <ConfirmDialog
        open={confirm?.type === 'delete'}
        onClose={() => setConfirm(null)}
        title="Delete announcement?"
        confirmLabel="Delete"
        message={`"${confirm?.item?.title}" will be permanently deleted${confirm?.item?.status === 'published' ? ' and removed from the mobile app' : ''}.`}
        onConfirm={async () => {
          await api(`/announcements/${confirm.item.id}`, { method: 'DELETE' });
          toast.success('Announcement deleted');
          list.reload({ silent: true });
        }}
      />
      <ConfirmDialog
        open={confirm?.type === 'archive'}
        onClose={() => setConfirm(null)}
        tone="primary"
        title="Archive announcement?"
        confirmLabel="Archive"
        message="Archived announcements are hidden from homeowners but kept for your records."
        onConfirm={async () => {
          await api(`/announcements/${confirm.item.id}/archive`, { method: 'POST' });
          toast.success('Announcement archived');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}

export default withSuspense(AnnouncementsPage);
