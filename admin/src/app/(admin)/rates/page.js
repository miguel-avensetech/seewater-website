'use client';

import { useEffect, useState } from 'react';
import { Calculator, FileText, Plus, Receipt, Send, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { ANNOUNCEMENT_TABS, SectionTabs } from '@/components/layout/SectionTabs';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, TableToolbar, SearchInput } from '@/components/ui/DataTable';
import { FilterSelect, Input, Select, Switch, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, fmtLiters, fmtNumber, toDateInput } from '@/lib/format';
import { CUSTOMER_CLASS, RATE_STATUS, options } from '@/lib/labels';

const peso = (v) => `₱${fmtNumber(v, 2)}`;
const blankTier = (from) => ({ fromM3: from, toM3: '', ratePerM3: '' });
const emptyRate = { name: '', customerClass: 'residential', effectiveDate: toDateInput(Date.now()), minimumVolumeM3: 10, minimumCharge: '', notes: '', tiers: [blankTier(10)] };

function RateModal({ open, rate, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(rate);
  const [v, setV] = useState(emptyRate);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    if (open) {
      setV(rate ? { ...rate, tiers: rate.tiers.map((t) => ({ ...t, toM3: t.toM3 ?? '' })) } : emptyRate);
      setErrors({});
      setFormError(null);
    }
  }, [open, rate]);

  const set = (k, val) => setV((s) => ({ ...s, [k]: val }));
  // Each tier starts where the previous one ends.
  const setTier = (i, k, val) =>
    setV((s) => {
      const tiers = s.tiers.map((t, j) => (j === i ? { ...t, [k]: val } : t));
      for (let j = 1; j < tiers.length; j++) tiers[j] = { ...tiers[j], fromM3: Number(tiers[j - 1].toM3) || tiers[j].fromM3 };
      return { ...s, tiers };
    });

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    const body = {
      ...v,
      minimumVolumeM3: Number(v.minimumVolumeM3),
      minimumCharge: Number(v.minimumCharge),
      tiers: v.tiers.map((t, i) => ({ fromM3: i === 0 ? Number(v.minimumVolumeM3) : Number(t.fromM3), toM3: i === v.tiers.length - 1 ? null : Number(t.toM3), ratePerM3: Number(t.ratePerM3) })),
    };
    try {
      await api(editing ? `/rates/${rate.id}` : '/rates', { method: editing ? 'PATCH' : 'POST', body });
      toast.success(editing ? 'Draft updated' : 'Rate schedule saved as draft');
      onSaved();
      onClose();
    } catch (err) {
      setErrors(err.fields ?? {});
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={editing ? 'Edit draft rate schedule' : 'New rate schedule'}
      description="Rates are entered in Philippine pesos per cubic metre (1 m³ = 1,000 L), as printed on MCWD bills."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} loading={busy} icon={FileText}>Save draft</Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <InlineNotice tone="crit">{formError}</InlineNotice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Schedule name" required className="sm:col-span-2" placeholder="e.g. 2027 residential tariff" value={v.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
          <Select label="Customer class" options={options(CUSTOMER_CLASS)} value={v.customerClass} onChange={(e) => set('customerClass', e.target.value)} />
          <Input label="Effective date" type="date" required value={v.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} error={errors.effectiveDate} />
          <Input label="Minimum volume" type="number" suffix="m³" value={v.minimumVolumeM3} onChange={(e) => { set('minimumVolumeM3', e.target.value); setTier(0, 'fromM3', Number(e.target.value)); }} error={errors.minimumVolumeM3} />
          <Input label="Minimum charge" type="number" step="0.01" suffix="₱" value={v.minimumCharge} onChange={(e) => set('minimumCharge', e.target.value)} error={errors.minimumCharge} />
        </div>
        <div className="rounded-lg border border-line">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 border-b border-line bg-canvas px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
            <span>From (m³)</span><span>To (m³)</span><span>Rate (₱ / m³)</span><span className="sr-only">Remove</span>
          </div>
          {v.tiers.map((t, i) => {
            const last = i === v.tiers.length - 1;
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-3 px-3 py-2">
                <Input aria-label={`Tier ${i + 1} from`} value={i === 0 ? v.minimumVolumeM3 : t.fromM3} disabled error={errors[`tiers.${i}.fromM3`]} />
                {last ? <p className="flex h-10 items-center text-[13px] text-muted">and above</p> : <Input aria-label={`Tier ${i + 1} to`} type="number" value={t.toM3} onChange={(e) => setTier(i, 'toM3', e.target.value)} error={errors[`tiers.${i}.toM3`]} />}
                <Input aria-label={`Tier ${i + 1} rate`} type="number" step="0.01" value={t.ratePerM3} onChange={(e) => setTier(i, 'ratePerM3', e.target.value)} error={errors[`tiers.${i}.ratePerM3`]} />
                <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label={`Remove tier ${i + 1}`} disabled={v.tiers.length === 1} onClick={() => setV((s) => ({ ...s, tiers: s.tiers.filter((_, j) => j !== i) }))} className="mt-1" />
              </div>
            );
          })}
          <div className="border-t border-line px-3 py-2">
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setV((s) => {
              const tiers = [...s.tiers];
              const prev = tiers[tiers.length - 1];
              const start = Number(prev.fromM3 || s.minimumVolumeM3) + 10;
              tiers[tiers.length - 1] = { ...prev, toM3: prev.toM3 || start };
              tiers.push(blankTier(Number(tiers[tiers.length - 1].toM3)));
              return { ...s, tiers };
            })}>Add tier</Button>
            {errors.tiers && <p className="text-xs font-medium text-crit-700">{errors.tiers}</p>}
          </div>
        </div>
        <Textarea label="Notes" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} hint="e.g. board resolution number, surcharges not modelled here" />
      </div>
    </Modal>
  );
}

function Estimator({ activeCount }) {
  const houses = useApi('/houses');
  const [houseId, setHouseId] = useState('');
  const [customerClass, setCustomerClass] = useState('residential');
  const { data, error, loading } = useApi(houseId ? '/rates/estimate' : null, { query: { houseId, customerClass } });

  return (
    <Card>
      <CardHeader icon={Calculator} title="Usage estimate" description="Month-to-date SeeWater readings × the active rate schedule. Not an official bill." />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect label="Household" value={houseId} onChange={setHouseId} placeholder={houses.data?.items.length ? 'Choose a household' : 'No households yet'} options={(houses.data?.items ?? []).map((h) => ({ value: h.id, label: `${h.houseName} — ${h.ownerName ?? 'no owner'}` }))} />
          <FilterSelect label="Customer class" value={customerClass} onChange={(v) => setCustomerClass(v || 'residential')} placeholder="Customer class" options={options(CUSTOMER_CLASS)} />
        </div>
        {!activeCount ? (
          <p className="text-[13px] text-muted">Publish a rate schedule to enable estimates.</p>
        ) : !houseId ? (
          <p className="text-[13px] text-muted">Choose a household to estimate its charge for this month.</p>
        ) : error ? (
          <InlineNotice tone="warn">{error.message}</InlineNotice>
        ) : loading || !data ? (
          <p className="text-[13px] text-muted">Calculating…</p>
        ) : !data.hasData ? (
          <p className="text-[13px] text-muted">No data yet — this household has no metered usage this month.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] text-muted">{fmtLiters(data.liters)} = {fmtNumber(data.cubicMeters, 2)} m³ · {data.rate.name}</p>
              <p className="tabular text-2xl font-bold text-ink">{peso(data.estimate.total)}</p>
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
              {data.estimate.lines.map((l) => (
                <li key={l.label} className="flex justify-between px-3 py-2"><span>{l.label} <span className="text-muted">({fmtNumber(l.m3, 2)} m³)</span></span><span className="tabular font-medium">{peso(l.amount)}</span></li>
              ))}
            </ul>
            <p className="text-xs text-muted">{data.disclaimer}{data.sources.includes('simulated') && ' Includes simulated readings.'}</p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function RatesPage() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const list = useListQuery('/rates');
  const { data, params } = list;
  const [modal, setModal] = useState({ open: false, rate: null });
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const s = data?.summary;

  return (
    <>
      <SectionTabs tabs={ANNOUNCEMENT_TABS} />
      <PageHeader
        title="Rate Updates"
        description="Tariff schedules used for billing updates and usage estimates. SeeWater does not issue official bills or process payments."
        actions={canEdit && <Button icon={Plus} onClick={() => setModal({ open: true, rate: null })}>New rate schedule</Button>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active" value={s?.active ?? '—'} icon={Receipt} accent="ok" hint={data?.active?.length ? data.active.map((r) => `${r.customerClass}: ${r.name}`).join(' · ') : 'No active schedule'} />
        <StatCard label="Scheduled" value={s?.scheduled ?? '—'} icon={Send} accent="ocean" />
        <StatCard label="Drafts" value={s?.draft ?? '—'} icon={FileText} accent="navy" />
        <StatCard label="Superseded" value={s?.superseded ?? '—'} icon={AlertTriangle} accent="navy" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <TableToolbar>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search schedules…" className="md:w-64" />
            <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="Any status" options={options(RATE_STATUS)} />
            <FilterSelect label="Class" value={params.customerClass} onChange={(v) => list.setFilter('customerClass', v)} placeholder="All classes" options={options(CUSTOMER_CLASS)} />
          </TableToolbar>
          <DataTable
            minWidth={720}
            rows={data?.items}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            sort={params.sort ?? 'effectiveDate'}
            order={params.order}
            onSort={list.toggleSort}
            empty={<EmptyState icon={Receipt} title="No rate schedules yet" message="Add MCWD’s current tariff so billing notices and usage estimates use the right rates." action={canEdit && <Button size="sm" icon={Plus} onClick={() => setModal({ open: true, rate: null })}>New rate schedule</Button>} />}
            columns={[
              { key: 'name', header: 'Schedule', sortable: true, render: (r) => <div><p className="font-semibold text-ink">{r.name}</p><p className="text-xs text-muted">{CUSTOMER_CLASS[r.customerClass]?.label} · min. {peso(r.minimumCharge)} / {r.minimumVolumeM3} m³</p></div> },
              { key: 'tiers', header: 'Tiers (₱/m³)', className: 'text-[13px]', render: (r) => r.tiers.map((t) => `${t.fromM3}–${t.toM3 ?? '∞'}: ${fmtNumber(t.ratePerM3, 2)}`).join(' · ') },
              { key: 'effectiveDate', header: 'Effective', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (r) => fmtDate(`${r.effectiveDate}T00:00:00`) },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge map={RATE_STATUS} value={r.status} /> },
              canEdit && {
                key: 'actions',
                header: <span className="sr-only">Actions</span>,
                render: (r) =>
                  r.status === 'draft' && (
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setModal({ open: true, rate: r })} />
                      <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => setDeleting(r)} />
                      <Button size="sm" variant="secondary" icon={Send} onClick={() => setPublishing(r)}>Publish</Button>
                    </div>
                  ),
              },
            ].filter(Boolean)}
          />
          {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
        </Card>
        <Estimator activeCount={s?.active ?? 0} />
      </div>

      <RateModal open={modal.open} rate={modal.rate} onClose={() => setModal({ open: false, rate: null })} onSaved={() => list.reload({ silent: true })} />
      <ConfirmDialog
        open={Boolean(publishing)}
        onClose={() => setPublishing(null)}
        tone="primary"
        title={`Publish ${publishing?.name}?`}
        confirmLabel="Publish"
        message={`Published schedules can’t be edited. It becomes active on ${publishing ? fmtDate(`${publishing.effectiveDate}T00:00:00`) : ''}.`}
        onConfirm={async () => {
          await api(`/rates/${publishing.id}/publish`, { method: 'POST', body: { billingNotice: notice } });
          toast.success('Rate schedule published', notice ? 'Billing notice posted to homeowners' : undefined);
          list.reload({ silent: true });
        }}
      >
        <Switch checked={notice} onChange={setNotice} label="Post a billing notice" description="Publishes an announcement with the new rates for all homeowners." />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete draft?"
        confirmLabel="Delete"
        message={`${deleting?.name} will be permanently deleted.`}
        onConfirm={async () => {
          await api(`/rates/${deleting.id}`, { method: 'DELETE' });
          toast.success('Draft deleted');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}
