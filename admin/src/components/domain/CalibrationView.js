'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Clock, Gauge, History, SlidersHorizontal, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useListQuery } from '@/hooks/useListQuery';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DescriptionList, PageHeader, StatCard } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect, Input, Textarea } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, InlineNotice, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDate, fmtDateTime, fmtRelative } from '@/lib/format';
import { CALIBRATION, SENSOR_TYPE, options } from '@/lib/labels';

// Piezo and flow calibration (manuscript Fig. 7.1): sensitivity and calibration
// factor per sensor. Operating thresholds live on the Threshold Profiles page.

const PARAM_LABELS = {
  sensitivity: 'Sensitivity',
  calibrationFactor: 'Calibration factor',
  minValue: 'Minimum',
  maxValue: 'Maximum',
  warningLevel: 'Warning level',
  criticalLevel: 'Critical level',
  vibration_baseline: 'Vibration baseline',
  verification: 'Verification (no change)',
};

function CalibrationPanel({ sensorId, onSaved }) {
  const toast = useToast();
  const { canEdit } = useAuth();
  const { data, error, loading, reload } = useApi(`/calibration/sensors/${sensorId}`);
  const unit = data?.sensor.sensorType === 'flow' ? 'L/min' : 'units';

  const num = (v, o) => rules.number(v, o);
  const form = useForm(
    { sensitivity: '', calibrationFactor: '', remarks: '' },
    {
      validate: (v) => ({
        sensitivity: num(v.sensitivity, { min: 0.1, max: 10 }),
        calibrationFactor: num(v.calibrationFactor, { min: 0.001, max: 1000 }),
      }),
      onSubmit: async (v) => {
        const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'remarks' ? x : Number(x)]));
        const res = await api(`/calibration/sensors/${sensorId}`, { method: 'POST', body });
        toast.success('Calibration saved', `${res.changes} parameter${res.changes === 1 ? '' : 's'} updated`);
        reload({ silent: true });
        onSaved();
      },
    },
  );

  useEffect(() => {
    if (!data) return;
    form.reset({ sensitivity: data.sensor.sensitivity ?? 1, calibrationFactor: data.sensor.calibrationFactor ?? 1, remarks: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sensor.id, data?.sensor.lastCalibratedAt]);

  if (error) return <ErrorState error={error} onRetry={reload} compact />;
  if (loading && !data) return <div className="space-y-3 p-5"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-40" /><Skeleton className="h-60" /></div>;

  const { sensor, threshold, history } = data;
  return (
    <>
      <CardHeader
        icon={Gauge}
        title={`${SENSOR_TYPE[sensor.sensorType].label} · ${sensor.sensorLocation}`}
        description={`${sensor.deviceName} · ${sensor.houseName ?? 'Unassigned'}`}
        actions={<StatusBadge map={CALIBRATION} value={sensor.calibrationStatus} />}
      />
      <CardBody className="space-y-5">
        <DescriptionList
          items={[
            { label: 'Model', value: sensor.model || '—' },
            { label: 'Installed', value: fmtDate(sensor.installedAt) },
            { label: 'Last calibrated', value: sensor.lastCalibratedAt ? `${fmtDate(sensor.lastCalibratedAt)} (${fmtRelative(sensor.lastCalibratedAt)})` : 'Never' },
            {
              label: 'Threshold profile',
              value: (
                <Link href="/thresholds" className="font-semibold text-ocean-700 hover:underline">
                  {threshold ? `${threshold.warningLevel} / ${threshold.criticalLevel} ${unit}${threshold.isDefault ? ' (system default)' : ''}` : 'Not configured'}
                </Link>
              ),
            },
          ]}
        />

        {sensor.sensorType === 'vibration' && (
          <InlineNotice tone="info" title="Leak detection uses the vibration baseline">
            Configure the environmental baseline on the Vibration Baseline page. Values here set the piezo sensor’s sensitivity and signal scale.
          </InlineNotice>
        )}

        {canEdit ? (
          <form onSubmit={form.handleSubmit} noValidate className="space-y-4 rounded-lg border border-line p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink"><SlidersHorizontal className="h-4 w-4 text-ocean-600" /> Calibration parameters</p>
            {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Sensitivity" type="number" step="0.05" hint="Multiplier applied to raw signal (0.1–10)" {...form.bind('sensitivity')} />
              <Input label="Calibration factor" type="number" step="0.01" hint={sensor.sensorType === 'flow' ? 'Pulses per L/min (YF-S201 ≈ 7.5)' : 'Signal scale factor'} {...form.bind('calibrationFactor')} />
            </div>
            <Textarea label="Remarks" rows={2} placeholder="e.g. Bucket test against 10 L reference" {...form.bind('remarks')} />
            <div className="flex justify-end">
              <Button type="submit" loading={form.submitting} icon={CheckCircle2}>Save calibration</Button>
            </div>
          </form>
        ) : (
          <InlineNotice tone="info">Your account is read-only. Ask an administrator to change calibration.</InlineNotice>
        )}

        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><History className="h-4 w-4 text-ocean-600" /> Calibration history</p>
          {history.length ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-muted">
                  <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Parameter</th><th className="px-3 py-2">Change</th><th className="px-3 py-2">By</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="tabular whitespace-nowrap px-3 py-2">{fmtDateTime(h.calibrationDate)}</td>
                      <td className="px-3 py-2 text-ink">{PARAM_LABELS[h.calibrationType] ?? h.calibrationType}{h.remarks && <p className="text-xs text-muted">{h.remarks}</p>}</td>
                      <td className="tabular px-3 py-2">{h.oldValue ?? '—'} → <span className="font-semibold text-ink">{h.newValue ?? '—'}</span></td>
                      <td className="px-3 py-2">{h.performedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={History} title="No calibration records" className="py-6" />
          )}
        </div>
      </CardBody>
    </>
  );
}

const VIEWS = {
  vibration: { title: 'Piezo Calibration', path: '/calibration/piezo', description: 'Sensitivity and signal scale of the piezo vibration sensors used for leak detection.' },
  flow: { title: 'Flow Calibration', path: '/calibration/flow', description: 'Sensitivity and pulses-per-liter calibration of the water flow sensors.' },
};

export function CalibrationView({ sensorType }) {
  const view = VIEWS[sensorType];
  const sp = useSearchParams();
  const router = useRouter();
  const list = useListQuery('/calibration/sensors', { initial: { order: 'asc', type: sensorType } });
  const { data, params } = list;
  const selected = sp.get('sensor');
  const select = (id) => router.replace(`${view.path}?sensor=${id}`, { scroll: false });
  const s = data?.summary;

  useEffect(() => {
    if (!selected && data?.items?.length && window.matchMedia('(min-width: 1280px)').matches) select(data.items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selected]);

  return (
    <>
      <PageHeader title={view.title} description={`${view.description} Sensors are due for recalibration every ${s?.intervalDays ?? 180} days.`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Sensors" value={s?.total ?? '—'} icon={Gauge} />
        <StatCard label="Calibrated" value={s?.calibrated ?? '—'} icon={CheckCircle2} accent="ok" />
        <StatCard label="Recalibration due" value={s?.due ?? '—'} icon={Clock} accent={s?.due ? 'warn' : 'ok'} />
        <StatCard label="Not calibrated" value={s?.notCalibrated ?? '—'} icon={AlertCircle} accent={s?.notCalibrated ? 'crit' : 'ok'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card className="self-start">
          <TableToolbar>
            <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search device, location, household…" className="md:basis-full" />
            <FilterSelect label="Calibration" value={params.calibration} onChange={(v) => list.setFilter('calibration', v)} placeholder="Any status" options={options(CALIBRATION)} />
            <ClearFilters params={params} keys={['calibration']} onClear={list.clearFilters} />
          </TableToolbar>
          <DataTable
            minWidth={560}
            rows={data?.items?.map((r) => ({ ...r, _selected: r.id === selected }))}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            sort={params.sort ?? 'deviceName'}
            order={params.order}
            onSort={list.toggleSort}
            onRowClick={(r) => select(r.id)}
            empty={<EmptyState icon={Gauge} title="No sensors" message="Sensors appear here once devices are registered." />}
            columns={[
              { key: 'deviceName', header: 'Sensor', sortable: true, render: (r) => <div className={r._selected ? 'border-l-2 border-ocean-600 pl-2' : ''}><p className="font-semibold text-ink">{r.sensorLocation}</p><p className="text-xs text-muted"><span className="font-mono">{r.deviceName}</span> · {SENSOR_TYPE[r.sensorType].label}</p></div> },
              { key: 'houseName', header: 'Household', sortable: true, className: 'text-[13px]', render: (r) => r.houseName ?? '—' },
              { key: 'lastCalibratedAt', header: 'Last calibrated', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (r) => (r.lastCalibratedAt ? fmtDate(r.lastCalibratedAt) : 'Never') },
              { key: 'calibrationStatus', header: 'Status', render: (r) => <StatusBadge map={CALIBRATION} value={r.calibrationStatus} />, className: 'whitespace-nowrap' },
            ]}
          />
          {data && <Pagination {...data} onPage={list.setPage} />}
        </Card>

        <Card className="self-start xl:sticky xl:top-24">
          {selected ? <CalibrationPanel key={selected} sensorId={selected} onSaved={() => list.reload({ silent: true })} /> : <EmptyState icon={SlidersHorizontal} title="Select a sensor" message="Choose a sensor from the list to view and adjust its calibration." />}
        </Card>
      </div>
    </>
  );
}
