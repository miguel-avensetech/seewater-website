// Read models for the homeowner app. Every function takes an ownership scope
// (from ownedScope) so data from other households can never be included.

import { db, C } from '../db/index.js';
import { addDays, dayKey, startOfDay } from '../lib/time.js';
import { dataState } from './dataState.js';
import { withStatus } from './deviceStatus.js';
import { getSettings } from './settings.js';
import { classifyFlow, getThresholdProfile, getVibrationBaseline, vibrationLimit } from './thresholds.js';
import { interruptionStatus } from '../routes/interruptions.js';

// Water interruptions whose areas match the homeowner's addresses (same rule
// as area announcements): ongoing and scheduled, plus ones closed recently.
export async function interruptionsForUser(user, scope, { recentDays = 14 } = {}) {
  const addresses = [user.address, ...scope.houses.map((h) => h.address)].filter(Boolean).join(' ').toLowerCase();
  if (!addresses) return [];
  const cutoff = new Date(Date.now() - recentDays * 86400000).toISOString();
  const rank = { ongoing: 0, scheduled: 1, completed: 2, cancelled: 3 };
  return (await db.list(C.waterInterruptions))
    .map((i) => ({ ...i, status: interruptionStatus(i) }))
    .filter((i) => i.areas.toLowerCase().split(/[,;]/).some((t) => t.trim() && addresses.includes(t.trim())))
    .filter((i) => i.status === 'ongoing' || i.status === 'scheduled' || (i.cancelledAt ?? i.restoredAt ?? i.endAt ?? i.startAt) >= cutoff)
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.status === 'scheduled' ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt)))
    .map(({ id, title, type, reason, areas, startAt, endAt, restoredAt, cancelledAt, closeNote, status }) => ({ id, title, type, reason, areas, startAt, endAt, restoredAt, cancelledAt, closeNote: closeNote || null, status }));
}

export async function deviceSnapshots(scope, settings) {
  if (!scope.devices.length) return [];
  const [sensors, valves] = await Promise.all([db.list(C.sensors), db.list(C.valves)]);
  return Promise.all(
    scope.devices.map(async (raw) => {
      const device = withStatus(raw);
      const online = device.connectionStatus === 'online';
      const source = device.isSimulated ? 'simulated' : 'device';
      const own = sensors.filter((s) => s.deviceId === device.id);
      const flow = own.find((s) => s.sensorType === 'flow');
      const vib = own.find((s) => s.sensorType === 'vibration');
      const profile = flow ? await getThresholdProfile(flow, settings) : null;
      const baseline = vib ? await getVibrationBaseline(vib.id) : null;
      const limit = vibrationLimit(baseline);
      const house = scope.houses.find((h) => h.id === device.houseId);
      const valve = valves.find((v) => v.deviceId === device.id) ?? null;

      return {
        id: device.id,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        firmwareVersion: device.firmwareVersion || null,
        connectionStatus: device.connectionStatus,
        lastOnline: device.lastOnline ?? null,
        signalStrength: device.signalStrength ?? null,
        isSimulated: Boolean(device.isSimulated),
        linkedAt: device.linkedAt ?? null,
        house: house ? { id: house.id, houseName: house.houseName, address: house.address } : null,
        // Readings from an offline device are not "current": report them as unavailable.
        flow: flow && {
          sensorId: flow.id,
          location: flow.sensorLocation,
          flowRate: online ? flow.lastFlowRate ?? null : null,
          lastKnownFlowRate: flow.lastFlowRate ?? null,
          lastReadingAt: flow.lastReadingAt ?? null,
          status: online ? classifyFlow(flow.lastFlowRate, profile) : 'unknown',
          warningLevel: profile?.warningLevel ?? null,
          criticalLevel: profile?.criticalLevel ?? null,
          dataState: online ? dataState(source, flow.lastReadingAt) : flow.lastReadingAt ? (source === 'simulated' ? 'simulated' : 'stored') : 'no_data',
        },
        vibration: vib && {
          sensorId: vib.id,
          location: vib.sensorLocation,
          level: online ? vib.lastVibrationLevel ?? null : null,
          limit,
          baselineConfigured: Boolean(baseline),
          abnormal: online && limit != null && vib.lastVibrationLevel != null && vib.lastVibrationLevel > limit,
          lastReadingAt: vib.lastReadingAt ?? null,
        },
        valve: valve && {
          id: valve.id,
          status: valve.status,
          commandStatus: valve.commandStatus,
          requestedState: valve.requestedState ?? null,
          requestedAt: valve.requestedAt ?? null,
          acknowledgedAt: valve.acknowledgedAt ?? null,
          positionConfirmed: Boolean(valve.positionConfirmed),
          controlType: valve.controlType,
        },
      };
    }),
  );
}

// Minutes of uninterrupted flow up to the latest reading (a common leak sign).
export function continuousFlowMinutes(flowReadings, minFlow) {
  const sorted = [...flowReadings].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  if (!sorted.length || (sorted[0].flowRate ?? 0) < minFlow) return 0;
  let earliest = sorted[0].recordedAt;
  for (const r of sorted) {
    if ((r.flowRate ?? 0) < minFlow) break;
    earliest = r.recordedAt;
  }
  return Math.round((Date.parse(sorted[0].recordedAt) - Date.parse(earliest)) / 60000);
}

export async function usageSummary(scope) {
  const today = startOfDay();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const from = addDays(today, -28) < monthStart ? addDays(today, -28) : monthStart;
  const rows = (await db.list(C.waterUsage, { where: [['date', '>=', dayKey(from)]] })).filter((r) => scope.ownsHouse(r.houseId));

  const todayKey = dayKey(today);
  const todayLiters = rows.filter((r) => r.date === todayKey).reduce((s, r) => s + r.litersUsed, 0);
  const monthLiters = rows.filter((r) => r.date >= dayKey(monthStart)).reduce((s, r) => s + r.litersUsed, 0);
  const pastDays = new Map();
  for (const r of rows) if (r.date < todayKey && r.date >= dayKey(addDays(today, -28))) pastDays.set(r.date, (pastDays.get(r.date) || 0) + r.litersUsed);
  const typicalDailyLiters = pastDays.size ? [...pastDays.values()].reduce((s, v) => s + v, 0) / pastDays.size : null;
  const dayFraction = (Date.now() - today.getTime()) / 86400000;

  return {
    unit: 'L',
    todayLiters,
    monthLiters,
    typicalDailyLiters,
    expectedByNowLiters: typicalDailyLiters != null ? typicalDailyLiters * dayFraction : null,
    daysOfHistory: pastDays.size,
    sources: [...new Set(rows.map((r) => r.source))],
  };
}

// Overall status shown on the homeowner's home screen.
export function systemStatus({ devices, openAlerts }) {
  if (!devices.length) return { status: 'no_device', reasons: ['No SeeWater device linked yet'] };
  const reasons = [];
  let status = 'normal';
  const rank = { normal: 0, water_off: 1, high_flow: 2, offline: 3, possible_leak: 4, critical: 5 };
  const raise = (s, reason) => {
    if (rank[s] > rank[status]) status = s;
    reasons.push(reason);
  };
  for (const a of openAlerts) {
    if (a.alertType === 'possible_leak') raise(a.severityLevel === 'critical' ? 'critical' : 'possible_leak', 'Possible leak detected');
    if (a.alertType === 'high_flow') raise(a.severityLevel === 'critical' ? 'critical' : 'high_flow', 'Unusually high water flow');
  }
  for (const d of devices) {
    if (d.connectionStatus === 'offline') raise('offline', `${d.deviceName} is offline`);
    if (d.connectionStatus === 'never_connected' || d.connectionStatus === 'not_activated') raise('offline', `${d.deviceName} has not connected yet`);
    if (d.flow?.status === 'critical') raise('critical', 'Flow above the critical level');
    else if (d.flow?.status === 'high') raise('high_flow', 'Flow above the warning level');
    if (d.valve?.status === 'closed') raise('water_off', 'Water valve is closed');
  }
  return { status, reasons: [...new Set(reasons)] };
}

export async function homeOverview(user, scope) {
  const settings = await getSettings();
  const [devices, usage, alerts, notifications, interruptions] = await Promise.all([
    deviceSnapshots(scope, settings),
    usageSummary(scope),
    db.list(C.alerts, { where: [['alertStatus', 'in', ['open', 'acknowledged']]] }),
    db.list(C.notifications, { where: [['userId', '==', user.id]] }),
    interruptionsForUser(user, scope),
  ]);
  const openAlerts = alerts.filter((a) => scope.ownsHouse(a.houseId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const since = new Date(Date.now() - 3 * 3600000).toISOString();
  const recentFlow = scope.devices.length
    ? (await db.list(C.sensorReadings, { where: [['recordedAt', '>=', since]] })).filter((r) => scope.ownsDevice(r.deviceId) && r.readingType === 'flow')
    : [];
  const online = devices.filter((d) => d.connectionStatus === 'online');
  const flowValues = online.map((d) => d.flow?.flowRate).filter((v) => v != null);

  return {
    hasDevice: devices.length > 0,
    systemStatus: systemStatus({ devices, openAlerts }),
    current: {
      flowRate: flowValues.length ? flowValues.reduce((s, v) => s + v, 0) : null,
      unit: 'L/min',
      dataState: online.length ? online[0].flow?.dataState ?? 'no_data' : devices.length ? 'offline' : 'no_data',
      lastReadingAt: devices.map((d) => d.flow?.lastReadingAt).filter(Boolean).sort().at(-1) ?? null,
      continuousFlowMinutes: online.length ? continuousFlowMinutes(recentFlow.filter((r) => online.some((d) => d.id === r.deviceId)), settings.leakMinFlowLpm) : null,
    },
    usage: { ...usage, dailyLimitLiters: user.dailyUsageLimitLiters ?? null },
    devices,
    interruptions: interruptions.filter((i) => i.status === 'ongoing' || i.status === 'scheduled'),
    activeAlerts: openAlerts.filter((a) => a.alertType !== 'device_offline').slice(0, 5),
    recentNotifications: notifications.sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 4),
    unreadCount: notifications.filter((n) => !n.isRead).length,
    autoShutoffEnabled: settings.autoShutoffOnCriticalLeak,
  };
}
