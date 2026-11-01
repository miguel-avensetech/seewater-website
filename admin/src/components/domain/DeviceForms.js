'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useForm, rules } from '@/hooks/useForm';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { SENSOR_STATUS, options } from '@/lib/labels';

const MAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const DEVICE_TYPES = [
  { value: 'esp32_gateway', label: 'ESP32 gateway' },
  { value: 'esp32_sensor_node', label: 'ESP32 sensor node (ESP-NOW)' },
];

function useHouseOptions(open) {
  const { data } = useApi(open ? '/houses' : null);
  return (data?.items ?? []).map((h) => ({ value: h.id, label: `${h.houseName} — ${h.ownerName ?? 'no owner'}` }));
}

const emptyDevice = { deviceName: '', deviceType: 'esp32_gateway', macAddress: '', firmwareVersion: '', houseId: '', notes: '', flow: true, flowLocation: 'Main line', vibration: true, vibrationLocation: 'Main line', includeValve: true };

export function DeviceFormModal({ open, device, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(device);
  const houseOptions = useHouseOptions(open);

  const form = useForm(emptyDevice, {
    validate: (v) => ({
      deviceName: rules.required(v.deviceName, 'Device name') || rules.minLen(v.deviceName, 2),
      macAddress: v.macAddress && !MAC.test(v.macAddress.trim()) ? 'Use the format AA:BB:CC:DD:EE:FF' : null,
      flowLocation: !editing && v.flow && !v.flowLocation.trim() ? 'Enter the sensor location' : null,
      vibrationLocation: !editing && v.vibration && !v.vibrationLocation.trim() ? 'Enter the sensor location' : null,
    }),
    onSubmit: async (v) => {
      const base = { deviceName: v.deviceName, deviceType: v.deviceType, macAddress: v.macAddress.trim(), firmwareVersion: v.firmwareVersion, houseId: v.houseId || null, notes: v.notes };
      const body = editing
        ? base
        : {
            ...base,
            includeValve: v.includeValve,
            sensors: [v.flow && { sensorType: 'flow', sensorLocation: v.flowLocation, model: 'YF-S201' }, v.vibration && { sensorType: 'vibration', sensorLocation: v.vibrationLocation, model: 'SW-420 / piezo film' }].filter(Boolean),
          };
      const saved = await api(editing ? `/devices/${device.id}` : '/devices', { method: editing ? 'PATCH' : 'POST', body });
      if (editing) toast.success('Device updated');
      onSaved(saved);
      onClose();
    },
  });

  useEffect(() => {
    if (open) form.reset(device ? { ...emptyDevice, deviceName: device.deviceName, deviceType: device.deviceType, macAddress: device.macAddress ?? '', firmwareVersion: device.firmwareVersion ?? '', houseId: device.houseId ?? '', notes: device.notes ?? '' } : emptyDevice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device]);

  const v = form.values;
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      title={editing ? 'Edit device' : 'Register IoT device'}
      description={editing ? 'Update device details or reassign it to a household.' : 'A unique activation code is generated after registration.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="device-form" loading={form.submitting}>{editing ? 'Save changes' : 'Register device'}</Button>
        </>
      }
    >
      <form id="device-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Device name" placeholder="SW-GW-007" required {...form.bind('deviceName')} />
          <Select label="Device type" options={DEVICE_TYPES} {...form.bind('deviceType')} />
          <Input label="MAC address" placeholder="24:6F:28:AA:BB:CC" hint="Optional — locks activation to this hardware" {...form.bind('macAddress')} />
          <Input label="Firmware version" placeholder="1.2.0" {...form.bind('firmwareVersion')} />
        </div>
        <Select label="Household" placeholder="Not assigned yet" options={houseOptions} {...form.bind('houseId')} hint="Devices must be assigned before they can report readings." />

        {!editing && (
          <fieldset className="space-y-3 rounded-lg border border-line p-4">
            <legend className="px-1 text-[13px] font-semibold text-ink-soft">Installed components</legend>
            {[
              ['flow', 'flowLocation', 'Water flow sensor (YF-S201)'],
              ['vibration', 'vibrationLocation', 'Piezo vibration sensor (SW-420)'],
            ].map(([key, loc, label]) => (
              <div key={key} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr]">
                <label className="flex items-center gap-2 pt-2 text-sm text-ink">
                  <input type="checkbox" checked={v[key]} onChange={(e) => form.set(key, e.target.checked)} className="h-4 w-4 rounded border-line-strong text-ocean-600" />
                  {label}
                </label>
                {v[key] && <Input aria-label={`${label} location`} placeholder="Location, e.g. Main line" {...form.bind(loc)} />}
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={v.includeValve} onChange={(e) => form.set('includeValve', e.target.checked)} className="h-4 w-4 rounded border-line-strong text-ocean-600" />
              Solenoid valve with relay module (remote shutoff)
            </label>
          </fieldset>
        )}
        <Textarea label="Notes" rows={2} {...form.bind('notes')} />
      </form>
    </Modal>
  );
}

export function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={copied ? Check : Copy}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable — code remains selectable */
        }
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function ActivationCodeModal({ device, onClose }) {
  return (
    <Modal
      open={Boolean(device)}
      onClose={onClose}
      size="sm"
      title="Device registered"
      description={device?.deviceName}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {device && (
        <div className="space-y-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-aqua-50 text-aqua-600">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13px] text-muted">Activation code</p>
            <p className="mt-1 select-all font-mono text-2xl font-bold tracking-[0.12em] text-ink">{device.activationCode}</p>
          </div>
          <CopyButton value={device.activationCode} label="Copy code" />
          <p className="text-[13px] text-muted">Enter this code on the SeeWater app during installation to activate the device. It can be used once; you can issue a new one from the device page.</p>
        </div>
      )}
    </Modal>
  );
}

export function SensorFormModal({ open, deviceId, sensor, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(sensor);
  const form = useForm(
    { sensorType: 'flow', sensorLocation: '', model: '', status: 'active' },
    {
      validate: (v) => ({ sensorLocation: rules.required(v.sensorLocation, 'Location') || rules.minLen(v.sensorLocation, 2) }),
      onSubmit: async (v) => {
        const body = editing ? { sensorLocation: v.sensorLocation, model: v.model, status: v.status } : { sensorType: v.sensorType, sensorLocation: v.sensorLocation, model: v.model };
        await api(editing ? `/sensors/${sensor.id}` : `/devices/${deviceId}/sensors`, { method: editing ? 'PATCH' : 'POST', body });
        toast.success(editing ? 'Sensor updated' : 'Sensor added');
        onSaved();
        onClose();
      },
    },
  );
  useEffect(() => {
    if (open) form.reset(sensor ? { sensorType: sensor.sensorType, sensorLocation: sensor.sensorLocation, model: sensor.model ?? '', status: sensor.status } : { sensorType: 'flow', sensorLocation: '', model: '', status: 'active' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sensor]);

  return (
    <Modal open={open} onClose={onClose} busy={form.submitting} size="sm" title={editing ? 'Edit sensor' : 'Add sensor'} footer={<><Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button><Button type="submit" form="sensor-form" loading={form.submitting}>Save</Button></>}>
      <form id="sensor-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        <Select label="Sensor type" disabled={editing} options={[{ value: 'flow', label: 'Water flow' }, { value: 'vibration', label: 'Vibration (piezo)' }]} {...form.bind('sensorType')} />
        <Input label="Location" placeholder="Main line, Kitchen line, CR line…" required {...form.bind('sensorLocation')} />
        <Input label="Model" placeholder="YF-S201" {...form.bind('model')} />
        {editing && <Select label="Status" options={options(SENSOR_STATUS)} {...form.bind('status')} />}
      </form>
    </Modal>
  );
}
