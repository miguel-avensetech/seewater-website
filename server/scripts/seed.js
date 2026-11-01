// Loads SAMPLE data so the dashboard can be explored before hardware is deployed.
//
// Everything written here is marked `isSample: true`, and every reading, alert
// and log is marked `source: "simulated"` so the UI labels it as simulated.
// Sample devices are flagged `isSimulated: true`; their credentials are written
// to data/simulator-devices.json for `npm run simulate`.
//
//   npm run seed                  add sample data (refuses if sample data exists)
//   npm run seed -- --reset       local driver only: wipe the local DB first
//   npm run seed -- --remove      delete all sample data (keeps real records)

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../src/config.js';
import { initDb, db, C } from '../src/db/index.js';
import { hashKey } from '../src/middleware/deviceAuth.js';
import { issueActivationCode } from '../src/services/activationCodes.js';
import { addDays, dayKey, startOfDay } from '../src/lib/time.js';

const { values: args } = parseArgs({ options: { reset: { type: 'boolean' }, remove: { type: 'boolean' } } });
const driver = initDb();
const SIM_FILE = path.resolve('data/simulator-devices.json');

// Deterministic pseudo-random generator so sample data is reproducible.
let s = 20260731;
const rand = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round1 = (v) => Math.round(v * 10) / 10;

async function removeSample() {
  let removed = 0;
  for (const name of Object.values(C)) {
    const docs = await db.list(name, { where: [['isSample', '==', true]] });
    for (const d of docs) {
      await db.remove(name, d.id);
      removed++;
    }
  }
  if (fs.existsSync(SIM_FILE)) fs.rmSync(SIM_FILE);
  console.log(`Removed ${removed} sample documents.`);
}

if (args.remove) {
  await removeSample();
  await driver.close?.();
  process.exit(0);
}

if (args.reset) {
  // Never wipe a real Firebase project: reset only the local store or the emulator.
  if (driver.name !== 'local' && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('--reset is only available for DB_DRIVER=local or the Firestore emulator. Use --remove to delete sample data from a real project.');
    process.exit(1);
  }
  // Admin accounts survive the reset so you stay able to sign in.
  const admins = await db.list(C.admins);
  await driver.reset();
  for (const { id, ...a } of admins) await db.set(C.admins, id, a);
}

const existingSample = await db.list(C.users, { where: [['isSample', '==', true]], limit: 1 });
if (existingSample.length) {
  console.error('Sample data already exists. Run with --remove first (or --reset for the local driver / emulator).');
  process.exit(1);
}

const now = new Date();
const iso = (d) => new Date(d).toISOString();
const minutesAgo = (m) => iso(now.getTime() - m * 60000);
const daysAgo = (d) => iso(now.getTime() - d * 86400000);
const S = { isSample: true };
const create = (col, doc, id) => db.create(col, { ...doc, ...S }, id);

// Bulk inserts are queued and written in parallel chunks (thousands of documents).
const pending = [];
async function queue(promise) {
  pending.push(promise);
  if (pending.length >= 200) await flush();
}
async function flush() {
  await Promise.all(pending.splice(0));
}
const READING_TTL_MS = config.readingRetentionDays * 86400000;

const [anyAdmin] = await db.list(C.admins, { limit: 1 });
const adminId = anyAdmin?.id ?? null;

console.log(`Seeding sample data into ${driver.name}…`);

// ── Homeowners and households (Metro Cebu, MCWD service area) ────────────────
const people = [
  ['Maria Santos', 'maria.santos@example.com', '+63 917 555 0101', 'Lot 12 Blk 4, Banilad, Cebu City', 'MCWD-100231'],
  ['Jose Ramirez', 'jose.ramirez@example.com', '+63 917 555 0102', '45 Gorordo Ave, Lahug, Cebu City', 'MCWD-100245'],
  ['Ana Villanueva', 'ana.villanueva@example.com', '+63 917 555 0103', '8 Mango Ave, Kamputhaw, Cebu City', 'MCWD-100298'],
  ['Carlo Mendoza', 'carlo.mendoza@example.com', '+63 917 555 0104', '21 A.S. Fortuna St, Mandaue City', 'MCWD-100312'],
  ['Liza Fernandez', 'liza.fernandez@example.com', '+63 917 555 0105', '3 Tisa Rd, Labangon, Cebu City', 'MCWD-100357'],
  ['Ramon Cruz', 'ramon.cruz@example.com', '+63 917 555 0106', '77 M.L. Quezon Hwy, Lapu-Lapu City', 'MCWD-100401'],
  ['Grace Tan', 'grace.tan@example.com', '+63 917 555 0107', '15 Talamban Rd, Talamban, Cebu City', 'MCWD-100433'],
];

const DEMO_HOMEOWNER_PASSWORD = 'SeeWater2026!';
const users = [];
const houses = [];
for (const [i, [fullName, email, phone, address, accountNumber]] of people.entries()) {
  // Maria Santos doubles as the demo homeowner for the mobile app.
  const app = i === 0 ? { passwordHash: await bcrypt.hash(DEMO_HOMEOWNER_PASSWORD, 10), emailVerified: true, emailVerifiedAt: daysAgo(300), tokenVersion: 0, expoPushTokens: [] } : {};
  const u = await create(C.users, { fullName, email, phone, address, accountNumber, status: i === 6 ? 'inactive' : 'active', createdAt: daysAgo(380 - i * 30), createdBy: adminId, ...app });
  users.push(u);
  if (i < 6) {
    houses.push(
      await create(C.houses, {
        userId: u.id,
        houseName: `${fullName.split(' ')[1]} Residence`,
        address,
        installationDate: dayKey(daysAgo(370 - i * 30)),
        houseStatus: i === 5 ? 'pending_installation' : 'monitored',
        createdAt: daysAgo(375 - i * 30),
      }),
    );
  }
}

// ── Devices, sensors, valves ─────────────────────────────────────────────────
// Environments reflect the manuscript: homes near highways need higher thresholds.
const envs = ['quiet', 'high_traffic', 'moderate', 'high_traffic', 'quiet'];
const simulator = [];
const sim = [];

for (let i = 0; i < 5; i++) {
  const house = houses[i];
  const deviceKey = crypto.randomBytes(32).toString('base64url');
  const online = i !== 3; // one device offline for realism
  const device = await create(C.devices, {
    deviceName: `SW-GW-${String(i + 1).padStart(3, '0')}`,
    deviceType: 'esp32_gateway',
    macAddress: `24:6F:28:A1:0${i}:${(16 + i * 7).toString(16).toUpperCase().padStart(2, '0')}`,
    firmwareVersion: i === 2 ? '1.1.0' : '1.2.0',
    houseId: house.id,
    notes: 'Sample device for demonstration',
    activationStatus: 'activated',
    activatedAt: daysAgo(365 - i * 30),
    connectionStatus: online ? 'online' : 'offline',
    lastOnline: online ? minutesAgo(1) : minutesAgo(190),
    signalStrength: Math.round(between(-78, -52)),
    isSimulated: true,
    deviceKeyHash: hashKey(deviceKey),
    ...(i === 0 && { linkedUserId: users[0].id, linkedAt: daysAgo(300) }),
    registeredBy: adminId,
    registeredAt: daysAgo(366 - i * 30),
  });
  // Sample codes: already used by the (simulated) hardware; SW-GW-001 also linked by Maria.
  const code = await issueActivationCode(device.id, { id: adminId }, { code: `SW-DEMO-000${i + 1}`, expiresInDays: 365 });
  await db.update(C.activationCodes, code.code, { isSample: true, hardwareActivatedAt: daysAgo(365 - i * 30), activatedAt: daysAgo(365 - i * 30), ...(i === 0 && { homeownerLinkedAt: daysAgo(300), activatedBy: users[0].id, status: 'used' }) });
  const flow = await create(C.sensors, {
    deviceId: device.id, houseId: house.id, sensorType: 'flow', sensorLocation: 'Main line', model: 'YF-S201',
    status: 'active', sensitivity: 1, calibrationFactor: 7.5, calibrationStatus: 'calibrated',
    installedAt: daysAgo(365 - i * 30), lastCalibratedAt: i === 4 ? daysAgo(200) : daysAgo(40 + i * 5),
  });
  const vib = await create(C.sensors, {
    deviceId: device.id, houseId: house.id, sensorType: 'vibration', sensorLocation: i % 2 ? 'Kitchen line' : 'CR line', model: 'SW-420 / piezo film',
    status: 'active', sensitivity: envs[i] === 'high_traffic' ? 0.8 : 1, calibrationFactor: 1, calibrationStatus: i === 2 ? 'not_calibrated' : 'calibrated',
    installedAt: daysAgo(365 - i * 30), ...(i !== 2 && { lastCalibratedAt: daysAgo(35 + i * 4) }),
  });
  const valve = await create(C.valves, { deviceId: device.id, houseId: house.id, status: 'open', commandStatus: 'none', controlType: 'manual', lastUpdated: daysAgo(10) });

  await create(C.thresholdProfiles, { sensorId: flow.id, minValue: 0, maxValue: 30, warningLevel: 15, criticalLevel: 25, createdAt: daysAgo(60), updatedAt: daysAgo(40) }, flow.id);
  const base = envs[i] === 'high_traffic' ? 210 : envs[i] === 'moderate' ? 140 : 90;
  if (i !== 2) {
    const range = envs[i] === 'high_traffic' ? 60 : 35;
    await create(C.vibrationBaselines, { sensorId: vib.id, deviceId: device.id, baselineValue: base, acceptableRange: range, detectionThreshold: null, environment: envs[i], recordedBy: adminId, createdAt: daysAgo(120), updatedAt: daysAgo(35) }, vib.id);
    await create(C.vibrationBaselineHistory, { sensorId: vib.id, deviceId: device.id, previous: null, baselineValue: base - 12, acceptableRange: range, detectionThreshold: null, environment: envs[i], measurement: { samples: 72, windowMinutes: 60, mean: base - 12, stdDev: 9.8, max: base + 20 }, remarks: 'Initial baseline at installation', recordedBy: adminId, createdAt: daysAgo(120) });
    await create(C.vibrationBaselineHistory, { sensorId: vib.id, deviceId: device.id, previous: { baselineValue: base - 12, acceptableRange: range, detectionThreshold: null }, baselineValue: base, acceptableRange: range, detectionThreshold: null, environment: envs[i], measurement: { samples: 84, windowMinutes: 60, mean: base, stdDev: 11.2, max: base + 28 }, remarks: 'Re-measured after complaints of false alerts', recordedBy: adminId, createdAt: daysAgo(35) });
  }
  for (const [type, oldValue, newValue, d] of [['calibrationFactor', 7.5, 7.3, 120], ['warningLevel', 18, 15, 40], ['calibrationFactor', 7.3, 7.5, 40 + i * 5]]) {
    await create(C.calibrations, { sensorId: flow.id, deviceId: device.id, calibrationType: type, oldValue, newValue, performedBy: adminId, calibrationDate: daysAgo(d), remarks: 'Bucket test against 10 L reference' });
  }

  sim.push({ device, flow, vib, valve, house, base, online });
  simulator.push({ deviceId: device.id, deviceKey, deviceName: device.deviceName, flowSensorId: flow.id, vibrationSensorId: vib.id, valveId: valve.id, baseline: base });
}

// A real (non-simulated) registration awaiting activation — no readings.
{
  const pendingDevice = await create(C.devices, {
    deviceName: 'SW-GW-006', deviceType: 'esp32_gateway', macAddress: '', firmwareVersion: '1.2.0', houseId: houses[5].id,
    notes: 'Awaiting installation', activationStatus: 'pending', connectionStatus: 'not_activated',
    lastOnline: null, isSimulated: false, registeredBy: adminId, registeredAt: daysAgo(3),
  });
  const code = await issueActivationCode(pendingDevice.id, { id: adminId }, { code: 'SW-K7PQ-M4XZ' });
  await db.update(C.activationCodes, code.code, { isSample: true });
}

// ── Daily water usage summaries (400 days) ───────────────────────────────────
console.log('  water usage summaries…');
const today = startOfDay(now);
for (const { house, flow } of sim) {
  const baseDaily = between(380, 720);
  for (let d = 400; d >= 0; d--) {
    const date = addDays(today, -d);
    const weekend = [0, 6].includes(date.getDay()) ? 1.15 : 1;
    const season = 1 + 0.12 * Math.sin(((date.getMonth() + 1) / 12) * 2 * Math.PI);
    let liters = baseDaily * weekend * season * between(0.82, 1.18);
    if (d === 0) liters *= (now.getHours() * 60 + now.getMinutes()) / 1440; // partial day
    const readings = d === 0 ? Math.max(1, Math.floor((now.getHours() * 60 + now.getMinutes()) / 10)) : 144;
    const avg = between(2.2, 4.5);
    await queue(create(
      C.waterUsage,
      { houseId: house.id, sensorId: flow.id, date: dayKey(date), litersUsed: round1(liters), peakFlowRate: round1(between(9, 21)), flowRateSum: round1(avg * readings), readingsCount: readings, source: 'simulated', recordedAt: iso(date) },
      `${house.id}_${dayKey(date)}_simulated`,
    ));
  }
}

// ── Last 24 h of sensor readings (every 10 minutes) ──────────────────────────
console.log('  sensor readings…');
for (const { device, flow, vib, house, base, online } of sim) {
  const end = online ? now.getTime() : now.getTime() - 190 * 60000;
  for (let t = end - 24 * 3600000; t <= end; t += 10 * 60000) {
    const hour = new Date(t).getHours();
    const active = (hour >= 5 && hour <= 8) || (hour >= 11 && hour <= 13) || (hour >= 18 && hour <= 21);
    const flowRate = active && rand() > 0.35 ? round1(between(2, 12)) : rand() > 0.9 ? round1(between(0.5, 3)) : 0;
    const vibration = Math.round(base + between(-25, 25) + (flowRate > 0 ? between(5, 30) : 0));
    await queue(create(C.sensorReadings, { sensorId: flow.id, deviceId: device.id, houseId: house.id, readingType: 'flow', flowRate, vibrationLevel: null, waterUsage: round1(flowRate * 10 * between(0.3, 0.7)), recordedAt: iso(t), source: 'simulated', expireAt: new Date(t + READING_TTL_MS) }));
    await queue(create(C.sensorReadings, { sensorId: vib.id, deviceId: device.id, houseId: house.id, readingType: 'vibration', flowRate: null, vibrationLevel: vibration, waterUsage: null, recordedAt: iso(t + 1000), source: 'simulated', expireAt: new Date(t + 1000 + READING_TTL_MS) }));
  }
  await flush();
  const lastFlow = online ? round1(between(0, 6)) : 0;
  await db.update(C.sensors, flow.id, { lastFlowRate: lastFlow, lastReadingAt: iso(end) });
  await db.update(C.sensors, vib.id, { lastVibrationLevel: Math.round(base + between(-15, 15)), lastReadingAt: iso(end + 1000) });
  for (let k = 0; k < 12; k++) {
    await queue(create(C.deviceStatusHistory, { deviceId: device.id, status: 'online', signalStrength: Math.round(between(-80, -50)), batteryLevel: null, recordedAt: iso(end - k * 2 * 3600000) }));
  }
}

// One house currently shows high flow and an open leak alert (for the demo).
await db.update(C.sensors, sim[1].flow.id, { lastFlowRate: 17.4, lastReadingAt: minutesAgo(1) });
await db.update(C.sensors, sim[1].vib.id, { lastVibrationLevel: 318, lastReadingAt: minutesAgo(1) });

// ── Alerts ───────────────────────────────────────────────────────────────────
console.log('  alerts and logs…');
const alertSpecs = [
  [1, 'possible_leak', 'critical', 'open', 6, 'Abnormal pipe vibration (318 vs limit 270) with continuous flow of 17.4 L/min near Kitchen line.'],
  [1, 'high_flow', 'warning', 'acknowledged', 9, 'Flow of 17.4 L/min at Main line exceeds the warning level (15 L/min).'],
  [3, 'device_offline', 'warning', 'open', 180, 'SW-GW-004 has not reported for over 5 minutes.'],
  [0, 'high_flow', 'warning', 'resolved', 60 * 26, 'Flow of 16.2 L/min at Main line exceeds the warning level (15 L/min).'],
  [4, 'possible_leak', 'warning', 'resolved', 60 * 24 * 4, 'Abnormal pipe vibration (141 vs limit 125) with continuous flow of 0.8 L/min near CR line.'],
  [2, 'high_flow', 'critical', 'resolved', 60 * 24 * 9, 'Flow of 26.1 L/min at Main line exceeds the critical level (25 L/min).'],
  [0, 'possible_leak', 'warning', 'resolved', 60 * 24 * 15, 'Abnormal pipe vibration (139 vs limit 125) with continuous flow of 0.6 L/min near CR line.'],
];
const metricsFor = (alertType, i) =>
  alertType === 'possible_leak'
    ? { vibrationLevel: i === 1 ? 318 : 140, vibrationLimit: i === 1 ? 270 : 125, baselineValue: i === 1 ? 210 : 90, flowRate: i === 1 ? 17.4 : 0.7, leakMinFlowRate: 0.3 }
    : alertType === 'high_flow'
      ? { flowRate: i === 2 ? 26.1 : 16.8, expectedMaxFlowRate: i === 2 ? 25 : 15, warningLevel: 15, criticalLevel: 25 }
      : null;
for (const [i, alertType, severityLevel, alertStatus, mins, description] of alertSpecs) {
  const { device, flow, vib, house } = sim[i];
  await create(C.alerts, {
    sensorId: alertType === 'possible_leak' ? vib.id : alertType === 'high_flow' ? flow.id : null,
    deviceId: device.id, houseId: house.id, alertType,
    possibleLeakArea: alertType === 'possible_leak' ? vib.sensorLocation : null,
    severityLevel, description, alertStatus, metrics: metricsFor(alertType, i), source: 'simulated', createdAt: minutesAgo(mins),
    ...(alertStatus === 'resolved' && { resolvedAt: minutesAgo(mins - 45), resolvedBy: adminId, resolutionNote: 'Homeowner confirmed; checked on site.' }),
    ...(alertStatus === 'acknowledged' && { acknowledgedAt: minutesAgo(mins - 2), acknowledgedBy: adminId }),
  });
}

// ── Demo homeowner inbox and valve history ──────────────────────────────────
{
  const { device, valve, house } = sim[0];
  const notes = [
    ['possible_leak', 'Possible leak detected', 'Abnormal pipe vibration (139 vs limit 125) with continuous flow of 0.6 L/min near CR line.', 60 * 24 * 15, true],
    ['high_flow', 'High water flow detected', 'Flow of 16.2 L/min at Main line exceeds the warning level (15 L/min).', 60 * 26, true],
    ['valve', 'Water valve opened', 'Your SeeWater device reported the valve as open. The physical valve position is not independently verified.', 60 * 24 * 10, true],
    ['feedback_response', 'Reply to your complaint: Leak alert but no visible leak', 'Thanks for reporting this. A technician will check your vibration sensor this week.', 60 * 3, false],
  ];
  for (const [notificationType, title, message, mins, isRead] of notes) {
    await create(C.notifications, { userId: users[0].id, alertId: null, title, message, notificationType, data: {}, isRead, sentAt: minutesAgo(mins) });
  }
  for (const [action, mins] of [['close', 60 * 24 * 10 + 30], ['open', 60 * 24 * 10]]) {
    await create(C.valveCommands, {
      valveId: valve.id, deviceId: device.id, houseId: house.id, action, requestedState: action === 'close' ? 'closed' : 'open', emergency: false,
      reason: action === 'close' ? 'Manual control from mobile app' : 'Water restored after repair', requestedByType: 'homeowner', requestedById: users[0].id,
      requestedByName: users[0].fullName, status: 'acknowledged', requestedAt: minutesAgo(mins), respondedAt: minutesAgo(mins - 1), positionConfirmed: false,
    });
  }
}

// ── Device and system logs ───────────────────────────────────────────────────
const deviceEvents = [
  ['connected', 'Device connected', 'success'],
  ['flow_reading', 'Flow sensor reporting normally', 'info'],
  ['vibration_ignored', 'Vibration above limit with no water flow — treated as environmental noise.', 'info'],
  ['valve_confirmed', 'Device confirmed valve is open.', 'success'],
  ['firmware_updated', 'Firmware 1.1.0 → 1.2.0', 'success'],
  ['disconnected', 'Device stopped reporting', 'warning'],
  ['sensor_calibrated', 'flow sensor at Main line: calibrationFactor 7.3 → 7.5', 'success'],
  ['restart', 'Device restarted after power interruption', 'warning'],
];
for (let k = 0; k < 60; k++) {
  const { device } = pick(sim);
  const [eventType, description, status] = pick(deviceEvents);
  await queue(create(C.deviceLogs, { deviceId: device.id, eventType, description, status, source: 'simulated', loggedAt: minutesAgo(Math.floor(between(5, 60 * 24 * 20))) }));
}

const systemEvents = [
  ['high_flow', 'high_flow_detected', 'High flow detected at Ramirez Residence (17.4 L/min)', 'warning'],
  ['possible_leak', 'possible_leak_detected', 'Possible leak near Kitchen line at Ramirez Residence', 'critical'],
  ['sensor_event', 'sensor_calibrated', 'Calibrated flow sensor at Main line', 'success'],
  ['connectivity', 'device_offline', 'SW-GW-004 went offline', 'warning'],
  ['connectivity', 'device_online', 'SW-GW-001 is online', 'success'],
  ['valve_operation', 'valve_confirmed', 'SW-GW-005: Device confirmed valve is open.', 'success'],
  ['system_update', 'firmware_updated', 'SW-GW-002 updated to firmware 1.2.0', 'success'],
];
for (let k = 0; k < 45; k++) {
  const [category, action, description, status] = pick(systemEvents);
  const { device, house } = pick(sim);
  await queue(create(C.systemLogs, { category, action, description, status, actorId: null, actorName: null, deviceId: device.id, houseId: house.id, source: 'simulated', createdAt: minutesAgo(Math.floor(between(3, 60 * 24 * 14))) }));
}

// ── Announcements ────────────────────────────────────────────────────────────
console.log('  announcements and feedback…');
const inDays = (d, h = 9) => {
  const x = addDays(startOfDay(now), d);
  x.setHours(h);
  return iso(x);
};
const announcements = [
  { title: 'Scheduled water interruption — Banilad and Talamban', category: 'service_advisory', priority: 'high', status: 'published', publishedAt: daysAgo(1), audience: 'specific_area', audienceArea: 'Banilad, Talamban', interruption: { start: inDays(2, 22), end: inDays(3, 4), area: 'Banilad, Talamban' }, message: 'Water service will be interrupted from 10:00 PM to 4:00 AM for main-line repairs. Please store enough water beforehand.' },
  { title: 'Fix dripping faucets to save up to 20 liters a day', category: 'conservation_reminder', priority: 'low', status: 'published', publishedAt: daysAgo(8), audience: 'all_users', audienceArea: '', interruption: null, message: 'A faucet dripping once per second wastes about 20 liters daily. Check your faucets and toilets regularly.' },
  { title: 'How to read your SeeWater usage insights', category: 'customer_tip', priority: 'normal', status: 'scheduled', publishAt: inDays(1, 8), publishedAt: null, audience: 'all_users', audienceArea: '', interruption: null, message: 'The Insights tab shows your daily, weekly and monthly consumption. Compare weeks to spot unusual increases early.' },
  { title: 'Draft: dry-season conservation campaign', category: 'conservation_reminder', priority: 'normal', status: 'draft', publishedAt: null, audience: 'all_users', audienceArea: '', interruption: null, message: 'During the dry season, please limit garden watering to early morning or evening to reduce evaporation.' },
];
for (const [k, a] of announcements.entries()) {
  await create(C.announcements, { attachmentUrl: '', publishAt: null, ...a, adminId, createdAt: daysAgo(10 - k), updatedAt: daysAgo(10 - k) });
}

// ── Feedback ─────────────────────────────────────────────────────────────────
const feedback = [
  [0, 'complaint', 'Leak alert but no visible leak', 'I received a possible leak alert last night but could not find any leak. Can someone check the sensor?', 'new', 0.3],
  [1, 'report', 'Low water pressure in the morning', 'Water pressure has been very low between 6 and 8 AM for the past week.', 'in_review', 2],
  [2, 'suggestion', 'Weekly usage email', 'It would be helpful to receive a weekly summary of our water usage by email.', 'new', 3],
  [3, 'report', 'Device light is blinking red', 'The SeeWater device near our meter has been blinking red since yesterday.', 'new', 1],
  [4, 'complaint', 'Bill higher than app usage', 'My bill seems higher than what the app shows for the month.', 'resolved', 9],
];
for (const [i, type, subject, message, status, d] of feedback) {
  await create(C.feedback, {
    userId: users[i].id, type, subject, message, status, source: 'simulated', createdAt: daysAgo(d),
    ...(status === 'resolved' && { response: 'We reviewed your account: the bill includes the previous month’s unpaid balance. Your metered usage matches the app.', respondedAt: daysAgo(d - 1), respondedBy: adminId, respondedByName: anyAdmin?.fullName ?? 'Administrator' }),
  });
}

await flush();
fs.mkdirSync(path.dirname(SIM_FILE), { recursive: true });
fs.writeFileSync(SIM_FILE, JSON.stringify({ apiUrl: `http://localhost:${config.port}`, devices: simulator }, null, 2));

await driver.close?.();
console.log(`Done. Simulator credentials written to ${path.relative(process.cwd(), SIM_FILE)} (keep this file private).`);
if (!adminId) console.log('Note: no admin exists yet — run `npm run create-admin` to create one.');
console.log(`Demo homeowner (mobile app): ${people[0][1]} / ${DEMO_HOMEOWNER_PASSWORD}`);
process.exit(0); // firebase-admin keeps sockets open
