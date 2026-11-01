import crypto from 'node:crypto';
import { db, C } from '../db/index.js';
import { unauthorized, asyncHandler } from '../lib/errors.js';

export const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

// Authenticates an ESP32 gateway using the device key issued at activation.
// Headers: X-Device-Id, X-Device-Key
export const requireDevice = asyncHandler(async (req, _res, next) => {
  const id = req.get('x-device-id');
  const key = req.get('x-device-key');
  if (!id || !key) throw unauthorized('Device credentials required');

  const device = await db.get(C.devices, id);
  if (!device || device.activationStatus !== 'activated' || !device.deviceKeyHash) {
    throw unauthorized('Device is not activated');
  }

  const expected = Buffer.from(device.deviceKeyHash, 'hex');
  const actual = Buffer.from(hashKey(key), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw unauthorized('Invalid device credentials');
  }

  req.device = device;
  next();
});
