import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { asyncHandler, forbidden, unauthorized } from '../lib/errors.js';

export function signHomeownerToken(user) {
  return jwt.sign({ sub: user.id, typ: 'homeowner', ver: user.tokenVersion ?? 0 }, config.jwtSecret, {
    audience: config.homeownerAudience,
    expiresIn: `${config.homeownerSessionDays}d`,
  });
}

// Mobile app authentication: `Authorization: Bearer <token>`.
// Admin sessions (cookie, different audience) are never accepted here, and
// homeowner tokens are never accepted by admin routes.
export const requireHomeowner = asyncHandler(async (req, _res, next) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { audience: config.homeownerAudience });
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (payload.typ !== 'homeowner') throw unauthorized();

  const user = await db.get(C.users, payload.sub);
  if (!user || !user.passwordHash) throw unauthorized('Account not found.');
  if ((user.tokenVersion ?? 0) !== payload.ver) throw unauthorized('You were signed out. Please sign in again.');
  if (!user.emailVerified) throw forbidden('Please verify your email address first.');
  if (user.status !== 'active') throw forbidden('This account has been deactivated. Please contact MCWD.');

  req.user = user;
  next();
});
