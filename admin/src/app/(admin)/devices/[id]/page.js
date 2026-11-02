'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, Cpu, FlaskConical, Gauge, KeyRound, Pencil, Plus, RefreshCw, Signal, Trash2, Waves, HardDrive } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/components/layout/AuthProvider';
import { useLive } from '@/components/layout/LiveProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DescriptionList, PageHeader } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, InlineNotice, PageLoader } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { TimeSeriesChart, CHART } from '@/components/charts/Charts';
import { ValveStatus } from '@/components/domain/ValveStatus';
import { CopyButton, DeviceFormModal, SensorFormModal } from '@/components/domain/DeviceForms';
import { fmtDate, fmtDateTime, fmtFlow, fmtRelative, fmtTime } from '@/lib/format';
import { ACTIVATION, CALIBRATION, CONNECTION, LOG_STATUS, SENSOR_STATUS, SENSOR_TYPE, VALVE_COMMAND } from '@/lib/labels';

function ValveHistory({ valveId, version }) {
  const { data } = useApi(`/valves/${valveId}/commands`, { query: { v: version } });
  if (!data?.items.length) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Command history</p>
      <ol className="space-y-2">
        {data.items.slice(0, 6).map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-2 text-[13px]">
            <div className="min-w-0">
              <p className="font-medium text-ink">{c.emergency ? 'Emergency stop' : c.action === 'close' ? 'Shut off' : 'Restore'} <span className="font-normal text-muted">· {c.requestedByName} ({c.requestedByType})</span></p>
              <p className="text-xs text-faint">{fmtDateTime(c.requestedAt)}</p>
            </div>
            <StatusBadge map={VALVE_COMMAND} value={c.status} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function DeviceDetailPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { canEdit } = useAuth();
  const { liveKey } = useLive(['devices']);
  const { data, error, loading, reload } = useApi(`/devices/${id}`, { refreshMs: 30000, liveKey });
  const [editOpen, setEditOpen] = useState(false);
  const [sensorModal, setSensorModal] = useState({ open: false, sensor: null });
  const [confirm, setConfirm] = useState(null);

  if (loading && !data) return <PageLoader />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { device, sensors, valve, logs, statusHistory } = data;
  const signal = [...statusHistory].reverse().filter((h) => h.signalStrength != null);
  const silent = () => reload({ silent: true });

  return (
    <>
      <Link href="/devices" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All devices
      </Link>
      <PageHeader
        eyebrow={device.deviceType === 'esp32_gateway' ? 'ESP32 gateway' : 'ESP32 sensor node'}
        title={<span className="font-mono">{device.deviceName}</span>}
        description={device.houseName ? `${device.houseName} · ${device.ownerName}` : 'Not assigned to a household'}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditOpen(true)}>Edit</Button>
              {device.activationStatus === 'activated' && <Button variant="secondary" icon={Ban} onClick={() => setConfirm('deactivate')}>Deactivate</Button>}
              <Button variant="danger-outline" icon={Trash2} onClick={() => setConfirm('delete')}>Remove</Button>
            </>
          )
        }
      />

      {device.isSimulated && (
        <InlineNotice tone="warn" icon={FlaskConical} title="Simulated sample device" className="mb-5">
          This device was created by the sample-data seed. Its readings come from seed data or the device simulator, not installed hardware.
        </InlineNotice>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader icon={Cpu} title="Device information" actions={<StatusBadge map={CONNECTION} value={device.connectionStatus} pulse={device.connectionStatus === 'online'} />} />
            <CardBody>
              <DescriptionList
                columns={3}
                items={[
                  { label: 'MAC address', value: <span className="font-mono">{device.macAddress || '—'}</span> },
                  { label: 'Firmware', value: <span className="font-mono">{device.firmwareVersion || '—'}</span> },
                  { label: 'Last seen', value: device.lastOnline ? `${fmtRelative(device.lastOnline)} (${fmtDateTime(device.lastOnline)})` : 'Never' },
                  { label: 'Signal strength', value: device.signalStrength != null ? `${device.signalStrength} dBm` : '—' },
                  { label: 'Household', value: device.houseName ? <Link className="font-semibold text-ocean-700 hover:underline" href={`/users/${device.ownerId}`}>{device.houseName}</Link> : <span className="text-warn-700">Unassigned</span> },
                  { label: 'Address', value: device.address },
                  { label: 'Registered', value: `${fmtDate(device.registeredAt)}${device.registeredByName ? ` by ${device.registeredByName}` : ''}` },
                  { label: 'Activated', value: device.activatedAt ? fmtDateTime(device.activatedAt) : '—' },
                  { label: 'Homeowner app link', value: device.linkedUserName ? `${device.linkedUserName} · ${fmtDate(device.linkedAt)}` : 'Not linked in the mobile app yet' },
                  { label: 'Notes', value: device.notes || '—' },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Sensors" description="Installed flow and vibration sensors" actions={canEdit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setSensorModal({ open: true, sensor: null })}>Add sensor</Button>} />
            {sensors.length ? (
              <ul className="divide-y divide-line">
                {sensors.map((s) => (
                  <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ocean-50 text-ocean-600">{s.sensorType === 'flow' ? <Gauge className="h-5 w-5" /> : <Waves className="h-5 w-5" />}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{SENSOR_TYPE[s.sensorType].label} · {s.sensorLocation}</p>
                        <StatusBadge map={SENSOR_STATUS} value={s.status} />
                        <StatusBadge map={CALIBRATION} value={s.calibrationStatus} dot={false} />
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">
                        {s.model || 'Model not set'} ·{' '}
                        {s.sensorType === 'flow'
                          ? `Last ${fmtFlow(s.lastFlowRate)} · thresholds ${s.threshold?.warningLevel ?? '—'} / ${s.threshold?.criticalLevel ?? '—'} L/min`
                          : `Last level ${s.lastVibrationLevel ?? '—'} · baseline ${s.baseline ? `${s.baseline.baselineValue} ± ${s.baseline.acceptableRange}` : 'not set'}`}
                        {s.lastReadingAt && ` · ${fmtRelative(s.lastReadingAt)}`}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      <ButtonLink size="sm" variant="ghost" href="/calibration">Calibrate</ButtonLink>
                      {canEdit && <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label="Edit sensor" onClick={() => setSensorModal({ open: true, sensor: s })} />}
                      {canEdit && <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label="Remove sensor" onClick={() => setConfirm({ sensor: s })} />}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No sensors" message="Add the sensors installed with this device." />
            )}
          </Card>

          <Card>
            <CardHeader icon={Signal} title="Connectivity history" description="Wi-Fi signal strength reported with each heartbeat" />
            <CardBody>
              {signal.length > 1 ? (
                <TimeSeriesChart kind="line" data={signal} xKey="recordedAt" xFormatter={(v) => `${fmtDate(v, { year: undefined })} ${fmtTime(v)}`} height={180} series={[{ key: 'signalStrength', label: 'Signal', unit: 'dBm', color: CHART.aqua }]} />
              ) : (
                <EmptyState icon={Signal} title="Not enough connectivity data" message="Signal strength history appears after the device sends heartbeats." className="py-6" />
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={KeyRound} title="Activation" actions={<StatusBadge map={ACTIVATION} value={device.activationStatus} dot={false} />} />
            <CardBody className="space-y-3">
              {device.activationCode ? (
                <>
                  <p className="text-[13px] text-muted">Give this code to the homeowner (SeeWater app → Link device) and use it to activate the hardware. Each can use it once.</p>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-canvas px-3 py-2.5">
                    <span className="select-all font-mono text-lg font-bold tracking-[0.1em] text-ink">{device.activationCode}</span>
                    <CopyButton value={device.activationCode} />
                  </div>
                  <ul className="space-y-1 text-[13px]">
                    <li className={device.activationCodeUse?.hardware ? 'text-ok-700' : 'text-muted'}>{device.activationCodeUse?.hardware ? '✓ Hardware activated' : '○ Hardware not activated yet'}</li>
                    <li className={device.activationCodeUse?.homeowner ? 'text-ok-700' : 'text-muted'}>{device.activationCodeUse?.homeowner ? '✓ Linked in the homeowner app' : '○ Not linked in the homeowner app yet'}</li>
                    <li className="text-muted">Expires {fmtDate(device.activationCodeExpiresAt)}</li>
                  </ul>
                </>
              ) : (
                <p className="text-[13px] text-muted">{device.activationStatus === 'activated' ? 'Device credentials are active. Issuing a new code revokes them and the device must be re-activated.' : 'The device is deactivated and cannot report data.'}</p>
              )}
              {canEdit && !device.isSimulated && (
                <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setConfirm('regenerate')}>Issue new activation code</Button>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Solenoid valve" description="Operated by the homeowner from the app, or by automatic shutoff" />
            <CardBody>
              <ValveStatus valve={valve} />
              {valve && <ValveHistory valveId={valve.id} version={valve.lastUpdated} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={HardDrive} title="Recent device events" actions={<Link href={`/logs/devices?deviceId=${device.id}`} className="text-[13px] font-semibold text-ocean-700 hover:underline">All logs</Link>} />
            {logs.length ? (
              <ol className="space-y-3 px-5 py-4">
                {logs.slice(0, 10).map((l) => (
                  <li key={l.id} className="text-[13px]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium capitalize text-ink">{l.eventType.replaceAll('_', ' ')}</p>
                      <StatusBadge map={LOG_STATUS} value={l.status} />
                    </div>
                    <p className="text-muted">{l.description}</p>
                    <p className="text-xs text-faint">{fmtDateTime(l.loggedAt)}{l.source === 'simulated' && ' · simulated'}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No events yet" className="py-8" />
            )}
          </Card>
        </div>
      </div>

      <DeviceFormModal open={editOpen} device={device} onClose={() => setEditOpen(false)} onSaved={silent} />
      <SensorFormModal open={sensorModal.open} sensor={sensorModal.sensor} deviceId={device.id} onClose={() => setSensorModal({ open: false, sensor: null })} onSaved={silent} />
      <ConfirmDialog
        open={confirm === 'regenerate'}
        onClose={() => setConfirm(null)}
        title="Issue a new activation code?"
        confirmLabel="Issue new code"
        message="The current code and any active device credentials will stop working. The device will go offline until it is activated with the new code."
        onConfirm={async () => {
          await api(`/devices/${device.id}/activation-code`, { method: 'POST' });
          toast.success('New activation code issued');
          silent();
        }}
      />
      <ConfirmDialog
        open={confirm === 'deactivate'}
        onClose={() => setConfirm(null)}
        title={`Deactivate ${device.deviceName}?`}
        confirmLabel="Deactivate"
        message="The device's credentials are revoked and it will no longer be able to send readings or receive valve commands."
        onConfirm={async () => {
          await api(`/devices/${device.id}/deactivate`, { method: 'POST' });
          toast.success('Device deactivated');
          silent();
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Remove ${device.deviceName}?`}
        confirmLabel="Remove device"
        confirmText={device.deviceName}
        message="This removes the device, its sensors, thresholds and valve record. Historical readings, logs and calibration history are kept for auditing."
        onConfirm={async () => {
          await api(`/devices/${device.id}`, { method: 'DELETE' });
          toast.success('Device removed');
          router.replace('/devices');
        }}
      />
      <ConfirmDialog
        open={Boolean(confirm?.sensor)}
        onClose={() => setConfirm(null)}
        title="Remove sensor?"
        confirmLabel="Remove sensor"
        message={confirm?.sensor && `${SENSOR_TYPE[confirm.sensor.sensorType].label} sensor at ${confirm.sensor.sensorLocation} will be removed with its thresholds and baseline.`}
        onConfirm={async () => {
          await api(`/sensors/${confirm.sensor.id}`, { method: 'DELETE' });
          toast.success('Sensor removed');
          silent();
        }}
      />
    </>
  );
}
