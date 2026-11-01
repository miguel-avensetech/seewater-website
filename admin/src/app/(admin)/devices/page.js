'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Cpu, FlaskConical, Plus, Wifi, WifiOff, KeyRound } from 'lucide-react';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { useLive } from '@/components/layout/LiveProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader, StatCard } from '@/components/ui/Layout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { ActivationCodeModal, DeviceFormModal } from '@/components/domain/DeviceForms';
import { fmtDateTime, fmtRelative } from '@/lib/format';
import { ACTIVATION, CONNECTION, VALVE, options } from '@/lib/labels';

export default function DevicesPage() {
  const router = useRouter();
  const { canEdit } = useAuth();
  const { liveKey } = useLive(['devices']);
  const list = useListQuery('/devices', { refreshMs: 30000, liveKey });
  const { data, params } = list;
  const [registerOpen, setRegisterOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const s = data?.summary;

  return (
    <>
      <PageHeader
        title="Device Management"
        description="Registered ESP32 gateways, their activation codes, connection status and household assignment."
        actions={canEdit && <Button icon={Plus} onClick={() => setRegisterOpen(true)}>Register device</Button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Registered devices" value={s?.total ?? '—'} icon={Cpu} />
        <StatCard label="Online" value={s?.online ?? '—'} icon={Wifi} accent="ok" hint="Reported in the last 5 minutes" />
        <StatCard label="Offline" value={s?.offline ?? '—'} icon={WifiOff} accent={s?.offline ? 'crit' : 'ok'} />
        <StatCard label="Awaiting activation" value={s?.pending ?? '—'} icon={KeyRound} accent="warn" />
      </div>

      <Card className="mt-6">
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search device, MAC, code, household…" className="md:w-80" />
          <FilterSelect label="Connection" value={params.connection} onChange={(v) => list.setFilter('connection', v)} placeholder="Any connection" options={options(CONNECTION)} />
          <FilterSelect label="Activation" value={params.activation} onChange={(v) => list.setFilter('activation', v)} placeholder="Any activation" options={options(ACTIVATION)} />
          <ClearFilters params={params} keys={['connection', 'activation']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={1000}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'registeredAt'}
          order={params.order}
          onSort={list.toggleSort}
          onRowClick={(d) => router.push(`/devices/${d.id}`)}
          empty={<EmptyState icon={Cpu} title="No devices found" message={params.q ? 'Try a different search.' : 'Register a device to generate its activation code.'} action={canEdit && !params.q && <Button icon={Plus} onClick={() => setRegisterOpen(true)}>Register device</Button>} />}
          columns={[
            {
              key: 'deviceName',
              header: 'Device',
              sortable: true,
              render: (d) => (
                <div>
                  <p className="flex items-center gap-1.5 font-mono font-semibold text-ink">
                    {d.deviceName}
                    {d.isSimulated && <Badge tone="warn"><FlaskConical className="h-3 w-3" />Sample</Badge>}
                  </p>
                  <p className="font-mono text-xs text-muted">{d.macAddress || 'MAC not set'}</p>
                </div>
              ),
            },
            { key: 'houseName', header: 'Household', sortable: true, render: (d) => (d.houseName ? <div><p className="text-ink">{d.houseName}</p><p className="text-xs text-muted">{d.ownerName}</p></div> : <span className="text-[13px] text-warn-700">Unassigned</span>) },
            { key: 'connectionStatus', header: 'Connection', sortable: true, render: (d) => <StatusBadge map={CONNECTION} value={d.connectionStatus} pulse={d.connectionStatus === 'online'} /> },
            { key: 'lastOnline', header: 'Last seen', sortable: true, render: (d) => <div className="whitespace-nowrap text-[13px]"><p className="text-ink">{fmtRelative(d.lastOnline)}</p>{d.lastOnline && <p className="text-xs text-faint">{fmtDateTime(d.lastOnline)}</p>}</div> },
            { key: 'signal', header: 'Signal', className: 'tabular text-[13px]', render: (d) => (d.signalStrength != null ? `${d.signalStrength} dBm` : '—') },
            { key: 'activation', header: 'Activation', render: (d) => <div className="space-y-1"><StatusBadge map={ACTIVATION} value={d.activationStatus} dot={false} />{d.activationStatus === 'pending' && <p className="font-mono text-xs font-semibold text-ink">{d.activationCode}</p>}</div> },
            { key: 'components', header: 'Sensors / valve', className: 'text-[13px]', render: (d) => <span className="flex items-center gap-2">{d.sensorCount} sensors {d.valveStatus && <StatusBadge map={VALVE} value={d.valveStatus} dot={false} />}</span> },
            { key: 'firmwareVersion', header: 'Firmware', className: 'font-mono text-xs' },
          ]}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <DeviceFormModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSaved={(d) => {
          setCreated(d);
          list.reload({ silent: true });
        }}
      />
      <ActivationCodeModal device={created} onClose={() => setCreated(null)} />
    </>
  );
}
