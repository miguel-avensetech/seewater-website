'use client';

import { useEffect, useId, useState } from 'react';
import { CheckCircle2, ChevronRight, CloudCheck, CloudUpload, Droplets, FlaskConical, Pencil, Plus, Radio, RotateCcw, Save, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/components/layout/AuthProvider';
import { Badge, DataSourceBadge, StatusBadge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { CHART } from '@/components/charts/Charts';
import { fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { CALIBRATION, CONNECTION } from '@/lib/labels';

// Admin → Sensor Calibration. CalibrationTile is the compact card in the grid;
// CalibrationDetails (opened from a tile) holds the household's piezo sensors
// and main-line flow sensor. Each sensor has a speedometer gauge
// of how strong its vibration or water flow is against the levels being edited.
// Sensitivity and pulses per L/min reach the ESP32 through GET /device-api/commands
// (config); the device confirms them in its heartbeat (row.configSync).

const ROOM_PRESETS = ['Kitchen', 'Bathroom', 'CR', 'Laundry area', 'Garden', 'Main line'];

const num = (v) => (v === '' || v == null ? null : Number(v));
// Share of the alert level, for picking the house's most-stressed piezo.
const pct = (value, level) => (value == null || !level ? 0 : value / level);

// Point on the gauge arc: t = 0 (left, zero) … 1 (right, scale maximum).
const R = 78, CX = 110, CY = 104;
const at = (t, r = R) => [CX - r * Math.cos(Math.PI * t), CY - r * Math.sin(Math.PI * t)];
const arc = (t0, t1, r = R) => {
  const [x0, y0] = at(t0, r), [x1, y1] = at(t1, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`; // never more than the 180° dial
};
const GREY = 'var(--color-faint)';

/**
 * Speedometer gauge. `zones` are [upTo, color] bands in reading units (green,
 * yellow, red). Until the sensor is calibrated — or while no levels are set —
 * the dial stays grey. The needle shows the latest reading (resting at 0 when
 * there is none) and the small dot the 24-hour peak.
 */
function Gauge({ value, peak, zones: allZones, unit, label, calibrated }) {
  const uid = useId().replace(/:/g, '');
  // Levels that aren't set yet are skipped; the last zone always runs to the end.
  let zones = allZones.filter(([upTo], i) => upTo != null || i === allZones.length - 1);
  if (!calibrated || zones.length === 1) zones = [];
  const levels = zones.map(([upTo]) => upTo).filter((v) => v != null);
  const max = Math.max(1, ...levels.map((l) => l * 1.5), value ?? 0, peak ?? 0);
  const t = (v) => Math.min(1, Math.max(0, v / max));
  let from = 0;
  const bands = zones.map(([upTo, color]) => {
    const band = { t0: from, t1: upTo == null ? 1 : t(upTo), color };
    from = band.t1;
    return band;
  });
  const color = value == null || !zones.length ? GREY : zones.find(([upTo]) => upTo == null || value < upTo)[1];
  const deg = 180 * t(value ?? 0);
  const ticks = Array.from({ length: 21 }, (_, k) => k / 20);

  return (
    <figure className="mx-auto w-full max-w-[240px]" aria-label={`${label}: ${value == null ? 'no reading' : `${fmtNumber(value, 1)} ${unit}`}`}>
      <svg viewBox="0 0 220 128" className="w-full overflow-visible" role="img" aria-hidden>
        <defs>
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <radialGradient id={`hub-${uid}`}>
            <stop offset="0%" stopColor="var(--color-surface)" />
            <stop offset="100%" stopColor="var(--color-line)" />
          </radialGradient>
        </defs>

        {/* dial: grey track, then the coloured zones with a soft glow */}
        <path d={arc(0, 1)} stroke="var(--color-line)" strokeWidth="16" fill="none" />
        {bands.filter((b) => b.t1 > b.t0).map((b) => (
          <g key={b.t0}>
            <path d={arc(b.t0, b.t1)} stroke={b.color} strokeWidth="16" fill="none" opacity="0.35" filter={`url(#glow-${uid})`} />
            <path d={arc(b.t0, b.t1)} stroke={b.color} strokeWidth="16" fill="none" />
          </g>
        ))}
        {!bands.length && <path d={arc(0, 1)} stroke={GREY} strokeWidth="16" fill="none" opacity="0.35" />}

        {/* scale: minor ticks every 5 %, labelled major ticks every 25 % */}
        {ticks.map((k) => {
          const major = Math.round(k * 20) % 5 === 0;
          const [x0, y0] = at(k, R - 12), [x1, y1] = at(k, R - (major ? 22 : 17));
          return <line key={k} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-faint)" strokeWidth={major ? 1.5 : 0.8} />;
        })}
        {(levels.length || value != null || peak != null) && ticks.filter((k) => Math.round(k * 20) % 5 === 0).map((k) => {
          const [x, y] = at(k, R - 31);
          return <text key={k} x={x} y={y + 3} textAnchor="middle" fontSize="8.5" fill="var(--color-muted)">{fmtNumber(max * k, max < 10 ? 1 : 0)}</text>;
        })}

        {/* level markers on the dial */}
        {levels.map((l) => {
          const [x0, y0] = at(t(l), R - 9), [x1, y1] = at(t(l), R + 9);
          return <line key={l} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--color-ink)" strokeWidth="2" strokeLinecap="round" />;
        })}
        {peak != null && (() => {
          const [x, y] = at(t(peak), R + 14);
          return <circle cx={x} cy={y} r="3.5" fill={color} stroke="var(--color-surface)" strokeWidth="1.5"><title>24-hour peak</title></circle>;
        })()}

        {/* needle: drawn pointing at 0 and rotated to the reading */}
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transformBox: 'view-box', transition: 'transform 0.8s cubic-bezier(.34,1.56,.64,1)' }} opacity={value == null ? 0.55 : 1}>
          <polygon points={`${CX - R + 6},${CY} ${CX},${CY - 5} ${CX + 14},${CY} ${CX},${CY + 5}`} fill={color === GREY ? 'var(--color-ink-soft)' : color} stroke="var(--color-surface)" strokeWidth="1" />
        </g>
        <circle cx={CX} cy={CY} r="10" fill={`url(#hub-${uid})`} stroke="var(--color-ink-soft)" strokeWidth="2" />
        <circle cx={CX} cy={CY} r="3.5" fill={color === GREY ? 'var(--color-ink-soft)' : color} />
      </svg>
      <figcaption className="-mt-1 text-center">
        <p className="tabular text-2xl font-bold leading-tight" style={{ color: value == null ? GREY : color === GREY ? 'var(--color-ink)' : color }}>
          {value == null ? '—' : fmtNumber(value, 1)} <span className="text-xs font-medium text-muted">{unit}</span>
        </p>
        <p className="text-[11px] text-faint">
          {value == null ? 'No reading yet' : label}
          {peak != null ? ` · peak ${fmtNumber(peak, 1)}` : ''}
          {!calibrated ? ' · not calibrated' : ''}
        </p>
      </figcaption>
    </figure>
  );
}

function Section({ icon: Icon, title, subtitle, badge, actions, children }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon className="h-4 w-4 shrink-0 text-ocean-600" aria-hidden /> {title}</div>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">{badge}{actions}</div>
      </div>
      {children}
    </div>
  );
}

const calibratedText = (s) => {
  if (s.calibrationStatus === 'no_device') return 'No readings from the device yet';
  if (!s.lastCalibratedAt) return 'Never calibrated';
  if (s.calibrationStatus === 'awaiting_device') return `Saved ${fmtDate(s.lastCalibratedAt)} · not yet applied on device`;
  return `Calibrated ${fmtDate(s.lastCalibratedAt)}`;
};

function useSave(onSaved) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const run = async (steps, message) => {
    setBusy(true);
    setErrors({});
    try {
      let result;
      for (const step of steps) result = await step();
      if (message) toast.success(message);
      onSaved?.();
      return result;
    } catch (err) {
      setErrors(err.fields ?? {});
      toast.error(message ? 'Couldn’t save' : 'Couldn’t finish', err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, errors, setErrors, run };
}

// Inline rename for a sensor's location (e.g. "Kitchen", "Bathroom").
function RenameField({ sensor, onSaved, onDone }) {
  const [name, setName] = useState(sensor.location);
  const save = useSave(onSaved);
  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return save.setErrors({ sensorLocation: 'At least 2 characters' });
    const ok = await save.run([() => api(`/sensors/${sensor.sensorId}`, { method: 'PATCH', body: { sensorLocation: name.trim(), model: sensor.model ?? '', status: 'active' } })], 'Sensor renamed');
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit} className="flex items-start gap-1.5">
      <Input label="Sensor name" className="flex-1" value={name} onChange={(e) => setName(e.target.value)} error={save.errors.sensorLocation} maxLength={100} data-autofocus />
      <Button type="submit" size="sm" className="mt-6" loading={save.busy}>Save</Button>
      <Button size="icon-sm" variant="ghost" className="mt-6" icon={X} aria-label="Cancel rename" onClick={onDone} />
    </form>
  );
}

function PiezoSensor({ sensor, canEdit, onSaved, canRemove }) {
  const toast = useToast();
  const initial = { sensitivity: sensor.sensitivity, normal: sensor.baseline?.baselineValue ?? '', leak: sensor.limit ?? '' };
  const [v, setV] = useState(initial);
  const [renaming, setRenaming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [measured, setMeasured] = useState(null);
  const save = useSave(onSaved);
  const auto = useSave();
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => setV(initial), [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = ['sensitivity', 'normal', 'leak'].some((k) => String(v[k]) !== String(initial[k]));

  async function autoCalibrate() {
    const r = await auto.run([() => api(`/vibration/sensors/${sensor.sensorId}/measure`, { method: 'POST', body: { minutes: 60 } })]);
    if (!r) return;
    const normal = r.proposed.baselineValue;
    setV((p) => ({ ...p, normal, leak: Math.round((normal + r.proposed.acceptableRange) * 10) / 10 }));
    setMeasured(r);
  }

  function submit() {
    const sensitivity = num(v.sensitivity), normal = num(v.normal), leak = num(v.leak);
    const errs = {};
    if (sensitivity == null || sensitivity < 0.1 || sensitivity > 10) errs.sensitivity = 'Between 0.1 and 10';
    if (normal == null || normal < 0 || normal > 1023) errs.normal = 'Between 0 and 1023';
    if (leak == null || leak > 1023) errs.leak = 'Up to 1023';
    else if (normal != null && leak <= normal) errs.leak = 'Must be above the normal level';
    if (Object.keys(errs).length) return save.setErrors(errs);
    const steps = [];
    if (sensitivity !== sensor.sensitivity) {
      steps.push(() => api(`/calibration/sensors/${sensor.sensorId}`, { method: 'POST', body: { sensitivity, calibrationFactor: sensor.calibrationFactor } }));
    }
    if (normal !== initial.normal || leak !== initial.leak) {
      steps.push(() =>
        api(`/vibration/sensors/${sensor.sensorId}/baseline`, {
          method: 'PUT',
          body: {
            baselineValue: normal,
            acceptableRange: Math.round((leak - normal) * 10) / 10,
            detectionThreshold: null,
            environment: sensor.baseline?.environment ?? 'moderate',
            remarks: measured ? `Auto-calibrated from ${measured.samples} readings` : 'Set from Sensor Calibration',
            measurement: measured ? { samples: measured.samples, windowMinutes: measured.windowMinutes, mean: measured.stats.mean, stdDev: measured.stats.stdDev, max: measured.stats.max } : null,
          },
        }),
      );
    }
    save.run(steps, `${sensor.location} saved`).then(() => setMeasured(null));
  }

  const field = (key, apiKey) => ({ value: v[key], onChange: set(key), error: save.errors[key] ?? save.errors[apiKey], disabled: !canEdit || save.busy, type: 'number', step: 'any' });

  return (
    <Section
      icon={Radio}
      title={renaming ? 'Rename sensor' : sensor.location}
      subtitle={!renaming && `${calibratedText(sensor)}${sensor.lastReadingAt ? ` · last reading ${fmtRelative(sensor.lastReadingAt)}` : ''}`}
      badge={!renaming && <StatusBadge map={CALIBRATION} value={sensor.calibrationStatus} />}
      actions={
        canEdit &&
        !renaming && (
          <>
            <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label={`Rename ${sensor.location}`} onClick={() => setRenaming(true)} />
            {canRemove && <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label={`Remove ${sensor.location}`} onClick={() => setRemoving(true)} />}
          </>
        )
      }
    >
      {renaming && <RenameField sensor={sensor} onSaved={onSaved} onDone={() => setRenaming(false)} />}
      <Gauge
        label="Vibration, latest"
        unit="units"
        value={sensor.stats.now}
        peak={sensor.stats.peak}
        zones={[[num(v.normal), CHART.ok], [num(v.leak), CHART.yellow], [null, CHART.crit]]}
        calibrated={['calibrated', 'due'].includes(sensor.calibrationStatus)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Sensitivity" hint="0.1–10" {...field('sensitivity')} />
        <Input label="Normal level" suffix="units" {...field('normal', 'baselineValue')} />
        <Input label="Leak alert above" suffix="units" {...field('leak', 'acceptableRange')} />
      </div>
      {measured ? (
        <InlineNotice tone="info" title="Measured from the device — review, then save">
          {measured.samples} quiet readings in the last {measured.windowMinutes} minutes (average {measured.stats.mean}, highest {measured.stats.max}
          {measured.excludedWhileFlowing ? `; ${measured.excludedWhileFlowing} taken while water was running were left out` : ''}).
        </InlineNotice>
      ) : !sensor.baseline ? (
        <p className="text-xs text-warn-700">No leak level yet. Turn off all taps, then use Auto-calibrate.</p>
      ) : null}
      {canEdit && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="secondary" icon={Sparkles} loading={auto.busy} onClick={autoCalibrate}>Auto-calibrate</Button>
          <Button size="sm" icon={Save} loading={save.busy} disabled={!dirty} onClick={submit}>Save</Button>
        </div>
      )}
      <ConfirmDialog
        open={removing}
        onClose={() => setRemoving(false)}
        title={`Remove ${sensor.location}?`}
        confirmLabel="Remove sensor"
        message="Its leak level is deleted too. Past readings and calibration history are kept."
        onConfirm={async () => {
          await api(`/sensors/${sensor.sensorId}`, { method: 'DELETE' });
          toast.success('Sensor removed');
          onSaved();
        }}
      />
    </Section>
  );
}

function AddPiezo({ deviceId, existing, onSaved }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = useSave(onSaved);
  const taken = new Set(existing.map((n) => n.toLowerCase()));

  const submit = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2) return save.setErrors({ sensorLocation: 'Give it a name, e.g. Kitchen' });
    const ok = await save.run([() => api(`/devices/${deviceId}/sensors`, { method: 'POST', body: { sensorType: 'vibration', sensorLocation: name.trim(), model: '' } })], `${name.trim()} piezo sensor added`);
    if (ok) {
      setName('');
      setOpen(false);
    }
  };

  if (!open) return <Button variant="secondary" className="w-full" icon={Plus} onClick={() => setOpen(true)}>Add piezo sensor</Button>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-dashed border-ocean-200 p-4">
      <Input label="Where is it installed?" placeholder="e.g. Kitchen" value={name} onChange={(e) => setName(e.target.value)} error={save.errors.sensorLocation} maxLength={100} data-autofocus />
      <div className="flex flex-wrap gap-1.5">
        {ROOM_PRESETS.filter((p) => !taken.has(p.toLowerCase())).map((p) => (
          <button key={p} type="button" onClick={() => setName(p)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-soft hover:border-ocean-200 hover:text-ocean-700">
            {p}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">Wire the sensor to a free analog pin on the ESP32 first. The device receives the new sensor on its next check-in.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={save.busy}>Cancel</Button>
        <Button type="submit" icon={Plus} loading={save.busy}>Add sensor</Button>
      </div>
    </form>
  );
}

function FlowSection({ flow, canEdit, onSaved }) {
  const initial = { factor: flow.calibrationFactor, warning: flow.threshold?.warningLevel ?? '', critical: flow.threshold?.criticalLevel ?? '' };
  const [v, setV] = useState(initial);
  const [test, setTest] = useState(null); // null | { liters, minutes } while the bucket test form is open
  const [note, setNote] = useState(null);
  const save = useSave(onSaved);
  const reset = useSave(onSaved);
  const helper = useSave();
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => setV(initial), [JSON.stringify(initial)]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = ['factor', 'warning', 'critical'].some((k) => String(v[k]) !== String(initial[k]));

  async function suggest() {
    const r = await helper.run([() => api(`/calibration/sensors/${flow.sensorId}/suggest-levels`, { method: 'POST', body: { days: 7 } })]);
    if (!r) return;
    setV((p) => ({ ...p, warning: r.proposed.warningLevel, critical: r.proposed.criticalLevel }));
    setNote(`Suggested from ${r.samples} running-water readings in the last ${r.days} days (normal peak ${r.stats.p95} L/min). Review, then save.`);
  }

  async function runTest(e) {
    e.preventDefault();
    const r = await helper.run([() => api(`/calibration/sensors/${flow.sensorId}/flow-test`, { method: 'POST', body: { actualLiters: test.liters, minutes: test.minutes } })]);
    if (!r) return;
    setV((p) => ({ ...p, factor: r.proposed.calibrationFactor }));
    setTest(null);
    setNote(`Sensor counted ${r.countedLiters} L for ${r.actualLiters} L collected (${r.errorPercent > 0 ? '+' : ''}${r.errorPercent}%). New factor ${r.proposed.calibrationFactor} — review, then save.`);
  }

  function submit() {
    const factor = num(v.factor), warning = num(v.warning), critical = num(v.critical);
    const t = flow.threshold ?? { minValue: 0, maxValue: 60 };
    const errs = {};
    if (factor == null || factor <= 0 || factor > 1000) errs.factor = 'Between 0.001 and 1000';
    if (warning == null || warning <= t.minValue) errs.warning = `Must be above ${t.minValue}`;
    if (critical == null || (warning != null && critical <= warning)) errs.critical = 'Must be above the warning level';
    if (Object.keys(errs).length) return save.setErrors(errs);
    const steps = [];
    if (factor !== flow.calibrationFactor) {
      steps.push(() => api(`/calibration/sensors/${flow.sensorId}`, { method: 'POST', body: { sensitivity: flow.sensitivity, calibrationFactor: factor, remarks: note ?? '' } }));
    }
    if (warning !== initial.warning || critical !== initial.critical) {
      steps.push(() =>
        api(`/calibration/thresholds/${flow.sensorId}`, {
          method: 'PUT',
          body: { minValue: t.minValue, maxValue: Math.max(t.maxValue, critical), warningLevel: warning, criticalLevel: critical, remarks: note ?? 'Set from Sensor Calibration' },
        }),
      );
    }
    save.run(steps, 'Flow sensor saved').then(() => setNote(null));
  }

  const field = (key, apiKey) => ({ value: v[key], onChange: set(key), error: save.errors[key] ?? save.errors[apiKey], disabled: !canEdit || save.busy, type: 'number', step: 'any' });

  return (
    <Section
      icon={Droplets}
      title="Main line flow sensor"
      subtitle={`${flow.location} · ${calibratedText(flow)}`}
      badge={<StatusBadge map={CALIBRATION} value={flow.calibrationStatus} />}
    >
      <Gauge
        label="Water flow, latest"
        unit="L/min"
        value={flow.stats.now}
        peak={flow.stats.peak}
        zones={[[num(v.warning), CHART.ok], [num(v.critical), CHART.yellow], [null, CHART.crit]]}
        calibrated={['calibrated', 'due'].includes(flow.calibrationStatus)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Pulses per L/min" hint="YF-S201 ≈ 7.5" {...field('factor', 'calibrationFactor')} />
        <Input label="Warning above" suffix="L/min" {...field('warning', 'warningLevel')} />
        <Input label="Critical above" suffix="L/min" {...field('critical', 'criticalLevel')} />
      </div>
      {note ? <InlineNotice tone="info">{note}</InlineNotice> : flow.threshold?.isDefault ? <p className="text-xs text-muted">Using the system default warning and critical levels.</p> : null}
      {test && (
        <form onSubmit={runTest} className="space-y-3 rounded-lg border border-dashed border-ocean-200 p-3">
          <p className="text-xs text-ink-soft">Fill a bucket of known size from a tap, then enter how much you collected and how many minutes ago you started.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Water collected" type="number" step="any" suffix="L" value={test.liters} onChange={(e) => setTest((t) => ({ ...t, liters: e.target.value }))} error={helper.errors.actualLiters} data-autofocus />
            <Input label="Started" type="number" step="1" suffix="min ago" value={test.minutes} onChange={(e) => setTest((t) => ({ ...t, minutes: e.target.value }))} error={helper.errors.minutes} />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setTest(null)}>Cancel</Button>
            <Button size="sm" type="submit" loading={helper.busy}>Compare with sensor</Button>
          </div>
        </form>
      )}
      {canEdit && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="secondary" icon={Sparkles} loading={helper.busy && !test} onClick={suggest}>Suggest levels</Button>
          {!test && <Button size="sm" variant="secondary" icon={FlaskConical} onClick={() => setTest({ liters: '', minutes: 5 })}>Bucket test</Button>}
          <Button size="sm" icon={Save} loading={save.busy} disabled={!dirty} onClick={submit}>Save</Button>
          {flow.threshold && !flow.threshold.isDefault && (
            <Button size="sm" variant="ghost" icon={RotateCcw} loading={reset.busy} onClick={() => reset.run([() => api(`/calibration/thresholds/${flow.sensorId}`, { method: 'DELETE' })], 'Flow levels reset to the system default')}>
              Default levels
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

const SYNC = {
  synced: { tone: 'ok', icon: CloudCheck, label: 'Applied on device', text: (r) => `The device confirmed the current calibration${r.configAppliedAt ? ` ${fmtRelative(r.configAppliedAt)}` : ''}.` },
  pending: { tone: 'warn', icon: CloudUpload, label: 'Waiting for device', text: () => 'Saved here. The device applies it on its next check-in.' },
  never: { tone: 'neutral', icon: CloudUpload, label: 'Not confirmed yet', text: () => 'This device hasn’t confirmed any calibration yet. Its firmware needs to report configVersion in the heartbeat.' },
};

export function CalibrationDetails({ row, hours, onSaved }) {
  const { canEdit } = useAuth();
  const { piezos, flow } = row;
  const sync = SYNC[row.configSync] ?? SYNC.never;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 text-[13px] md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge map={CONNECTION} value={row.device.connectionStatus} />
            {row.device.isSimulated && <DataSourceBadge state="simulated" />}
            <span className="text-muted">Device <span className="font-mono text-ink">{row.deviceName}</span></span>
          </div>
          <p className="text-[11px] text-faint">Gauges: needle = latest reading · dot = peak in the last {hours} hours · grey until calibrated, then green normal, yellow warning, red alert.</p>
        </div>
        <div className="rounded-lg border border-line p-3">
          <p className="flex items-center gap-1.5 font-semibold text-ink"><sync.icon className="h-4 w-4" aria-hidden /> <Badge tone={sync.tone}>{sync.label}</Badge></p>
          <p className="mt-1 text-xs text-muted">{sync.text(row)}</p>
        </div>
      </div>

      {/* One even grid: the main-line flow sensor first, then each piezo. */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Sensors · main line {flow ? 1 : 0} · piezo {piezos.length}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {flow ? (
            <FlowSection flow={flow} canEdit={canEdit} onSaved={onSaved} />
          ) : (
            <p className="flex items-center justify-center rounded-lg border border-dashed border-line p-4 text-xs text-muted">No flow sensor on this device.</p>
          )}
          {piezos.map((p) => (
            <PiezoSensor
              key={p.sensorId}
              sensor={p}
              canEdit={canEdit}
              canRemove={piezos.length > 1}
              onSaved={onSaved}
            />
          ))}
          {!piezos.length && <p className="flex items-center justify-center rounded-lg border border-dashed border-line p-4 text-xs text-muted">No piezo sensor on this device yet.</p>}
        </div>
        {canEdit && <AddPiezo deviceId={row.device.id} existing={piezos.map((p) => p.location)} onSaved={onSaved} />}
      </div>
      {!canEdit && <InlineNotice tone="info">Your account is read-only. Ask an administrator to change calibration.</InlineNotice>}
    </div>
  );
}

// Popup title: the homeowner's name with what needs checking beside it.
export function CalibrationTitle({ row }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span>{row.ownerName ?? 'Household'}</span>
      {row.issues.length ? (
        row.issues.map((i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-warn-50 px-2 py-0.5 text-xs font-medium text-warn-700">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> {i}
          </span>
        ))
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-ok-50 px-2 py-0.5 text-xs font-medium text-ok-700">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Everything looks normal
        </span>
      )}
    </span>
  );
}

const fmtLevel = (value, unit) => (value == null ? '—' : `${fmtNumber(value, 1)} ${unit}`);

function TileRow({ icon: Icon, label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="flex items-center gap-1.5 text-muted"><Icon className="h-3.5 w-3.5" aria-hidden /> {label}</span>
      <span className={tone === 'warn' ? 'font-semibold text-warn-700' : 'tabular text-ink'}>{value}</span>
    </div>
  );
}

// Compact grid card: who, where, and whether anything needs attention.
export function CalibrationTile({ row, onSelect, selected }) {
  const { piezos, flow } = row;
  // The piezo closest to (or furthest over) its leak level represents the house.
  const worst = piezos.reduce((w, p) => (p.stats.now != null && (!w || pct(p.stats.now, p.limit) > pct(w.stats.now, w.limit)) ? p : w), null);
  const vibHigh = piezos.some((p) => p.limit != null && p.stats.now != null && p.stats.now > p.limit);
  const flowHigh = flow?.threshold && flow.stats.now != null && flow.stats.now >= flow.threshold.warningLevel;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-haspopup="dialog"
      className={`group flex w-full flex-col gap-3 rounded-xl border bg-surface p-4 text-left shadow-card transition hover:border-ocean-200 hover:shadow-pop focus-visible:outline-2 focus-visible:outline-ocean-600 ${selected ? 'border-ocean-500' : 'border-line'}`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{row.ownerName ?? 'No homeowner yet'}</p>
          <p className="truncate text-xs text-muted">{row.address ?? row.houseName ?? row.deviceName}</p>
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-ocean-600" aria-hidden />
      </div>
      <div className="w-full space-y-1.5">
        <TileRow
          icon={Radio}
          label={piezos.length > 1 ? `Vibration (${piezos.length} sensors)` : 'Vibration'}
          value={!piezos.length ? 'No sensor' : worst ? `${fmtLevel(worst.stats.now, 'units')}${piezos.length > 1 ? ` · ${worst.location}` : ''}` : '—'}
          tone={vibHigh && 'warn'}
        />
        <TileRow icon={Droplets} label="Flow" value={flow ? fmtLevel(flow.stats.now, 'L/min') : 'No sensor'} tone={flowHigh && 'warn'} />
      </div>
      <div className="mt-auto flex w-full flex-wrap items-center gap-1.5">
        <StatusBadge map={CONNECTION} value={row.device.connectionStatus} />
        {row.issues.length ? (
          <Badge tone="warn" dot>{row.issues.length === 1 ? row.issues[0] : `${row.issues.length} things to check`}</Badge>
        ) : (
          <Badge tone="ok" dot>All good</Badge>
        )}
      </div>
    </button>
  );
}
