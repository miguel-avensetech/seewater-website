import { Router } from 'express';
import { db, C } from '../db/index.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { dayKey } from '../lib/time.js';
import { parse, z } from '../lib/validate.js';
import { dataState } from '../services/dataState.js';
import { loadLookups } from '../services/lookups.js';
import { getSettings } from '../services/settings.js';
import { classifyFlow, getThresholdProfile, getVibrationBaseline, vibrationLimit } from '../services/thresholds.js';

const router = Router();

async function houseSnapshot(house, ctx) {
  const { lk, sensorsByDevice, valvesByDevice, usageToday, openAlerts, settings } = ctx;
  const devices = lk.devices.filter((d) => d.houseId === house.id);
  const sensors = devices.flatMap((d) => sensorsByDevice.get(d.id) || []);
  const flow = sensors.find((s) => s.sensorType === 'flow');
  const vib = sensors.find((s) => s.sensorType === 'vibration');
  const profile = flow ? await getThresholdProfile(flow, settings) : null;
  const baseline = vib ? await getVibrationBaseline(vib.id) : null;
  const device = devices[0] ?? null;
  const source = device?.isSimulated ? 'simulated' : 'device';
  const flowStatus = classifyFlow(flow?.lastFlowRate, profile);
  const limit = vibrationLimit(baseline);
  const alerts = openAlerts.filter((a) => a.houseId === house.id);
  const hasLeak = alerts.some((a) => a.alertType === 'possible_leak');

  let status = flowStatus === 'unknown' ? 'no_data' : flowStatus;
  if (hasLeak) status = 'critical';

  return {
    houseId: house.id,
    ...lk.describeHouse(house.id),
    houseStatus: house.houseStatus,
    status,
    device: device && {
      id: device.id,
      deviceName: device.deviceName,
      connectionStatus: device.connectionStatus,
      lastOnline: device.lastOnline ?? null,
      signalStrength: device.signalStrength ?? null,
      isSimulated: Boolean(device.isSimulated),
    },
    flow: flow && {
      sensorId: flow.id,
      location: flow.sensorLocation,
      flowRate: flow.lastFlowRate ?? null,
      lastReadingAt: flow.lastReadingAt ?? null,
      status: flowStatus,
      warningLevel: profile?.warningLevel ?? null,
      criticalLevel: profile?.criticalLevel ?? null,
      dataState: dataState(source, flow.lastReadingAt),
    },
    vibration: vib && {
      sensorId: vib.id,
      location: vib.sensorLocation,
      level: vib.lastVibrationLevel ?? null,
      limit,
      baseline: baseline?.baselineValue ?? null,
      abnormal: limit != null && vib.lastVibrationLevel != null && vib.lastVibrationLevel > limit,
      lastReadingAt: vib.lastReadingAt ?? null,
      dataState: dataState(source, vib.lastReadingAt),
    },
    todayLiters: usageToday.filter((u) => u.houseId === house.id).reduce((s, u) => s + u.litersUsed, 0),
    valve: device ? valvesByDevice.get(device.id) ?? null : null,
    openAlerts: alerts.map((a) => ({ id: a.id, alertType: a.alertType, severityLevel: a.severityLevel, createdAt: a.createdAt })),
  };
}

router.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [lk, sensors, valves, usageToday, openAlerts, settings] = await Promise.all([
      loadLookups(),
      db.list(C.sensors),
      db.list(C.valves),
      db.list(C.waterUsage, { where: [['date', '==', dayKey(new Date())]] }),
      db.list(C.alerts, { where: [['alertStatus', 'in', ['open', 'acknowledged']]] }),
      getSettings(),
    ]);
    const sensorsByDevice = Map.groupBy(sensors, (s) => s.deviceId);
    const valvesByDevice = new Map(valves.map((v) => [v.deviceId, v]));
    const ctx = { lk, sensorsByDevice, valvesByDevice, usageToday, openAlerts, settings };
    const houses = await Promise.all(lk.houses.map((h) => houseSnapshot(h, ctx)));

    const counts = { normal: 0, high: 0, critical: 0, no_data: 0 };
    for (const h of houses) counts[h.status] = (counts[h.status] || 0) + 1;

    res.json({
      generatedAt: new Date().toISOString(),
      units: { flow: 'L/min', usage: 'L' },
      counts,
      devices: {
        online: lk.devices.filter((d) => d.connectionStatus === 'online').length,
        offline: lk.devices.filter((d) => d.connectionStatus === 'offline').length,
        notConnected: lk.devices.filter((d) => ['never_connected', 'not_activated'].includes(d.connectionStatus)).length,
      },
      // null when no online device has reported flow (unknown ≠ zero).
      totalFlowRate: (() => {
        const vals = houses.filter((h) => h.device?.connectionStatus === 'online' && h.flow?.flowRate != null).map((h) => h.flow.flowRate);
        return vals.length ? vals.reduce((s, v) => s + v, 0) : null;
      })(),
      todayLiters: houses.reduce((s, h) => s + h.todayLiters, 0),
      leakEvents: openAlerts.filter((a) => a.alertType === 'possible_leak').length,
      houses,
    });
  }),
);

const readingsQuery = z.object({ minutes: z.coerce.number().int().min(5).max(1440).default(60) });

router.get(
  '/houses/:houseId/readings',
  asyncHandler(async (req, res) => {
    const { minutes } = parse(readingsQuery, req.query);
    const house = await db.get(C.houses, req.params.houseId);
    if (!house) throw notFound('Household');
    const since = new Date(Date.now() - minutes * 60000).toISOString();
    const rows = await db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]], orderBy: ['recordedAt', 'asc'] });
    const readings = rows.filter((r) => r.houseId === house.id);
    res.json({
      houseId: house.id,
      minutes,
      units: { flow: 'L/min', usage: 'L' },
      sources: [...new Set(readings.map((r) => r.source))],
      readings: readings.map(({ id, readingType, flowRate, vibrationLevel, waterUsage, recordedAt, source }) => ({
        id, readingType, flowRate, vibrationLevel, waterUsage, recordedAt, source,
      })),
    });
  }),
);

export default router;
