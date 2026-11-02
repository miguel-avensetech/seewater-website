import crypto from 'node:crypto';
import { db, C } from '../db/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { logDevice, logSystem } from './activity.js';
import { notifyHouseOwner } from './notify.js';

// Valve state model:
//   status            — last state reported by the device: open | closed | unknown
//   requestedState    — state the server asked for
//   commandStatus     — none | pending | acknowledged | failed
//   positionConfirmed — true only when the device verified the physical valve
//                       position (e.g. a position sensor). The ESP32 + relay design
//                       in the manuscript has no position feedback, so an
//                       acknowledgement means "relay switched", not "valve verified".
// Every command is also recorded in VALVE_COMMANDS for admin and homeowner review.

const ACTOR_LABEL = { admin: 'Administrator', homeowner: 'Homeowner', automatic: 'Automatic shutoff' };

export async function requestValveCommand({ valveId, action, reason, actor, actorType = 'homeowner', emergency = false }) {
  const valve = await db.get(C.valves, valveId);
  if (!valve) throw notFound('Valve');
  if (valve.commandStatus === 'pending') {
    throw conflict('A command is already waiting for the device to respond.');
  }

  const target = action === 'close' ? 'closed' : 'open';
  const at = nowIso();
  const command = await db.create(C.valveCommands, {
    valveId,
    deviceId: valve.deviceId,
    houseId: valve.houseId,
    action,
    requestedState: target,
    emergency,
    reason: reason || null,
    requestedByType: actorType,
    requestedById: actor?.id ?? null,
    requestedByName: actor?.fullName ?? ACTOR_LABEL[actorType],
    status: 'pending',
    requestedAt: at,
    respondedAt: null,
    positionConfirmed: false,
  });

  const updated = await db.update(C.valves, valveId, {
    commandId: command.id,
    requestedState: target,
    commandStatus: 'pending',
    requestedAt: at,
    requestedBy: actor?.id ?? null,
    requestedByType: actorType,
    requestReason: reason || null,
    controlType: actorType === 'automatic' ? 'automatic' : 'manual',
    lastUpdated: at,
  });

  const device = await db.get(C.devices, valve.deviceId);
  const source = device?.isSimulated ? 'simulated' : 'device';
  const verb = action === 'close' ? (emergency ? 'Emergency shutoff' : 'Shutoff') : 'Restore';
  await logSystem({
    category: 'valve_operation',
    action: `valve_${action}_requested`,
    description: `${verb} requested by ${ACTOR_LABEL[actorType].toLowerCase()}${actor?.fullName ? ` ${actor.fullName}` : ''} for ${device?.deviceName ?? 'device'}. Awaiting device response.`,
    status: 'pending',
    actor: actorType === 'admin' ? actor : null,
    deviceId: valve.deviceId,
    houseId: valve.houseId,
    source,
  });
  await logDevice({ deviceId: valve.deviceId, eventType: 'valve_command_sent', description: `${verb} command queued (${ACTOR_LABEL[actorType]})`, status: 'pending', source });

  // Keep the homeowner informed about commands they did not send themselves.
  if (actorType !== 'homeowner') {
    await notifyHouseOwner(valve.houseId, {
      title: action === 'close' ? 'Water shutoff requested' : 'Water restore requested',
      message: `${ACTOR_LABEL[actorType]} sent a command to ${action === 'close' ? 'close' : 'open'} your water valve. Waiting for your SeeWater device to respond.`,
      notificationType: 'valve',
      data: { valveId },
    });
  }
  return { ...updated, command };
}

export async function cancelValveCommand({ valve, actor, actorType = 'admin' }) {
  if (valve.commandStatus !== 'pending') throw conflict('There is no pending command to cancel.');
  const at = nowIso();
  if (valve.commandId) {
    await db.update(C.valveCommands, valve.commandId, { status: 'cancelled', respondedAt: at, cancelledByType: actorType, cancelledById: actor?.id ?? null });
  }
  await logSystem({ category: 'valve_operation', action: 'valve_command_cancelled', description: `Pending valve command cancelled by ${ACTOR_LABEL[actorType].toLowerCase()}`, status: 'info', actor: actorType === 'admin' ? actor : null, deviceId: valve.deviceId, houseId: valve.houseId });
  return db.update(C.valves, valve.id, { commandStatus: 'none', requestedState: null, commandId: null, lastUpdated: at });
}

export async function acknowledgeValveCommand({ valve, commandId, state, success, message, positionConfirmed = false }) {
  if (valve.commandStatus !== 'pending' || valve.commandId !== commandId) {
    throw conflict('No matching pending command for this valve.');
  }
  const at = nowIso();
  const patch = success
    ? { status: state, commandStatus: 'acknowledged', positionConfirmed: Boolean(positionConfirmed), acknowledgedAt: at, lastUpdated: at }
    : { commandStatus: 'failed', failureReason: message || 'Device reported failure', lastUpdated: at };
  const updated = await db.update(C.valves, valve.id, patch);
  await db.update(C.valveCommands, commandId, {
    status: success ? 'acknowledged' : 'failed',
    positionConfirmed: success && Boolean(positionConfirmed),
    respondedAt: at,
    failureReason: success ? null : patch.failureReason,
  });

  const device = await db.get(C.devices, valve.deviceId);
  const source = device?.isSimulated ? 'simulated' : 'device';
  const description = success
    ? `Device switched the valve ${state}${positionConfirmed ? ' (position verified)' : ' (position not physically verified)'}.`
    : `Device could not change the valve: ${patch.failureReason}`;
  await logSystem({
    category: 'valve_operation',
    action: success ? 'valve_acknowledged' : 'valve_failed',
    description: `${device?.deviceName ?? 'Device'}: ${description}`,
    status: success ? 'success' : 'error',
    deviceId: valve.deviceId,
    houseId: valve.houseId,
    source,
  });
  await logDevice({ deviceId: valve.deviceId, eventType: success ? 'valve_acknowledged' : 'valve_failed', description, status: success ? 'success' : 'error', source });
  await notifyHouseOwner(valve.houseId, {
    title: success ? (state === 'closed' ? 'Water valve closed' : 'Water valve opened') : 'Valve command failed',
    message: success
      ? `Your SeeWater device reported the valve as ${state}.${positionConfirmed ? '' : ' The physical valve position is not independently verified.'}`
      : `Your SeeWater device could not change the valve: ${patch.failureReason}`,
    notificationType: 'valve',
    data: { valveId: valve.id },
  });
  return updated;
}

export async function recentValveCommands(valveId, limit = 10) {
  const rows = await db.list(C.valveCommands, { where: [['valveId', '==', valveId]] });
  return rows.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, limit);
}
