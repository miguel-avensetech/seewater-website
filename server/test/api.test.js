import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { db, C } from '../src/db/index.js';
import { adminAuth } from '../src/lib/firebaseAdmin.js';
import { adminAgent, createAdmin, firebaseSignIn, resetEmulators } from './helpers.js';

let app;
let agent;
const PASSWORD = 'CorrectHorse42';

before(async () => {
  app = await resetEmulators();
  await createAdmin({ email: 'admin@test.ph', password: PASSWORD });
  await createAdmin({ email: 'viewer@test.ph', password: PASSWORD, fullName: 'Read Only', adminRole: 'viewer' });
  await adminAuth().createUser({ email: 'plain@test.ph', password: PASSWORD, emailVerified: true });
});

test('protected routes reject unauthenticated requests', async () => {
  const res = await request(app).get('/api/dashboard/summary');
  assert.equal(res.status, 401);
});

test('session requires a valid Firebase ID token', async () => {
  const invalid = await request(app).post('/api/auth/session').send({});
  assert.equal(invalid.status, 400);
  const forged = await request(app).post('/api/auth/session').send({ idToken: 'x'.repeat(40) });
  assert.equal(forged.status, 401);
  await assert.rejects(firebaseSignIn('admin@test.ph', 'wrong-password1'));
});

test('accounts without the admin custom claim are refused', async () => {
  const res = await request(app).post('/api/auth/session').send({ idToken: await firebaseSignIn('plain@test.ph', PASSWORD) });
  assert.equal(res.status, 403);
});

test('admin sign-in sets an httpOnly Firebase session cookie', async () => {
  agent = request.agent(app);
  const res = await agent.post('/api/auth/session').send({ idToken: await firebaseSignIn('admin@test.ph', PASSWORD) });
  assert.equal(res.status, 200);
  assert.equal(res.body.admin.role, 'super_admin');
  assert.match(res.headers['set-cookie'][0], /sw_session=.*HttpOnly/i);
  const me = await agent.get('/api/auth/me');
  assert.equal(me.body.admin.email, 'admin@test.ph');
});

test('viewer role cannot mutate data', async () => {
  const viewer = await adminAgent(app, 'viewer@test.ph', PASSWORD);
  const res = await viewer.post('/api/users').send({ fullName: 'X Y', email: 'x@y.ph', address: 'Somewhere 123' });
  assert.equal(res.status, 403);
});

test('revoking the admin claim ends access immediately', async () => {
  const temp = await createAdmin({ email: 'temp@test.ph', password: PASSWORD });
  const tempAgent = await adminAgent(app, 'temp@test.ph', PASSWORD);
  assert.equal((await tempAgent.get('/api/auth/me')).status, 200);
  // Revocation is recorded with 1-second precision; real revocations happen later than this.
  await new Promise((r) => setTimeout(r, 1100));
  await adminAuth().setCustomUserClaims(temp.uid, {});
  await adminAuth().revokeRefreshTokens(temp.uid);
  assert.equal((await tempAgent.get('/api/auth/me')).status, 401);
});

let user;
let house;
let device;
let creds;

test('user and household CRUD with validation', async () => {
  const bad = await agent.post('/api/users').send({ fullName: 'A', email: 'bad', address: '' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields.fullName && bad.body.error.fields.email && bad.body.error.fields.address);

  const res = await agent.post('/api/users').send({ fullName: 'Maria Santos', email: 'maria@example.com', phone: '+63 917 555 0101', address: 'Banilad, Cebu City' });
  assert.equal(res.status, 201);
  user = res.body;

  const dup = await agent.post('/api/users').send({ fullName: 'Other', email: 'maria@example.com', address: 'Lahug, Cebu City' });
  assert.equal(dup.status, 400);

  const h = await agent.post(`/api/users/${user.id}/houses`).send({ houseName: 'Santos Residence', address: 'Banilad, Cebu City', houseStatus: 'monitored' });
  assert.equal(h.status, 201);
  house = h.body;

  const list = await agent.get('/api/users?q=santos');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].householdCount, 1);

  const blocked = await agent.delete(`/api/users/${user.id}`);
  assert.equal(blocked.status, 409);
});

test('device registration issues a unique activation code', async () => {
  const res = await agent.post('/api/devices').send({
    deviceName: 'SW-GW-100',
    macAddress: '24:6f:28:aa:bb:cc',
    houseId: house.id,
    sensors: [
      { sensorType: 'flow', sensorLocation: 'Main line' },
      { sensorType: 'vibration', sensorLocation: 'Kitchen line' },
    ],
  });
  assert.equal(res.status, 201);
  device = res.body;
  assert.match(device.activationCode, /^SW-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const stored = await db.get(C.activationCodes, device.activationCode);
  assert.equal(stored.deviceId, device.id);
  assert.equal(stored.status, 'active');
  assert.ok(Date.parse(stored.expiresAt) > Date.now());
  assert.equal(device.connectionStatus, 'not_activated');
  assert.equal(device.deviceKeyHash, undefined);
  assert.equal(device.macAddress, '24:6F:28:AA:BB:CC');
});

test('device activation returns credentials once', async () => {
  const res = await request(app).post('/api/device-api/activate').send({ activationCode: device.activationCode });
  assert.equal(res.status, 201);
  creds = res.body;
  assert.ok(creds.deviceKey && creds.valveId && creds.sensors.length === 2);
  const again = await request(app).post('/api/device-api/activate').send({ activationCode: device.activationCode });
  assert.equal(again.status, 401);
});

const dev = (method, path) =>
  request(app)[method](`/api/device-api${path}`).set('x-device-id', creds.deviceId).set('x-device-key', creds.deviceKey);

test('device API rejects a wrong key', async () => {
  const res = await request(app).post('/api/device-api/heartbeat').set('x-device-id', creds.deviceId).set('x-device-key', 'wrong').send({});
  assert.equal(res.status, 401);
});

test('readings are stored as real device data and update usage', async () => {
  await dev('post', '/heartbeat').send({ signalStrength: -60 });
  const flow = creds.sensors.find((s) => s.sensorType === 'flow');
  const res = await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 4.2, waterUsage: 12.5 }] });
  assert.equal(res.status, 201);
  assert.equal(res.body.alerts.length, 0);

  const mon = await agent.get('/api/monitoring/overview');
  const h = mon.body.houses.find((x) => x.houseId === house.id);
  assert.equal(h.flow.flowRate, 4.2);
  assert.equal(h.flow.dataState, 'live');
  assert.equal(h.device.connectionStatus, 'online');
  assert.equal(h.todayLiters, 12.5);

  const usage = await agent.get('/api/usage?period=daily');
  assert.equal(usage.body.totals.liters, 12.5);
  assert.deepEqual(usage.body.sources, ['device']);
});

test('high flow raises an alert, with cooldown dedupe', async () => {
  const flow = creds.sensors.find((s) => s.sensorType === 'flow');
  const first = await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 30, waterUsage: 5 }] });
  assert.equal(first.body.alerts.length, 1);
  const second = await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 31, waterUsage: 5 }] });
  assert.equal(second.body.alerts.length, 0);
  const alerts = await agent.get('/api/alerts?type=high_flow');
  assert.equal(alerts.body.items[0].severityLevel, 'critical');
  assert.equal(alerts.body.items[0].source, 'device');
});

test('vibration needs a baseline and concurrent flow to raise a leak alert', async () => {
  const vib = creds.sensors.find((s) => s.sensorType === 'vibration');
  const flow = creds.sensors.find((s) => s.sensorType === 'flow');

  const baseline = await agent.put(`/api/vibration/sensors/${vib.id}/baseline`).send({ baselineValue: 100, acceptableRange: 40, environment: 'quiet' });
  assert.equal(baseline.status, 200);
  assert.equal(baseline.body.limit, 140);

  // Vibration with no flow → environmental noise, no alert.
  await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 0, waterUsage: 0 }] });
  const noise = await dev('post', '/readings').send({ readings: [{ sensorId: vib.id, vibrationLevel: 200 }, { sensorId: flow.id, flowRate: 0 }] });
  assert.equal(noise.body.alerts.length, 0);

  // Vibration with flow → possible leak.
  const leak = await dev('post', '/readings').send({ readings: [{ sensorId: flow.id, flowRate: 1.2, waterUsage: 0.3 }, { sensorId: vib.id, vibrationLevel: 220 }] });
  assert.equal(leak.body.alerts.length, 1);
  const alerts = await agent.get('/api/alerts?type=possible_leak&status=active');
  assert.equal(alerts.body.total, 1);
  assert.equal(alerts.body.items[0].possibleLeakArea, 'Kitchen line');
});

test('valve shutoff stays pending until the device confirms', async () => {
  const cmd = await agent.post(`/api/valves/${creds.valveId}/command`).send({ action: 'close', reason: 'Leak alert' });
  assert.equal(cmd.status, 202);
  assert.equal(cmd.body.commandStatus, 'pending');
  assert.notEqual(cmd.body.status, 'closed');

  const dup = await agent.post(`/api/valves/${creds.valveId}/command`).send({ action: 'close' });
  assert.equal(dup.status, 409);

  // Real devices cannot be "simulated" from the dashboard.
  const fake = await agent.post(`/api/valves/${creds.valveId}/simulate-ack`);
  assert.equal(fake.status, 409);

  const { body } = await dev('get', '/commands');
  assert.equal(body.commands[0].state, 'closed');
  const ack = await dev('post', '/valve-ack').send({ valveId: creds.valveId, commandId: body.commands[0].commandId, state: 'closed', success: true });
  assert.equal(ack.status, 200);
  assert.equal(ack.body.status, 'closed');
  assert.equal(ack.body.commandStatus, 'acknowledged');
  assert.equal(ack.body.positionConfirmed, false);
});

test('sensor calibration and threshold profiles are recorded separately', async () => {
  const flow = creds.sensors.find((s) => s.sensorType === 'flow');
  const cal = await agent.post(`/api/calibration/sensors/${flow.id}`).send({ sensitivity: 1.1, calibrationFactor: 7.3, remarks: 'Bucket test' });
  assert.equal(cal.status, 200);
  assert.equal(cal.body.changes, 2);

  const bad = await agent.put(`/api/calibration/thresholds/${flow.id}`).send({ minValue: 0, maxValue: 30, warningLevel: 20, criticalLevel: 10 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.fields.criticalLevel);
  const ok = await agent.put(`/api/calibration/thresholds/${flow.id}`).send({ minValue: 0, maxValue: 30, warningLevel: 12, criticalLevel: 22 });
  assert.equal(ok.status, 200);

  const detail = await agent.get(`/api/calibration/sensors/${flow.id}`);
  assert.equal(detail.body.threshold.warningLevel, 12);
  assert.equal(detail.body.sensor.calibrationStatus, 'calibrated');
  assert.ok(detail.body.history.length >= 4);
  const list = await agent.get('/api/calibration/thresholds?type=flow&profile=custom');
  assert.ok(list.body.items.some((r) => r.id === flow.id));

  assert.equal((await agent.delete(`/api/calibration/thresholds/${flow.id}`)).status, 204);
  const reset = await agent.get(`/api/calibration/sensors/${flow.id}`);
  assert.equal(reset.body.threshold.isDefault, true);
});

test('firmware update: queue, deliver to device, confirm by heartbeat', async () => {
  const dev = (method, path) => request(app)[method](`/api/device-api${path}`).set('x-device-id', creds.deviceId).set('x-device-key', creds.deviceKey);
  const http = await agent.post('/api/firmware').send({ deviceIds: [creds.deviceId], targetVersion: '9.9.9', url: 'http://example.com/fw.bin' });
  assert.equal(http.status, 400);
  const q = await agent.post('/api/firmware').send({ deviceIds: [creds.deviceId], targetVersion: '9.9.9', url: 'https://example.com/fw.bin' });
  assert.equal(q.status, 201);
  assert.equal(q.body.created, 1);
  const again = await agent.post('/api/firmware').send({ deviceIds: [creds.deviceId], targetVersion: '9.9.9', url: 'https://example.com/fw.bin' });
  assert.equal(again.status, 400);

  const { body } = await dev('get', '/commands');
  const fw = body.commands.find((c) => c.type === 'firmware');
  assert.equal(fw.version, '9.9.9');
  assert.equal((await dev('post', '/firmware-status').send({ updateId: fw.updateId, status: 'downloading' })).status, 200);
  await dev('post', '/heartbeat').send({ firmwareVersion: '9.9.9' });
  const list = await agent.get('/api/firmware');
  assert.equal(list.body.items.find((j) => j.id === fw.updateId).status, 'installed');
});

test('announcements: draft, schedule validation, publish', async () => {
  const past = await agent.post('/api/announcements').send({ title: 'Test', message: 'A message that is long enough', category: 'customer_tip', action: 'schedule', publishAt: '2020-01-01T00:00:00Z' });
  assert.equal(past.status, 400);
  assert.ok(past.body.error.fields.publishAt);

  const draft = await agent.post('/api/announcements').send({ title: 'Water interruption', message: 'Pipe repairs in the area tonight.', category: 'service_advisory', action: 'draft' });
  assert.equal(draft.body.status, 'draft');

  const start = new Date(Date.now() + 3600000).toISOString();
  const end = new Date(Date.now() + 7200000).toISOString();
  const pub = await agent.patch(`/api/announcements/${draft.body.id}`).send({ title: 'Water interruption', message: 'Pipe repairs in the area tonight.', category: 'service_advisory', action: 'publish', interruption: { start, end, area: 'Banilad' } });
  assert.equal(pub.body.status, 'published');

  // Interruptions now live in their own collection (see modules.test.js); the
  // advisory keeps its interruption snapshot for the mobile app.
  assert.equal(pub.body.interruption.area, 'Banilad');
  const summary = await agent.get('/api/dashboard/summary');
  assert.equal(summary.body.stats.totalUsers, 1);
  assert.equal(summary.body.stats.connectedDevices, 1);
});

test('feedback must include a response before resolving', async () => {
  const fb = await db.create(C.feedback, { userId: user.id, type: 'complaint', subject: 'Low pressure', message: 'Pressure is low', status: 'new', createdAt: new Date().toISOString() });
  const bad = await agent.patch(`/api/feedback/${fb.id}`).send({ status: 'resolved' });
  assert.equal(bad.status, 400);
  const ok = await agent.patch(`/api/feedback/${fb.id}`).send({ status: 'resolved', response: 'We fixed the main valve.' });
  assert.equal(ok.body.status, 'resolved');
  const notes = await db.list(C.notifications, { where: [['notificationType', '==', 'feedback_response']] });
  assert.equal(notes.length, 1);
});

test('settings validate and disable alerts', async () => {
  const current = (await agent.get('/api/settings')).body;
  const bad = await agent.patch('/api/settings').send({ ...current, highFlowCriticalLpm: 5, highFlowWarningLpm: 10 });
  assert.equal(bad.status, 400);
  const { id, updatedAt, updatedBy, ...rest } = current;
  const ok = await agent.patch('/api/settings').send({ ...rest, highFlowAlertsEnabled: false });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.highFlowAlertsEnabled, false);
});

test('logout clears the session', async () => {
  await agent.post('/api/auth/logout');
  const res = await agent.get('/api/auth/me');
  assert.equal(res.status, 401);
});
