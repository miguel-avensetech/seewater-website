'use client';

import { useEffect, useState } from 'react';
import { CircleSlash, Pencil, RotateCcw, Settings2, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import { useListQuery } from '@/hooks/useListQuery';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Input, Textarea } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { EmptyState, InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDate } from '@/lib/format';
import { SENSOR_TYPE, THRESHOLD_PROFILE, options } from '@/lib/labels';

// Threshold profiles (manuscript THRESHOLD_PROFILE): operating range and the
// warning / critical levels that raise high-flow alerts for each sensor.
const unitOf = (type) => (type === 'flow' ? 'L/min' : 'units');

function ThresholdModal({ row, onClose, onSaved }) {
  const toast = useToast();
  const unit = unitOf(row?.sensorType);
  const num = (v, o) => rules.number(v, o);
  const form = useForm(
    { minValue: '', maxValue: '', warningLevel: '', criticalLevel: '', remarks: '' },
    {
      validate: (v) => {
        const e = {
          minValue: num(v.minValue, { min: 0 }),
          maxValue: num(v.maxValue, { min: 0.001 }),
          warningLevel: num(v.warningLevel, { min: 0.001 }),
          criticalLevel: num(v.criticalLevel, { min: 0.001 }),
        };
        if (!e.minValue && !e.warningLevel && Number(v.minValue) >= Number(v.warningLevel)) e.warningLevel = 'Must be above the minimum';
        if (!e.warningLevel && !e.criticalLevel && Number(v.warningLevel) >= Number(v.criticalLevel)) e.criticalLevel = 'Must be above the warning level';
        if (!e.criticalLevel && !e.maxValue && Number(v.criticalLevel) > Number(v.maxValue)) e.maxValue = 'Must be at least the critical level';
        return e;
      },
      onSubmit: async (v) => {
        const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'remarks' ? x : Number(x)]));
        const res = await api(`/calibration/thresholds/${row.id}`, { method: 'PUT', body });
        toast.success('Threshold profile saved', `${res.changes} value${res.changes === 1 ? '' : 's'} updated`);
        onSaved();
        onClose();
      },
    },
  );

  useEffect(() => {
    if (row) form.reset({ minValue: row.minValue ?? 0, maxValue: row.maxValue ?? '', warningLevel: row.warningLevel ?? '', criticalLevel: row.criticalLevel ?? '', remarks: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  return (
    <Modal
      open={Boolean(row)}
      onClose={onClose}
      busy={form.submitting}
      title="Edit threshold profile"
      description={row ? `${SENSOR_TYPE[row.sensorType].label} · ${row.sensorLocation} · ${row.deviceName}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="threshold-form" loading={form.submitting}>Save profile</Button>
        </>
      }
    >
      <form id="threshold-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        {row?.sensorType === 'vibration' && (
          <InlineNotice tone="info">Leak alerts use the Vibration Baseline. These raw levels only describe the piezo sensor’s operating range.</InlineNotice>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Minimum value" type="number" step="0.1" suffix={unit} {...form.bind('minValue')} />
          <Input label="Maximum value" type="number" step="0.1" suffix={unit} {...form.bind('maxValue')} />
          <Input label="Warning level" type="number" step="0.1" suffix={unit} hint={row?.sensorType === 'flow' ? 'Raises a high-flow warning' : undefined} {...form.bind('warningLevel')} />
          <Input label="Critical level" type="number" step="0.1" suffix={unit} hint={row?.sensorType === 'flow' ? 'Raises a critical high-flow alert' : undefined} {...form.bind('criticalLevel')} />
        </div>
        <Textarea label="Remarks" rows={2} placeholder="e.g. Larger household, higher normal peak" {...form.bind('remarks')} />
      </form>
    </Modal>
  );
}

export default function ThresholdProfilesPage() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const list = useListQuery('/calibration/thresholds', { initial: { order: 'asc' } });
  const { data, params } = list;
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const s = data?.summary;

  const range = (r) => (r.profile === 'none' ? '—' : `${r.minValue} – ${r.maxValue} ${unitOf(r.sensorType)}`);

  return (
    <>
      <PageHeader
        title="Threshold Profiles"
        description={`Warning and critical levels per sensor. Flow sensors without a custom profile use the system defaults (${s?.defaults.warningLevel ?? '—'} / ${s?.defaults.criticalLevel ?? '—'} L/min, set in System Preferences).`}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sensors" value={s?.total ?? '—'} icon={SlidersHorizontal} />
        <StatCard label="Custom profiles" value={s?.custom ?? '—'} icon={Settings2} accent="ocean" />
        <StatCard label="System default" value={s?.default ?? '—'} icon={RotateCcw} accent="navy" />
        <StatCard label="Not configured" value={s?.none ?? '—'} icon={CircleSlash} accent={s?.none ? 'warn' : 'ok'} />
      </div>

      <Card className="mt-6">
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search device, location, household…" className="md:w-80" />
          <FilterSelect label="Sensor type" value={params.type} onChange={(v) => list.setFilter('type', v)} placeholder="All types" options={options(SENSOR_TYPE)} />
          <FilterSelect label="Profile" value={params.profile} onChange={(v) => list.setFilter('profile', v)} placeholder="Any profile" options={options(THRESHOLD_PROFILE)} />
          <ClearFilters params={params} keys={['type', 'profile']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={900}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'deviceName'}
          order={params.order}
          onSort={list.toggleSort}
          empty={<EmptyState icon={SlidersHorizontal} title="No sensors" message="Sensors appear here once devices are registered." />}
          columns={[
            { key: 'deviceName', header: 'Sensor', sortable: true, render: (r) => <div><p className="font-semibold text-ink">{r.sensorLocation}</p><p className="text-xs text-muted"><span className="font-mono">{r.deviceName}</span> · {SENSOR_TYPE[r.sensorType].label}</p></div> },
            { key: 'houseName', header: 'Household', sortable: true, className: 'text-[13px]', render: (r) => r.houseName ?? '—' },
            { key: 'range', header: 'Operating range', className: 'tabular whitespace-nowrap text-[13px]', render: range },
            { key: 'warningLevel', header: 'Warning', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (r) => (r.warningLevel == null ? '—' : `${r.warningLevel} ${unitOf(r.sensorType)}`) },
            { key: 'criticalLevel', header: 'Critical', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (r) => (r.criticalLevel == null ? '—' : `${r.criticalLevel} ${unitOf(r.sensorType)}`) },
            { key: 'profile', header: 'Profile', render: (r) => <div className="space-y-0.5"><StatusBadge map={THRESHOLD_PROFILE} value={r.profile} />{r.updatedAt && <p className="text-xs text-muted">Updated {fmtDate(r.updatedAt)}</p>}</div> },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(r)}>{r.profile === 'custom' ? 'Edit' : 'Customize'}</Button>
                  {r.profile === 'custom' && <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setResetting(r)}>Reset</Button>}
                </div>
              ),
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <ThresholdModal row={editing} onClose={() => setEditing(null)} onSaved={() => list.reload({ silent: true })} />
      <ConfirmDialog
        open={Boolean(resetting)}
        onClose={() => setResetting(null)}
        title="Remove this custom profile?"
        confirmLabel="Reset profile"
        message={resetting?.sensorType === 'flow' ? `${resetting?.sensorLocation} will use the system default flow thresholds again.` : `${resetting?.sensorLocation} will have no raw thresholds. Leak detection keeps using its vibration baseline.`}
        onConfirm={async () => {
          await api(`/calibration/thresholds/${resetting.id}`, { method: 'DELETE' });
          toast.success('Threshold profile reset');
          list.reload({ silent: true });
        }}
      />
    </>
  );
}
