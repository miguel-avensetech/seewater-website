'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, CheckCircle2, FlaskConical, History, Radar, Save, Waves } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { Badge, StatusBadge, SourcesNote } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/DataTable';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { withSuspense } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, InlineNotice, PageLoader, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { TimeSeriesChart, CHART } from '@/components/charts/Charts';
import { fmtDateTime, fmtRelative, fmtTime } from '@/lib/format';
import { ENVIRONMENT, lookup, options } from '@/lib/labels';
import clsx from 'clsx';

const WINDOWS = [
  { value: 30, label: 'Last 30 minutes' },
  { value: 60, label: 'Last 1 hour' },
  { value: 180, label: 'Last 3 hours' },
  { value: 720, label: 'Last 12 hours' },
  { value: 1440, label: 'Last 24 hours' },
];

function BaselinePanel({ sensorId, onSaved }) {
  const toast = useToast();
  const { canEdit } = useAuth();
  const { data, error, loading, reload } = useApi(`/vibration/sensors/${sensorId}`);
  const [windowMin, setWindowMin] = useState(60);
  const [measuring, setMeasuring] = useState(false);
  const [measurement, setMeasurement] = useState(null);
  const [measureError, setMeasureError] = useState(null);
  const [pending, setPending] = useState(null);

  const form = useForm(
    { baselineValue: '', acceptableRange: '', detectionThreshold: '', environment: 'quiet', remarks: '' },
    {
      validate: (v) => ({
        baselineValue: rules.number(v.baselineValue, { min: 0, max: 1023 }),
        acceptableRange: rules.number(v.acceptableRange, { min: 0.1, max: 1023 }),
        detectionThreshold: v.detectionThreshold !== '' && Number(v.detectionThreshold) <= Number(v.baselineValue) ? 'Must be above the baseline value' : v.detectionThreshold !== '' ? rules.number(v.detectionThreshold, { min: 0.1, max: 1023 }) : null,
      }),
      onSubmit: async (v) => setPending(v),
    },
  );

  useEffect(() => {
    const b = data?.baseline;
    form.reset({ baselineValue: b?.baselineValue ?? '', acceptableRange: b?.acceptableRange ?? '', detectionThreshold: b?.detectionThreshold ?? '', environment: b?.environment ?? 'quiet', remarks: '' });
    setMeasurement(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sensor.id, data?.baseline?.updatedAt]);

  async function measure() {
    setMeasuring(true);
    setMeasureError(null);
    try {
      const m = await api(`/vibration/sensors/${sensorId}/measure`, { method: 'POST', body: { minutes: windowMin } });
      setMeasurement(m);
      form.set('baselineValue', m.proposed.baselineValue);
      form.set('acceptableRange', m.proposed.acceptableRange);
    } catch (err) {
      setMeasureError(err.message);
    } finally {
      setMeasuring(false);
    }
  }

  async function save() {
    const v = pending;
    await api(`/vibration/sensors/${sensorId}/baseline`, {
      method: 'PUT',
      body: {
        baselineValue: Number(v.baselineValue),
        acceptableRange: Number(v.acceptableRange),
        detectionThreshold: v.detectionThreshold === '' ? null : Number(v.detectionThreshold),
        environment: v.environment,
        remarks: v.remarks,
        measurement: measurement && { samples: measurement.samples, windowMinutes: measurement.windowMinutes, mean: measurement.stats.mean, stdDev: measurement.stats.stdDev, max: measurement.stats.max },
      },
    });
    toast.success('Vibration baseline saved');
    reload({ silent: true });
    onSaved();
  }

  const v = form.values;
  const limit = v.detectionThreshold !== '' ? Number(v.detectionThreshold) : Number(v.baselineValue) + Number(v.acceptableRange);

  if (error) return <ErrorState error={error} onRetry={reload} compact />;
  if (loading && !data) return <div className="space-y-3 p-5"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-48" /><Skeleton className="h-60" /></div>;

  const { sensor, baseline, history, readings, sources } = data;
  return (
    <>
      <CardHeader icon={Waves} title={`${sensor.sensorLocation} · ${sensor.deviceName}`} description={`${sensor.houseName ?? 'Unassigned'}${sensor.address ? ` · ${sensor.address}` : ''}`} actions={baseline ? <Badge tone="ok" dot>Baseline set</Badge> : <Badge tone="crit" dot>No baseline</Badge>} />
      <CardBody className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-ink">Vibration readings — last 24 hours</p>
            <SourcesNote sources={sources} />
          </div>
          {readings.length ? (
            <TimeSeriesChart
              kind="line"
              data={readings}
              xKey="recordedAt"
              xFormatter={fmtTime}
              height={200}
              series={[{ key: 'vibrationLevel', label: 'Vibration', unit: '', color: CHART.aqua }]}
              referenceLines={[
                baseline && { y: baseline.baselineValue, label: 'Baseline', color: CHART.ocean },
                Number.isFinite(limit) && limit > 0 && { y: limit, label: 'Leak threshold', color: CHART.crit },
              ].filter(Boolean)}
            />
          ) : (
            <EmptyState icon={Activity} title="No readings in the last 24 hours" message="The baseline can only be measured from stored readings." className="py-6" />
          )}
        </div>

        {canEdit ? (
          <>
            <div className="rounded-lg border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Radar className="h-4 w-4 text-ocean-600" /> Record background vibration</p>
              <p className="mt-1 text-[13px] text-muted">Computes statistics from stored readings taken while no water was flowing, so traffic, machinery and other environmental vibration define the baseline.</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Select label="Measurement window" options={WINDOWS} value={windowMin} onChange={(e) => setWindowMin(Number(e.target.value))} className="w-48" />
                <Button variant="secondary" icon={Radar} loading={measuring} onClick={measure}>Measure</Button>
              </div>
              {measureError && <InlineNotice tone="warn" className="mt-3">{measureError}</InlineNotice>}
              {measurement && (
                <div className="mt-3 rounded-lg bg-canvas p-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{measurement.samples} no-flow samples</p>
                    {measurement.excludedWhileFlowing > 0 && <span className="text-muted">({measurement.excludedWhileFlowing} excluded while water was flowing)</span>}
                    {measurement.sources.includes('simulated') && <Badge tone="warn"><FlaskConical className="h-3 w-3" />Simulated readings</Badge>}
                  </div>
                  <dl className="tabular mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {[['Mean', measurement.stats.mean], ['Std dev', measurement.stats.stdDev], ['Min', measurement.stats.min], ['Max', measurement.stats.max], ['95th pct', measurement.stats.p95]].map(([k, val]) => (
                      <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold text-ink">{val}</dd></div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-ocean-700">Proposed values have been filled in below. Review them, then save.</p>
                </div>
              )}
            </div>

            <form onSubmit={form.handleSubmit} noValidate className="space-y-4 rounded-lg border border-line p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Waves className="h-4 w-4 text-ocean-600" /> Baseline settings</p>
              {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Baseline value" type="number" step="0.1" required hint="Normal environmental vibration level" {...form.bind('baselineValue')} />
                <Input label="Acceptable range (±)" type="number" step="0.1" required hint="Allowed deviation above the baseline" {...form.bind('acceptableRange')} />
                <Input label="Detection threshold" type="number" step="0.1" placeholder={Number.isFinite(limit) ? `Auto: ${limit}` : 'Auto'} hint="Optional — overrides baseline + range" {...form.bind('detectionThreshold')} />
                <Select label="Installation environment" options={options(ENVIRONMENT)} hint="Homes near busy roads need higher thresholds" {...form.bind('environment')} />
              </div>
              <Textarea label="Remarks" rows={2} placeholder="Reason for the change" {...form.bind('remarks')} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-muted">Leak alerts trigger above <strong className="tabular text-ink">{Number.isFinite(limit) && limit > 0 ? limit : '—'}</strong>, only while water is flowing.</p>
                <Button type="submit" icon={Save}>Save baseline</Button>
              </div>
            </form>
          </>
        ) : (
          <InlineNotice tone="info">Your account is read-only. Only administrators can update vibration baselines.</InlineNotice>
        )}

        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><History className="h-4 w-4 text-ocean-600" /> Baseline history</p>
          {history.length ? (
            <ol className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="rounded-lg border border-line p-3 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="tabular font-semibold text-ink">
                      {h.previous ? `${h.previous.baselineValue} ± ${h.previous.acceptableRange} → ` : ''}
                      {h.baselineValue} ± {h.acceptableRange}
                      {h.detectionThreshold != null && ` (threshold ${h.detectionThreshold})`}
                    </p>
                    <StatusBadge map={ENVIRONMENT} value={h.environment} dot={false} />
                  </div>
                  {h.remarks && <p className="mt-1 text-ink-soft">{h.remarks}</p>}
                  <p className="mt-1 text-xs text-faint">
                    {fmtDateTime(h.createdAt)} · {h.recordedByName}
                    {h.measurement && ` · measured from ${h.measurement.samples} samples over ${h.measurement.windowMinutes} min`}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={History} title="No baseline recorded yet" className="py-6" />
          )}
        </div>
      </CardBody>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={() => setPending(null)}
        onConfirm={save}
        tone="primary"
        title="Update vibration baseline?"
        confirmLabel="Save baseline"
        message={pending && `Leak detection for this sensor will use a threshold of ${pending.detectionThreshold !== '' ? pending.detectionThreshold : Number(pending.baselineValue) + Number(pending.acceptableRange)} immediately. The previous values are kept in the history.`}
      />
    </>
  );
}

function VibrationPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { data, error, loading, reload } = useApi('/vibration/baselines');
  const [q, setQ] = useState('');
  const selected = sp.get('sensor');
  const select = (id) => router.replace(`/vibration?sensor=${id}`, { scroll: false });

  const items = useMemo(() => {
    const n = q.toLowerCase();
    return (data?.items ?? []).filter((i) => !n || [i.deviceName, i.sensorLocation, i.houseName, i.ownerName].some((x) => x?.toLowerCase().includes(n)));
  }, [data, q]);

  useEffect(() => {
    if (!selected && data?.items?.length && window.matchMedia('(min-width: 1280px)').matches) select(data.items[0].sensorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selected]);

  if (loading && !data) return <PageLoader />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Vibration Baseline" description="Establish the normal environmental vibration level for each piezo sensor so passing vehicles, pumps and machinery are not mistaken for leaks." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Vibration sensors" value={data.summary.total} icon={Waves} />
        <StatCard label="Baselines configured" value={data.summary.configured} icon={CheckCircle2} accent="ok" />
        <StatCard label="Missing baseline" value={data.summary.total - data.summary.configured} icon={Radar} accent={data.summary.total - data.summary.configured ? 'crit' : 'ok'} hint="Leak detection disabled for these sensors" className="col-span-2 lg:col-span-1" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="self-start">
          <div className="border-b border-line p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Search device, location, household…" />
          </div>
          {items.length ? (
            <ul className="divide-y divide-line">
              {items.map((i) => {
                const abnormal = i.limit != null && i.lastVibrationLevel != null && i.lastVibrationLevel > i.limit;
                return (
                  <li key={i.sensorId}>
                    <button onClick={() => select(i.sensorId)} className={clsx('w-full px-4 py-3 text-left transition-colors hover:bg-ocean-50/50', i.sensorId === selected && 'bg-ocean-50 shadow-[inset_3px_0_0_var(--color-ocean-600)]')}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-semibold text-ink">{i.houseName ?? 'Unassigned'}</p>
                        {i.baseline ? <StatusBadge map={ENVIRONMENT} value={i.baseline.environment} dot={false} /> : <Badge tone="crit">No baseline</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted"><span className="font-mono">{i.deviceName}</span> · {i.sensorLocation}{i.isSimulated && ' · sample'}</p>
                      <div className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted">Baseline <strong className="text-ink">{i.baseline ? `${i.baseline.baselineValue} ± ${i.baseline.acceptableRange}` : '—'}</strong></span>
                        <span className="text-muted">Threshold <strong className="text-ink">{i.limit ?? '—'}</strong></span>
                        <span className={abnormal ? 'font-semibold text-crit-700' : 'text-muted'}>Now <strong>{i.lastVibrationLevel ?? '—'}</strong>{i.lastReadingAt && ` · ${fmtRelative(i.lastReadingAt)}`}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={Waves} title={data.items.length ? 'No sensors match' : 'No vibration sensors'} message={data.items.length ? undefined : 'Register a device with a piezo vibration sensor first.'} />
          )}
        </Card>

        <Card className="self-start">
          {selected ? <BaselinePanel key={selected} sensorId={selected} onSaved={reload} /> : <EmptyState icon={Waves} title="Select a sensor" message="Choose a vibration sensor to view or update its baseline." />}
        </Card>
      </div>
    </>
  );
}

export default withSuspense(VibrationPage);
