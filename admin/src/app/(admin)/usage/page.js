'use client';

import { useMemo, useState } from 'react';
import { BarChart3, CalendarRange, Download, Droplets, Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { StatusBadge, SourcesNote } from '@/components/ui/Badge';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/States';
import { DataTable } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { TimeSeriesChart, CHART } from '@/components/charts/Charts';
import { fmtBucket, fmtDate, fmtFlow, fmtLiters, fmtNumber, fmtPct, toDateInput } from '@/lib/format';
import { FLOW_STATUS } from '@/lib/labels';
import { downloadCsv } from '@/lib/csv';
import { compareBy } from '@/lib/sort';

const PERIODS = [
  { value: 'daily', label: 'Daily', unit: 'day', days: 14 },
  { value: 'weekly', label: 'Weekly', unit: 'week', days: 84 },
  { value: 'monthly', label: 'Monthly', unit: 'month', days: 365 },
];

const PRESETS = {
  daily: [7, 14, 30, 90],
  weekly: [28, 84, 182],
  monthly: [182, 365, 730],
};

function presetLabel(days) {
  if (days < 28) return `Last ${days} days`;
  if (days < 360) return `Last ${Math.round(days / 30.4)} months`;
  return `Last ${Math.round(days / 365)} year${days >= 700 ? 's' : ''}`;
}

export default function UsagePage() {
  const { admin } = useAuth();
  const [period, setPeriod] = useState(admin.preferences?.defaultUsagePeriod ?? 'daily');
  const meta = PERIODS.find((p) => p.value === period);
  const [range, setRange] = useState(() => ({ from: toDateInput(Date.now() - (meta.days - 1) * 86400000), to: toDateInput(Date.now()) }));
  const [houseId, setHouseId] = useState('');
  const [metric, setMetric] = useState('liters');
  const [sort, setSort] = useState({ key: 'liters', order: 'desc' });

  const rangeInvalid = range.from > range.to;
  const houses = useApi('/houses');
  const { data, error, loading, reload } = useApi(rangeInvalid ? null : '/usage', { query: { period, from: range.from, to: range.to, houseId } });

  function changePeriod(p) {
    const d = PERIODS.find((x) => x.value === p).days;
    setPeriod(p);
    setRange({ from: toDateInput(Date.now() - (d - 1) * 86400000), to: toDateInput(Date.now()) });
  }

  const rows = useMemo(() => (data ? [...data.houses].sort(compareBy(sort.key, sort.order)) : []), [data, sort]);

  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const totals = data?.totals;
  const share = (l) => (totals?.liters ? (l / totals.liters) * 100 : 0);

  return (
    <>
      <PageHeader
        title="Water Usage"
        description="Consumption analytics across monitored households. All volumes in liters (L), flow in liters per minute (L/min)."
        actions={
          <Button
            variant="secondary"
            icon={Download}
            disabled={!rows.length}
            onClick={() =>
              downloadCsv(`seewater-usage-${period}-${range.from}-to-${range.to}.csv`, [
                { header: 'Household', value: (r) => r.houseName },
                { header: 'Owner', value: (r) => r.ownerName },
                { header: 'Total (L)', value: (r) => r.liters.toFixed(1) },
                { header: 'Daily average (L)', value: (r) => r.dailyAverage.toFixed(1) },
                { header: 'Average flow (L/min)', value: (r) => r.avgFlowRate.toFixed(2) },
                { header: 'Peak flow (L/min)', value: (r) => r.peakFlowRate.toFixed(1) },
                { header: 'Status', value: (r) => r.status },
              ], rows)
            }
          >
            Export CSV
          </Button>
        }
      />

      <Card className="mb-6">
        <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
          <Tabs tabs={PERIODS} value={period} onChange={changePeriod} />
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <FilterSelect
              label="Date range preset"
              value=""
              onChange={(v) => v && setRange({ from: toDateInput(Date.now() - (Number(v) - 1) * 86400000), to: toDateInput(Date.now()) })}
              placeholder="Quick range…"
              options={PRESETS[period].map((d) => ({ value: d, label: presetLabel(d) }))}
            />
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <CalendarRange className="h-4 w-4" aria-hidden />
              <span className="sr-only">From</span>
              <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 rounded-lg border border-line-strong px-2 text-[13px] text-ink" />
              <span>to</span>
              <input type="date" value={range.to} min={range.from} max={toDateInput(Date.now())} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 rounded-lg border border-line-strong px-2 text-[13px] text-ink" aria-label="To" />
            </label>
            <FilterSelect label="Household" value={houseId} onChange={setHouseId} placeholder="All households" options={(houses.data?.items ?? []).map((h) => ({ value: h.id, label: `${h.houseName} (${h.ownerName ?? 'no owner'})` }))} className="min-w-48" />
          </div>
        </div>
        {rangeInvalid && <p className="px-4 pb-3 text-xs font-medium text-crit-700">Start date must be before the end date.</p>}
      </Card>

      {!data ? (
        <PageLoader />
      ) : (
        <div className={loading ? 'opacity-70 transition-opacity' : undefined}>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              label="Total consumption"
              value={fmtLiters(totals.liters)}
              icon={Droplets}
              hint={`${fmtDate(data.from)} – ${fmtDate(data.to)}`}
              footer={
                totals.changePct == null ? (
                  <span className="text-muted">No data for the previous period</span>
                ) : (
                  <span className={totals.changePct > 0 ? 'font-semibold text-warn-700' : 'font-semibold text-ok-700'}>
                    {totals.changePct > 0 ? <TrendingUp className="mr-1 inline h-3.5 w-3.5" /> : <TrendingDown className="mr-1 inline h-3.5 w-3.5" />}
                    {fmtPct(totals.changePct)} vs previous period ({fmtLiters(totals.previousLiters)})
                  </span>
                )
              }
            />
            <StatCard label={`Average per ${meta.unit}`} value={fmtLiters(totals.averagePerBucket)} icon={BarChart3} accent="aqua" hint={`Across ${data.series.length} ${meta.unit}s`} />
            <StatCard label="Average flow rate" value={totals.avgFlowRate == null ? 'No data yet' : fmtFlow(totals.avgFlowRate)} icon={Gauge} accent="navy" hint="Mean of all flow readings" />
            <StatCard label="Peak flow rate" value={totals.peakFlowRate == null ? 'No data yet' : fmtFlow(totals.peakFlowRate)} icon={Gauge} accent={totals.peakFlowRate >= 25 ? 'crit' : totals.peakFlowRate >= 15 ? 'warn' : 'ok'} hint="Highest single reading" />
          </div>

          <Card className="mt-6">
            <CardHeader
              title={`${meta.label} consumption trend`}
              description={houseId ? rows[0]?.houseName : 'All monitored households'}
              actions={
                <>
                  <SourcesNote sources={data.sources} />
                  <Tabs tabs={[{ value: 'liters', label: 'Volume (L)' }, { value: 'avgFlowRate', label: 'Avg flow' }, { value: 'peakFlowRate', label: 'Peak flow' }]} value={metric} onChange={setMetric} />
                </>
              }
            />
            <CardBody>
              {totals.liters > 0 ? (
                <TimeSeriesChart
                  kind={period === 'daily' && metric === 'liters' ? 'area' : metric === 'liters' ? 'bar' : 'line'}
                  data={data.series}
                  xKey="key"
                  xFormatter={(k) => fmtBucket(k, period)}
                  height={300}
                  yUnit={metric === 'liters' ? 'L' : ''}
                  series={[
                    metric === 'liters'
                      ? { key: 'liters', label: 'Consumption', unit: 'L', color: CHART.ocean }
                      : { key: metric, label: metric === 'avgFlowRate' ? 'Average flow' : 'Peak flow', unit: 'L/min', digits: 1, color: metric === 'avgFlowRate' ? CHART.aqua : CHART.navy },
                  ]}
                />
              ) : (
                <EmptyState icon={Droplets} title="No usage recorded in this range" message="Choose a different date range or household." />
              )}
            </CardBody>
          </Card>

          <Card className="mt-6">
            <CardHeader title="Usage by household" description={`Status compares the daily average with the ${fmtLiters(data.dailyUsageWarningLiters)} warning level set in Settings.`} />
            <DataTable
              rows={rows}
              rowKey="houseId"
              loading={loading}
              sort={sort.key}
              order={sort.order}
              onSort={(key) => setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' }))}
              columns={[
                { key: 'houseName', header: 'Household', sortable: true, render: (r) => <div><p className="font-semibold text-ink">{r.houseName ?? 'Removed household'}</p><p className="text-xs text-muted">{r.ownerName}</p></div> },
                { key: 'liters', header: 'Total', sortable: true, className: 'tabular font-semibold text-ink', render: (r) => fmtLiters(r.liters) },
                { key: 'share', header: 'Share', render: (r) => (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 rounded-full bg-slate-100"><div className="h-full rounded-full bg-ocean-500" style={{ width: `${share(r.liters)}%` }} /></div>
                    <span className="tabular text-xs">{fmtNumber(share(r.liters), 1)}%</span>
                  </div>
                ) },
                { key: 'dailyAverage', header: 'Daily avg', sortable: true, className: 'tabular', render: (r) => fmtLiters(r.dailyAverage) },
                { key: 'avgFlowRate', header: 'Avg flow', sortable: true, className: 'tabular', render: (r) => fmtFlow(r.avgFlowRate) },
                { key: 'peakFlowRate', header: 'Peak flow', sortable: true, className: 'tabular', render: (r) => fmtFlow(r.peakFlowRate) },
                { key: 'status', header: 'Status', render: (r) => <StatusBadge map={FLOW_STATUS} value={r.status} /> },
              ]}
              empty={<EmptyState title="No household usage in this range" />}
            />
          </Card>
        </div>
      )}
    </>
  );
}
