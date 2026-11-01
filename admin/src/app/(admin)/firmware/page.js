'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Download, Hourglass, Plus, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { useLive } from '@/components/layout/LiveProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { CONNECTION, FIRMWARE_STATUS, options } from '@/lib/labels';

const empty = { targetVersion: '', url: '', sha256: '', notes: '', deviceIds: [] };

function UpdateModal({ open, devices, onClose, onSaved }) {
  const toast = useToast();
  const form = useForm(empty, {
    validate: (v) => ({
      targetVersion: rules.required(v.targetVersion, 'Version') || (/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v.targetVersion.trim()) ? null : 'Use a version like 1.3.0'),
      url: rules.required(v.url, 'Firmware URL') || (v.url.trim().startsWith('https://') ? null : 'The firmware URL must use HTTPS'),
      sha256: v.sha256 && !/^[0-9a-fA-F]{64}$/.test(v.sha256.trim()) ? 'SHA-256 is 64 hexadecimal characters' : null,
      deviceIds: v.deviceIds.length ? null : 'Choose at least one device',
    }),
    onSubmit: async (v) => {
      const res = await api('/firmware', { method: 'POST', body: { ...v, targetVersion: v.targetVersion.trim(), url: v.url.trim(), sha256: v.sha256.trim() } });
      toast.success(`Update queued for ${res.created} device${res.created === 1 ? '' : 's'}`, res.skipped.length ? `Skipped: ${res.skipped.map((s) => `${s.deviceName} (${s.reason})`).join(', ')}` : 'Devices download it on their next check-in.');
      onSaved();
      onClose();
    },
  });

  useEffect(() => {
    if (open) form.reset(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const v = form.values;
  const eligible = devices.filter((d) => !d.activeUpdate);
  const toggle = (id) => form.set('deviceIds', v.deviceIds.includes(id) ? v.deviceIds.filter((x) => x !== id) : [...v.deviceIds, id]);
  const allSelected = eligible.length > 0 && eligible.every((d) => v.deviceIds.includes(d.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      size="lg"
      title="New firmware update"
      description="Devices receive the update from the device API on their next check-in, download it over HTTPS and report back."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="firmware-form" loading={form.submitting} icon={Download}>Queue update</Button>
        </>
      }
    >
      <form id="firmware-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Version" required placeholder="1.3.0" {...form.bind('targetVersion')} />
          <Input label="Firmware URL (.bin)" required className="sm:col-span-2" placeholder="https://…/seewater-esp32-1.3.0.bin" {...form.bind('url')} />
        </div>
        <Input label="SHA-256 checksum" placeholder="Optional — the device rejects an image that doesn’t match" className="font-mono" {...form.bind('sha256')} />
        <Textarea label="Release notes" rows={2} hint="For MCWD staff only" {...form.bind('notes')} />
        <Field label="Devices" required error={form.errors.deviceIds}>
          <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            <label className="flex items-center gap-3 bg-canvas px-3 py-2 text-[13px] font-semibold text-ink">
              <input type="checkbox" checked={allSelected} disabled={!eligible.length} onChange={() => form.set('deviceIds', allSelected ? [] : eligible.map((d) => d.id))} />
              Select all eligible ({eligible.length})
            </label>
            {devices.map((d) => (
              <label key={d.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <input type="checkbox" checked={v.deviceIds.includes(d.id)} disabled={Boolean(d.activeUpdate)} onChange={() => toggle(d.id)} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono font-semibold text-ink">{d.deviceName}</span>
                  <span className="text-muted"> · {d.houseName ?? 'Unassigned'}</span>
                  {d.isSimulated && <Badge tone="aqua" className="ml-2">Simulated</Badge>}
                </span>
                <span className="font-mono text-xs text-muted">{d.firmwareVersion ?? 'unknown'}</span>
                {d.activeUpdate ? <Badge tone="warn">Updating to {d.activeUpdate}</Badge> : <StatusBadge map={CONNECTION} value={d.connectionStatus} />}
              </label>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

export default function FirmwarePage() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const { liveKey } = useLive(['devices']);
  const list = useListQuery('/firmware', { liveKey, refreshMs: 30000 });
  const { data, params } = list;
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const s = data?.summary;
  const inProgress = s ? s.pending + s.downloading + s.installing : null;

  return (
    <>
      <PageHeader
        title="Firmware Update"
        description="Send over-the-air firmware updates to ESP32 gateways and track each device until it reports the new version."
        actions={canEdit && <Button icon={Plus} onClick={() => setOpen(true)} disabled={!data?.devices.length}>New update</Button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Activated devices" value={data?.devices.length ?? '—'} icon={Cpu} />
        <StatCard label="In progress" value={inProgress ?? '—'} icon={Hourglass} accent={inProgress ? 'warn' : 'ok'} />
        <StatCard label="Installed" value={s?.installed ?? '—'} icon={CheckCircle2} accent="ok" />
        <StatCard label="Failed" value={s?.failed ?? '—'} icon={XCircle} accent={s?.failed ? 'crit' : 'ok'} />
      </div>

      <Card className="mt-6">
        <CardHeader icon={Cpu} title="Firmware across devices" description="Version each activated device last reported in its heartbeat." />
        <CardBody className="flex flex-wrap gap-2">
          {data?.versions.length ? (
            data.versions.map((v) => (
              <Badge key={v.version} tone={v.version === 'unknown' ? 'neutral' : 'info'}>
                <span className="font-mono">{v.version}</span> · {v.devices} device{v.devices === 1 ? '' : 's'}
              </Badge>
            ))
          ) : (
            <p className="text-sm text-muted">No activated devices yet.</p>
          )}
        </CardBody>
      </Card>

      <div className="mb-4 mt-6 overflow-x-auto pb-1">
        <Tabs tabs={[{ value: '', label: 'All' }, ...options(FIRMWARE_STATUS).map((o) => ({ ...o, count: s?.[o.value] }))]} value={params.status ?? ''} onChange={(v) => list.setFilter('status', v)} />
      </div>
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search device, version, household…" className="md:w-80" />
        </TableToolbar>
        <DataTable
          minWidth={900}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'requestedAt'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={Download} title="No firmware updates yet" message="Queue an update to send new ESP32 firmware to one or more devices." />}
          columns={[
            { key: 'deviceName', header: 'Device', sortable: true, render: (j) => <div><p className="font-mono font-semibold text-ink">{j.deviceName}</p><p className="text-xs text-muted">{j.houseName ?? 'Unassigned'}</p></div> },
            { key: 'targetVersion', header: 'Version', sortable: true, className: 'whitespace-nowrap font-mono text-[13px]', render: (j) => `${j.fromVersion ?? '—'} → ${j.targetVersion}` },
            { key: 'status', header: 'Status', sortable: true, render: (j) => <div className="space-y-0.5"><StatusBadge map={FIRMWARE_STATUS} value={j.status} pulse={['downloading', 'installing'].includes(j.status)} />{j.message && <p className="max-w-xs text-xs text-muted">{j.message}</p>}</div> },
            { key: 'requestedAt', header: 'Requested', sortable: true, render: (j) => <div className="tabular whitespace-nowrap text-[13px]"><p>{fmtDateTime(j.requestedAt)}</p><p className="text-xs text-muted">by {j.requestedByName}</p></div> },
            { key: 'updatedAt', header: 'Last update', className: 'tabular whitespace-nowrap text-[13px]', render: (j) => fmtRelative(j.completedAt ?? j.updatedAt) },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (j) => j.status === 'pending' && <div className="flex justify-end"><Button size="sm" variant="ghost" icon={XCircle} onClick={() => setCancelling(j)}>Cancel</Button></div>,
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <UpdateModal open={open} devices={data?.devices ?? []} onClose={() => setOpen(false)} onSaved={() => list.reload({ silent: true })} />
      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this firmware update?"
        confirmLabel="Cancel update"
        message={`${cancelling?.deviceName} won’t install ${cancelling?.targetVersion}. Only updates the device hasn’t started can be cancelled.`}
        onConfirm={async () => {
          await api(`/firmware/${cancelling.id}/cancel`, { method: 'POST' });
          toast.success('Firmware update cancelled');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}
