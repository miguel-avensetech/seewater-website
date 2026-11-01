import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { adminDatabase } from '../src/lib/firebaseAdmin.js';
import { flushLive } from '../src/services/live.js';
import { adminAgent, createAdmin, resetEmulators } from './helpers.js';

let app;
let admin;
const PASSWORD = 'CorrectHorse42';
const later = (h) => new Date(Date.now() + h * 3600000).toISOString();
const live = async (path) => {
  await new Promise((r) => setTimeout(r, 200));
  await flushLive();
  return (await adminDatabase().ref(path).get()).val();
};

before(async () => {
  app = await resetEmulators();
  await createAdmin({ email: 'admin@test.ph', password: PASSWORD });
  admin = await adminAgent(app, 'admin@test.ph', PASSWORD);
});

test('empty database: dashboard totals are zero and missing readings are null', async () => {
  const { body } = await admin.get('/api/dashboard/summary');
  for (const k of ['totalUsers', 'totalHouseholds', 'totalDevices', 'connectedDevices', 'offlineDevices', 'activeAlerts', 'criticalAlerts', 'waterInterruptions', 'publishedAnnouncements', 'totalFeedback']) {
    assert.equal(body.stats[k], 0, k);
  }
  assert.equal(body.consumption.today, 0);
  assert.equal(body.consumption.peakFlowToday, null);
  assert.equal(body.consumption.hasReadings, false);
  assert.equal(body.systemStatus.status, 'operational');

  const mon = await admin.get('/api/monitoring/overview');
  assert.equal(mon.body.totalFlowRate, null);
  assert.deepEqual(mon.body.houses, []);
  const usage = await admin.get('/api/usage?period=monthly');
  assert.equal(usage.body.totals.liters, 0);
  assert.equal(usage.body.totals.avgFlowRate, null);
  assert.equal(usage.body.totals.peakFlowRate, null);
  for (const path of ['/api/users', '/api/houses?page=1', '/api/devices', '/api/alerts', '/api/logs/devices', '/api/interruptions', '/api/rates', '/api/valve-commands', '/api/activation-codes', '/api/notifications', '/api/feedback', '/api/announcements', '/api/calibration/sensors', '/api/calibration/thresholds', '/api/firmware']) {
    const res = await admin.get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.body.total, 0, path);
  }
  // The only record is the admin's own sign-in.
  const logs = await admin.get('/api/logs/system');
  assert.deepEqual(logs.body.items.map((l) => l.action), ['admin_login']);
  assert.equal((await admin.get('/api/settings')).body.leakAlertsEnabled, true);
});

let user;
let house;
let device;
let creds;

test('device registration is mirrored to the Realtime Database with null readings', async () => {
  user = (await admin.post('/api/users').send({ fullName: 'Lea Dizon', email: 'lea@example.com', address: 'Banilad, Cebu City' })).body;
  house = (await admin.post('/api/houses').send({ userId: user.id, houseName: 'Dizon Residence', address: 'Banilad, Cebu City' })).body;
  device = (await admin.post('/api/devices').send({ deviceName: 'SW-GW-300', houseId: house.id, sensors: [{ sensorType: 'flow', sensorLocation: 'Main line' }, { sensorType: 'vibration', sensorLocation: 'Main line' }] })).body;
  const node = await live(`live/devices/${device.id}`);
  assert.equal(node.connectionStatus, 'not_activated');
  assert.equal(node.flowRate ?? null, null);
  assert.equal(node.ownerId, user.id);
  assert.equal(node.valve.status, 'unknown');
});

test('heartbeat, readings and alerts update the live mirror; resolving removes the alert', async () => {
  creds = (await request(app).post('/api/device-api/activate').send({ activationCode: device.activationCode })).body;
  const dev = (m, p) => request(app)[m](`/api/device-api${p}`).set('x-device-id', creds.deviceId).set('x-device-key', creds.deviceKey);
  await dev('post', '/heartbeat').send({ signalStrength: -58 });
  const flow = creds.sensors.find((s) => s.sensorType === 'flow');
  const res = await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 28, waterUsage: 4 }] });
  assert.equal(res.body.alerts.length, 1);
  const node = await live(`live/devices/${device.id}`);
  assert.equal(node.connectionStatus, 'online');
  assert.equal(node.flowRate, 28);
  const alertNode = await live(`live/alerts/${res.body.alerts[0]}`);
  assert.equal(alertNode.alertType, 'high_flow');
  assert.equal(alertNode.ownerId, user.id);

  await admin.patch(`/api/alerts/${res.body.alerts[0]}`).send({ alertStatus: 'resolved', resolutionNote: 'Tap left open' });
  assert.equal(await live(`live/alerts/${res.body.alerts[0]}`), null);
});

test('valve commands appear in the operations history and live valve state', async () => {
  await admin.post(`/api/valves/${creds.valveId}/command`).send({ action: 'close' });
  const node = await live(`live/devices/${device.id}/valve`);
  assert.equal(node.commandStatus, 'pending');
  assert.equal(node.status, 'unknown');
  const hist = await admin.get('/api/valve-commands?status=pending');
  assert.equal(hist.body.total, 1);
  assert.equal(hist.body.items[0].requestedByType, 'admin');
  assert.equal(hist.body.items[0].houseName, 'Dizon Residence');
});

test('activation codes: list, revoke, revoked code no longer works', async () => {
  const other = (await admin.post('/api/devices').send({ deviceName: 'SW-GW-301' })).body;
  const list = await admin.get('/api/activation-codes?status=active');
  assert.ok(list.body.items.some((c) => c.code === other.activationCode));
  const rev = await admin.post(`/api/activation-codes/${other.activationCode}/revoke`);
  assert.equal(rev.status, 200);
  const act = await request(app).post('/api/device-api/activate').send({ activationCode: other.activationCode });
  assert.equal(act.status, 401);
  assert.equal((await admin.post(`/api/activation-codes/${other.activationCode}/revoke`)).status, 409);
});

test('water interruptions: validation, advisory, status lifecycle, dashboard count', async () => {
  const bad = await admin.post('/api/interruptions').send({ title: 'Repair', type: 'planned', reason: 'Pipe repair', areas: 'Banilad', startAt: later(1) });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields.endAt);

  const planned = await admin.post('/api/interruptions').send({ title: 'Main line repair', type: 'planned', reason: 'Replacing a valve on the main line.', areas: 'Banilad, Talamban', startAt: later(2), endAt: later(6) });
  assert.equal(planned.status, 201);
  assert.equal(planned.body.status, 'scheduled');
  assert.equal(planned.body.notified, 1); // Lea lives in Banilad
  const ann = await admin.get('/api/announcements?category=service_advisory');
  assert.equal(ann.body.items[0].interruptionId, planned.body.id);

  const emergency = await admin.post('/api/interruptions').send({ title: 'Burst pipe', type: 'emergency', reason: 'Burst pipe on Gorordo Ave.', areas: 'Lahug', startAt: new Date().toISOString(), notifyHomeowners: false });
  assert.equal(emergency.body.status, 'ongoing');
  assert.equal((await admin.post(`/api/interruptions/${planned.body.id}/close`).send({ action: 'restore' })).status, 400);
  const restored = await admin.post(`/api/interruptions/${emergency.body.id}/close`).send({ action: 'restore' });
  assert.equal(restored.body.status, 'completed');
  assert.equal((await admin.get('/api/dashboard/summary')).body.stats.waterInterruptions, 1);
  const cancelled = await admin.post(`/api/interruptions/${planned.body.id}/close`).send({ action: 'cancel' });
  assert.equal(cancelled.body.status, 'cancelled');
});

test('water rates: tier validation, publish, estimate', async () => {
  const bad = await admin.post('/api/rates').send({ name: 'Bad', customerClass: 'residential', effectiveDate: '2026-01-01', minimumVolumeM3: 10, minimumCharge: 250, tiers: [{ fromM3: 12, toM3: null, ratePerM3: 30 }] });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields['tiers.0.fromM3']);

  const draft = await admin.post('/api/rates').send({ name: 'Residential 2026', customerClass: 'residential', effectiveDate: '2026-01-01', minimumVolumeM3: 10, minimumCharge: 250, tiers: [{ fromM3: 10, toM3: 20, ratePerM3: 30 }, { fromM3: 20, toM3: null, ratePerM3: 40 }] });
  assert.equal(draft.body.status, 'draft');
  const noRate = await admin.get(`/api/rates/estimate?houseId=${house.id}`);
  assert.equal(noRate.status, 400);

  const pub = await admin.post(`/api/rates/${draft.body.id}/publish`).send({});
  assert.equal(pub.body.status, 'active');
  assert.equal((await admin.patch(`/api/rates/${draft.body.id}`).send({})).status, 409);
  const billing = await admin.post('/api/announcements').send({ title: 'Bill', message: 'Pay now', category: 'billing_notice', audience: 'all_users' });
  assert.equal(billing.status, 400); // admins can't announce billing

  const est = await admin.get(`/api/rates/estimate?houseId=${house.id}`);
  assert.equal(est.status, 200);
  assert.equal(est.body.liters, 4); // from the 28 L/min reading above
  assert.equal(est.body.estimate.total, 250); // within the minimum volume
});

test('admin notifications: send to all / one homeowner, then list', async () => {
  const bad = await admin.post('/api/notifications').send({ audience: 'user', title: 'Hi', message: 'Hello there' });
  assert.equal(bad.status, 400);
  const all = await admin.post('/api/notifications').send({ audience: 'all', title: 'Water quality update', message: 'Water quality tests passed this week.' });
  assert.equal(all.body.sent, 1);
  const list = await admin.get('/api/notifications?type=system');
  assert.ok(list.body.total >= 2);
  assert.equal(list.body.items[0].userName, 'Lea Dizon');
});
