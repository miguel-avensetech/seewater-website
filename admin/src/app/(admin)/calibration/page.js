'use client';

import { useState } from 'react';
import { AlertCircle, Gauge, Radio, SlidersHorizontal } from 'lucide-react';
import { useListQuery } from '@/hooks/useListQuery';
import { PageHeader, StatCard, Tabs } from '@/components/ui/Layout';
import { Card } from '@/components/ui/Card';
import { Pagination, SearchInput } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { CalibrationDetails, CalibrationTile, CalibrationTitle } from '@/components/domain/CalibrationCard';

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'ok', label: 'All good' },
];

// Sensor Calibration (manuscript Fig. 7.1): a compact card per household;
// selecting one opens its piezo and main-line flow sensor settings.
export default function SensorCalibrationPage() {
  const list = useListQuery('/calibration/households', { initial: { order: 'asc' }, pageSize: 24, refreshMs: 60000 });
  const { data, params } = list;
  const s = data?.summary;
  const [selectedId, setSelectedId] = useState(null);
  // Read the open household from the latest list so the details stay live.
  const selected = data?.items.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <PageHeader
        title="Sensor Calibration"
        description={`Select a household to calibrate its piezo and main-line flow sensors and set the levels that raise alerts. Sensors are due for recalibration every ${s?.intervalDays ?? 180} days.`}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Households" value={s?.total ?? '—'} icon={Gauge} />
        <StatCard label="Need attention" value={s?.attention ?? '—'} icon={AlertCircle} accent={s?.attention ? 'warn' : 'ok'} />
        <StatCard label="No leak level set" value={s?.noLeakLevel ?? '—'} icon={Radio} accent={s?.noLeakLevel ? 'crit' : 'ok'} />
        <StatCard label="Need calibration" value={s?.needsCalibration ?? '—'} icon={SlidersHorizontal} accent={s?.needsCalibration ? 'warn' : 'ok'} />
      </div>

      <div className="mt-6 mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs tabs={STATUS_TABS} value={params.status ?? ''} onChange={(v) => list.setFilter('status', v)} />
        <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search homeowner, address or device…" className="md:w-80" />
      </div>

      {list.error && !data ? (
        <Card><ErrorState error={list.error} onRetry={list.reload} /></Card>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : !data.items.length ? (
        <Card>
          <EmptyState
            icon={Gauge}
            title={list.search || params.status ? 'No matching households' : 'No devices yet'}
            message={list.search || params.status ? 'Try another search or filter.' : 'Cards appear here once a device is registered to a household.'}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {data.items.map((row) => (
              <CalibrationTile key={row.id} row={row} selected={row.id === selectedId} onSelect={() => setSelectedId(row.id)} />
            ))}
          </div>
          {data.totalPages > 1 && <Card className="mt-4"><Pagination {...data} onPage={list.setPage} /></Card>}
        </>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        size="xl"
        title={selected ? <CalibrationTitle row={selected} /> : 'Household'}
        description={selected ? [selected.houseName, selected.address].filter(Boolean).join(' · ') : undefined}
      >
        {selected && <CalibrationDetails key={selected.id} row={selected} hours={s.statsHours} onSaved={() => list.reload({ silent: true })} />}
      </Modal>
    </>
  );
}
