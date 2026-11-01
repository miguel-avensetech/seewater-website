import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db, C } from '../db/index.js';
import { adminAuth, adminBucket } from '../lib/firebaseAdmin.js';
import { asyncHandler, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { parse, z, trimmed } from '../lib/validate.js';
import { nowIso } from '../lib/time.js';
import { ROLES, requireAdmin, sessionCookieOptions } from '../middleware/auth.js';
import { logSystem } from '../services/activity.js';

// Admin authentication with Firebase Auth:
//   1. The admin website signs in with the Firebase client SDK (email + password).
//   2. It sends the fresh ID token here; we verify it with the Admin SDK, require
//      the `role: 'admin'` custom claim, and exchange it for an httpOnly Firebase
//      session cookie. Passwords never touch this server.

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many sign-in attempts. Please wait a few minutes and try again.' } },
});

const MAX_AUTH_AGE_SEC = 5 * 60;

router.post(
  '/session',
  limiter,
  asyncHandler(async (req, res) => {
    const { idToken } = parse(z.object({ idToken: z.string().min(20, 'Missing ID token') }), req.body);

    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(idToken, true);
    } catch {
      throw unauthorized('Sign-in could not be verified. Please try again.');
    }
    // Session cookies may only be minted from a recent sign-in.
    if (Date.now() / 1000 - decoded.auth_time > MAX_AUTH_AGE_SEC) throw unauthorized('Please sign in again.');
    if (decoded.role !== 'admin') throw forbidden('This account does not have administrator access.');

    const profile = await db.get(C.admins, decoded.uid);
    if (!profile || profile.status === 'disabled') throw forbidden('This administrator account is not active.');

    const expiresIn = config.sessionHours * 3600 * 1000;
    const cookie = await adminAuth().createSessionCookie(idToken, { expiresIn });
    await db.update(C.admins, decoded.uid, { lastLoginAt: nowIso() });
    await logSystem({ category: 'admin_action', action: 'admin_login', description: `${profile.fullName} signed in`, status: 'success', actor: { id: decoded.uid, fullName: profile.fullName } });

    res.cookie(config.cookieName, cookie, sessionCookieOptions());
    res.json({ admin: { ...profile, id: decoded.uid, email: decoded.email, role: ROLES.includes(decoded.adminRole) ? decoded.adminRole : 'viewer' } });
  }),
);

// Signs out: clears the cookie and revokes refresh tokens so other sessions end too.
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const cookie = req.cookies?.[config.cookieName];
    if (cookie) {
      try {
        const claims = await adminAuth().verifySessionCookie(cookie);
        await adminAuth().revokeRefreshTokens(claims.sub);
      } catch {
        // Already invalid — nothing to revoke.
      }
    }
    const { maxAge, ...opts } = sessionCookieOptions();
    res.clearCookie(config.cookieName, opts);
    res.status(204).end();
  }),
);

router.get('/me', requireAdmin, (req, res) => res.json({ admin: req.admin }));

const profileSchema = z.object({
  fullName: trimmed(2, 100),
  department: z.string().trim().max(100).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  // Set after uploading a picture to Firebase Storage at admins/{uid}/…
  photoPath: z.string().max(300).nullable().optional(),
  photoURL: z.string().url().max(2000).nullable().optional(),
});

router.patch(
  '/profile',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const data = parse(profileSchema, req.body);
    if (data.photoPath && !data.photoPath.startsWith(`admins/${req.admin.id}/`)) {
      throw badRequest('Profile pictures must be stored in your own folder.');
    }
    // Remove the previous picture from Storage when it is replaced or cleared.
    if (data.photoPath !== undefined && req.admin.photoPath && req.admin.photoPath !== data.photoPath) {
      await adminBucket().file(req.admin.photoPath).delete({ ignoreNotFound: true }).catch(() => {});
    }
    const updated = await db.update(C.admins, req.admin.id, { ...data, updatedAt: nowIso() });
    await adminAuth().updateUser(req.admin.id, { displayName: data.fullName, ...(data.photoURL !== undefined && { photoURL: data.photoURL }) });
    res.json({ admin: { ...updated, id: req.admin.id, email: req.admin.email, role: req.admin.role } });
  }),
);

const preferencesSchema = z.object({
  defaultUsagePeriod: z.enum(['daily', 'weekly', 'monthly']),
  rowsPerPage: z.union([z.literal(10), z.literal(25), z.literal(50)]),
});

router.patch(
  '/preferences',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const preferences = parse(preferencesSchema, req.body);
    const updated = await db.update(C.admins, req.admin.id, { preferences, updatedAt: nowIso() });
    res.json({ admin: { ...updated, id: req.admin.id, email: req.admin.email, role: req.admin.role } });
  }),
);

// Called after the client changes the password with Firebase (which revokes
// existing sessions); records the event for the audit trail.
router.post(
  '/password-changed',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await logSystem({ category: 'admin_action', action: 'password_changed', description: `${req.admin.fullName} changed their password`, status: 'success', actor: req.admin });
    res.status(204).end();
  }),
);

export default router;
