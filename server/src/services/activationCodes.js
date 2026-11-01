// Device activation codes (collection: activationCodes, document id = the code).
//
// A code is issued by an administrator for one device and can be used:
//   • once by the ESP32 hardware (device API /activate → issues device credentials)
//   • once by the homeowner app (links the device to the homeowner's household)
// Codes expire after ACTIVATION_CODE_DAYS if unused, and are revoked when a new
// code is issued. Clients can never read this collection (see firestore.rules).

import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { nowIso } from '../lib/time.js';

// Unambiguous alphabet (no 0/O/1/I) for codes read off a label or typed into the app.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_PATTERN = /^SW-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function randomCode() {
  const chars = [...crypto.randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `SW-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export async function revokeCodesForDevice(deviceId, reason = 'replaced') {
  const codes = await db.list(C.activationCodes, { where: [['deviceId', '==', deviceId]] });
  for (const c of codes) {
    if (c.status === 'active') await db.update(C.activationCodes, c.id, { status: 'revoked', revokedAt: nowIso(), revokedReason: reason });
  }
}

export async function issueActivationCode(deviceId, admin, { code: fixed, expiresInDays = config.activationCodeDays } = {}) {
  await revokeCodesForDevice(deviceId);
  for (let i = 0; i < 5; i++) {
    const code = fixed ?? randomCode();
    if (!fixed && (await db.get(C.activationCodes, code))) continue;
    const doc = {
      code,
      deviceId,
      status: 'active',
      createdAt: nowIso(),
      createdBy: admin?.id ?? null,
      expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
      hardwareActivatedAt: null,
      homeownerLinkedAt: null,
      activatedBy: null,
    };
    await db.set(C.activationCodes, code, doc);
    return { id: code, ...doc };
  }
  throw new Error('Could not generate a unique activation code');
}

/**
 * Returns { code, device } for a usable code, or { error } describing why not.
 * `use` is 'hardware' or 'homeowner' — each may consume the code once.
 */
export async function resolveActivationCode(rawCode, use) {
  const code = String(rawCode).trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return { error: 'invalid' };
  const record = await db.get(C.activationCodes, code);
  if (!record || record.status === 'revoked') return { error: 'invalid' };
  if (record.status === 'active' && Date.parse(record.expiresAt) < Date.now()) {
    await db.update(C.activationCodes, code, { status: 'expired' });
    return { error: 'expired' };
  }
  if (record.status === 'expired') return { error: 'expired' };
  if (use === 'hardware' && record.hardwareActivatedAt) return { error: 'used' };
  if (use === 'homeowner' && record.homeownerLinkedAt) return { error: 'used' };
  const device = await db.get(C.devices, record.deviceId);
  if (!device || device.activationStatus === 'deactivated') return { error: 'invalid' };
  return { code: record, device };
}

export async function markCodeUsed(code, use, userId = null) {
  const record = await db.get(C.activationCodes, code);
  const patch = use === 'hardware' ? { hardwareActivatedAt: nowIso() } : { homeownerLinkedAt: nowIso(), activatedBy: userId };
  const done = { ...record, ...patch };
  // Fully used once both the hardware and the homeowner have redeemed it.
  if (done.hardwareActivatedAt && done.homeownerLinkedAt) patch.status = 'used';
  await db.update(C.activationCodes, code, { ...patch, activatedAt: done.activatedAt ?? nowIso() });
}

// Current code per device (admin views only).
export async function activeCodesByDevice() {
  const codes = await db.list(C.activationCodes, { where: [['status', '==', 'active']] });
  return new Map(codes.map((c) => [c.deviceId, c]));
}
