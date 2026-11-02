import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { badRequest } from '../lib/errors.js';
import { dayKey, nowIso } from '../lib/time.js';
import { logDevice, logSystem } from './activity.js';
import { getSettings } from './settings.js';
import { classifyFlow, getThresholdProfile, getVibrationBaseline, vibrationLimit } from './thresholds.js';
import { requestValveCommand } from './valves.js';
import { notifyUser } from './notify.js';
import { checkDailyUsageLimit } from './usageLimit.js';
import { completeFirmwareFromHeartbeat } from './firmware.js';

// Readings are classified by origin on the server — never trusted from the payload.
const sourceOf = (device) => (device.isSimulated ? 'simulated' : 'device');

export async function recordHeartbeat(device, { firmwareVersion, signalStrength, batteryLevel, configVersion }) {
  const wasOnline = device.connectionStatus === 'online';
  const source = sourceOf(device);
  const patch = {
    lastOnline: nowIso(),
    connectionStatus: 'online',
    ...(firmwareVersion && { firmwareVersion }),
    ...(signalStrength != null && { signalStrength }),
    ...(batteryLevel != null && { batteryLevel }),
    ...(configVersion && { appliedConfigVersion: configVersion, configAppliedAt: nowIso() }),
  };
  await db.update(C.devices, device.id, patch);
  await db.create(C.deviceStatusHistory, {
    deviceId: device.id,
    status: 'online',
    signalStrength: signalStrength ?? null,
    batteryLevel: batteryLevel ?? null,
    recordedAt: patch.lastOnline,
  });

  if (firmwareVersion) await completeFirmwareFromHeartbeat(device, firmwareVersion);
  if (firmwareVersion && device.firmwareVersion && firmwareVersion !== device.firmwareVersion) {
    await logDevice({ deviceId: device.id, eventType: 'firmware_updated', description: `Firmware ${device.firmwareVersion} → ${firmwareVersion}`, status: 'success', source });
    await logSystem({ category: 'system_update', action: 'firmware_updated', description: `${device.deviceName} updated to firmware ${firmwareVersion}`, status: 'success', deviceId: device.id, houseId: device.houseId, source });
  }
  if (!wasOnline) {
    await logDevice({ deviceId: device.id, eventType: 'connected', description: `${device.deviceName} connected`, status: 'success', source });
    await logSystem({ category: 'connectivity', action: 'device_online', description: `${device.deviceName} is online`, status: 'success', deviceId: device.id, houseId: device.houseId, source });
    // A reconnect clears the device's outstanding offline alerts.
    const offline = await db.list(C.alerts, { where: [['deviceId', '==', device.id]] });
    for (const a of offline) {
      if (a.alertType === 'device_offline' && a.alertStatus !== 'resolved') {
        await db.update(C.alerts, a.id, { alertStatus: 'resolved', resolvedAt: patch.lastOnline, resolvedBy: null, resolutionNote: 'Device reconnected' });
      }
    }
  }
}

async function addToDailyUsage({ houseId, sensorId, liters, flowRate, at, source }) {
  const id = `${houseId}_${dayKey(at)}_${source}`;
  const existing = await db.get(C.waterUsage, id);
  if (existing) {
    await db.update(C.waterUsage, id, {
      litersUsed: existing.litersUsed + liters,
      peakFlowRate: Math.max(existing.peakFlowRate, flowRate ?? 0),
      flowRateSum: existing.flowRateSum + (flowRate ?? 0),
      readingsCount: existing.readingsCount + 1,
      recordedAt: at,
    });
  } else {
    await db.create(
      C.waterUsage,
      { houseId, sensorId, date: dayKey(at), litersUsed: liters, peakFlowRate: flowRate ?? 0, flowRateSum: flowRate ?? 0, readingsCount: 1, source, recordedAt: at },
      id,
    );
  }
}

async function hasRecentOpenAlert({ sensorId, alertType, cooldownMinutes }) {
  const since = new Date(Date.now() - cooldownMinutes * 60000).toISOString();
  const open = await db.list(C.alerts, { where: [['sensorId', '==', sensorId]] });
  return open.some((a) => a.alertType === alertType && a.alertStatus !== 'resolved' && a.createdAt >= since);
}

async function raiseAlert({ sensor, device, alertType, severityLevel, description, possibleLeakArea = null, category, metrics = null }) {
  const source = sourceOf(device);
  const alert = await db.create(C.alerts, {
    sensorId: sensor.id,
    deviceId: device.id,
    houseId: device.houseId,
    alertType,
    possibleLeakArea,
    severityLevel,
    description,
    alertStatus: 'open',
    metrics,
    source,
    createdAt: nowIso(),
  });
  await logSystem({ category, action: `${alertType}_detected`, description, status: severityLevel, deviceId: device.id, houseId: device.houseId, source });

  const house = device.houseId ? await db.get(C.houses, device.houseId) : null;
  if (house?.userId) {
    await notifyUser(house.userId, {
      alertId: alert.id,
      title: alertType === 'possible_leak' ? 'Possible leak detected' : 'High water flow detected',
      message: description,
      notificationType: alertType,
    });
  }
  return alert;
}

/**
 * Stores a batch of readings from one device and evaluates them against the
 * sensor's threshold profile and vibration baseline.
 *
 * Leak rule (manuscript ch. 2–3): a possible leak requires BOTH vibration above
 * the baseline limit AND continuous water flow. Vibration without flow is
 * treated as environmental noise and only logged as a sensor event.
 */
export async function ingestReadings(device, readings) {
  if (!device.houseId) throw badRequest('Device is not assigned to a household yet.');
  const settings = await getSettings();
  const source = sourceOf(device);
  const sensors = await db.list(C.sensors, { where: [['deviceId', '==', device.id]] });
  const byId = new Map(sensors.map((s) => [s.id, s]));

  const unknown = readings.filter((r) => !byId.has(r.sensorId));
  if (unknown.length) throw badRequest(`Unknown sensor for this device: ${unknown[0].sensorId}`);

  // Flow measured in this batch, used to corroborate vibration readings.
  let batchFlow = null;
  for (const r of readings) {
    if (byId.get(r.sensorId).sensorType === 'flow' && r.flowRate != null) batchFlow = Math.max(batchFlow ?? 0, r.flowRate);
  }
  const flowSensor = sensors.find((s) => s.sensorType === 'flow');
  const recentFlow =
    batchFlow ??
    (flowSensor?.lastReadingAt && Date.now() - Date.parse(flowSensor.lastReadingAt) < 2 * 60000 ? flowSensor.lastFlowRate : null);

  const stored = [];
  const alerts = [];

  for (const r of readings) {
    const sensor = byId.get(r.sensorId);
    const recordedAt = r.recordedAt ? new Date(r.recordedAt).toISOString() : nowIso();
    const { expireAt, ...doc } = await db.create(C.sensorReadings, {
      sensorId: sensor.id,
      deviceId: device.id,
      houseId: device.houseId,
      readingType: sensor.sensorType,
      flowRate: r.flowRate ?? null,
      vibrationLevel: r.vibrationLevel ?? null,
      waterUsage: r.waterUsage ?? null,
      recordedAt,
      source,
      // Raw readings expire via a Firestore TTL policy; daily totals live in waterUsage.
      expireAt: new Date(Date.parse(recordedAt) + config.readingRetentionDays * 86400000),
    });
    stored.push(doc);

    await db.update(C.sensors, sensor.id, {
      lastReadingAt: recordedAt,
      ...(r.flowRate != null && { lastFlowRate: r.flowRate }),
      ...(r.vibrationLevel != null && { lastVibrationLevel: r.vibrationLevel }),
    });

    if (sensor.sensorType === 'flow') {
      if (r.waterUsage != null) {
        await addToDailyUsage({ houseId: device.houseId, sensorId: sensor.id, liters: r.waterUsage, flowRate: r.flowRate, at: recordedAt, source });
        await checkDailyUsageLimit(device.houseId, recordedAt);
      }
      const profile = await getThresholdProfile(sensor, settings);
      const level = classifyFlow(r.flowRate, profile);
      if (settings.highFlowAlertsEnabled && (level === 'high' || level === 'critical')) {
        const cooldownMinutes = settings.alertCooldownMinutes;
        if (!(await hasRecentOpenAlert({ sensorId: sensor.id, alertType: 'high_flow', cooldownMinutes }))) {
          alerts.push(
            await raiseAlert({
              sensor,
              device,
              alertType: 'high_flow',
              severityLevel: level === 'critical' ? 'critical' : 'warning',
              description: `Flow of ${r.flowRate.toFixed(1)} L/min at ${sensor.sensorLocation} exceeds the ${level === 'critical' ? 'critical' : 'warning'} level (${level === 'critical' ? profile.criticalLevel : profile.warningLevel} L/min).`,
              category: 'high_flow',
              metrics: { flowRate: r.flowRate, expectedMaxFlowRate: level === 'critical' ? profile.criticalLevel : profile.warningLevel, warningLevel: profile.warningLevel, criticalLevel: profile.criticalLevel },
            }),
          );
        }
      }
    }

    if (sensor.sensorType === 'vibration' && r.vibrationLevel != null) {
      const baseline = await getVibrationBaseline(sensor.id);
      const limit = vibrationLimit(baseline);
      if (limit != null && r.vibrationLevel > limit) {
        const flowing = recentFlow != null && recentFlow >= settings.leakMinFlowLpm;
        if (!flowing) {
          await logDevice({ deviceId: device.id, eventType: 'vibration_ignored', description: `Vibration ${r.vibrationLevel} above limit ${limit} with no water flow — treated as environmental noise.`, status: 'info', source });
        } else if (settings.leakAlertsEnabled) {
          const cooldownMinutes = settings.alertCooldownMinutes;
          if (!(await hasRecentOpenAlert({ sensorId: sensor.id, alertType: 'possible_leak', cooldownMinutes }))) {
            const critical = r.vibrationLevel > limit * 1.5;
            const alert = await raiseAlert({
              sensor,
              device,
              alertType: 'possible_leak',
              severityLevel: critical ? 'critical' : 'warning',
              possibleLeakArea: sensor.sensorLocation,
              description: `Abnormal pipe vibration (${r.vibrationLevel} vs limit ${limit}) with continuous flow of ${recentFlow.toFixed(1)} L/min near ${sensor.sensorLocation}.`,
              category: 'possible_leak',
              metrics: { vibrationLevel: r.vibrationLevel, vibrationLimit: limit, baselineValue: baseline.baselineValue, flowRate: recentFlow, leakMinFlowRate: settings.leakMinFlowLpm },
            });
            alerts.push(alert);
            if (critical && settings.autoShutoffOnCriticalLeak) {
              const valve = (await db.list(C.valves, { where: [['deviceId', '==', device.id]] }))[0];
              if (valve && valve.commandStatus !== 'pending' && valve.status !== 'closed') {
                await requestValveCommand({ valveId: valve.id, action: 'close', reason: `Automatic shutoff: alert ${alert.id}`, actorType: 'automatic', emergency: true });
              }
            }
          }
        }
      }
    }
  }

  if (device.connectionStatus !== 'online') await recordHeartbeat(device, {});
  else await db.update(C.devices, device.id, { lastOnline: nowIso() });
  return { stored: stored.length, alerts: alerts.map((a) => a.id) };
}
