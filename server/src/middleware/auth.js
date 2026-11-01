import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { adminAuth } from '../lib/firebaseAdmin.js';
import { unauthorized, forbidden, asyncHandler } from '../lib/errors.js';

// Admin permission levels, stored in the `adminRole` custom claim.
export const ROLES = ['viewer', 'admin', 'super_admin'];

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionHours * 3600 * 1000,
  };
}

/**
 * Verifies the Firebase session cookie (checking revocation), requires the
 * `role: 'admin'` custom claim — which only the Admin SDK can set — and loads
 * the admin profile from Firestore.
 */
export const requireAdmin = asyncHandler(async (req, _res, next) => {
  const cookie = req.cookies?.[config.cookieName];
  if (!cookie) throw unauthorized();

  let claims;
  try {
    claims = await adminAuth().verifySessionCookie(cookie, true);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (claims.role !== 'admin') throw forbidden('This account does not have administrator access.');

  const profile = await db.get(C.admins, claims.uid);
  if (!profile || profile.status === 'disabled') throw unauthorized('Account is not active.');

  req.admin = { ...profile, id: claims.uid, email: claims.email ?? profile.email, role: ROLES.includes(claims.adminRole) ? claims.adminRole : 'viewer' };
  next();
});

// Use after requireAdmin. Blocks read-only (viewer) accounts from mutations, etc.
export const requireRole = (minRole) => (req, _res, next) => {
  if (ROLES.indexOf(req.admin?.role) < ROLES.indexOf(minRole)) return next(forbidden());
  next();
};
