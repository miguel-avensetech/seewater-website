import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db, C } from '../../db/index.js';
import { asyncHandler, badRequest, conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { parse, trimmed, z } from '../../lib/validate.js';
import { requireHomeowner, signHomeownerToken } from '../../middleware/homeownerAuth.js';
import { logSystem, logUserManagement } from '../../services/activity.js';
import { publicUser } from '../../services/homeowners.js';
import { sendMail, verificationEmail } from '../../services/mailer.js';
import { NOTIFICATION_PREF_DEFAULTS } from '../../services/notify.js';

const router = Router();

const CODE_TTL_MIN = 15;
const MAX_ATTEMPTS = 5;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

const limiter = (limit) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'Too many attempts. Please wait a few minutes and try again.' } } });

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');
const phone = z.string().trim().regex(/^[+\d][\d\s-]{6,19}$/, 'Enter a valid phone number').or(z.literal('')).optional().default('');

const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');

async function issueVerification(user) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.update(C.users, user.id, {
    verification: { codeHash: hashCode(code), expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString(), attempts: 0, sentAt: nowIso() },
  });
  await sendMail({ to: user.email, ...verificationEmail(user.fullName, code) });
}

const session = (user) => ({ token: signHomeownerToken(user), user: publicUser(user) });

const signupSchema = z.object({
  fullName: trimmed(2, 100),
  email,
  password,
  phone,
  address: z.string().trim().max(300).optional().default(''),
});

/**
 * Sign-up. If MCWD already created a homeowner record with this email (Admin →
 * User Management), the app account is attached to that record once the email
 * is verified, so households and devices assigned by the admin carry over.
 */
router.post(
  '/signup',
  limiter(10),
  asyncHandler(async (req, res) => {
    const data = parse(signupSchema, req.body);
    const [existing] = await db.list(C.users, { where: [['email', '==', data.email]], limit: 1 });
    const pendingPasswordHash = await bcrypt.hash(data.password, 12);

    let user;
    if (existing) {
      if (existing.passwordHash) throw conflict('An account with this email already exists. Please sign in instead.');
      if (existing.status === 'inactive') throw forbidden('This account has been deactivated. Please contact MCWD.');
      // Admin-created record: keep MCWD's details, fill in anything missing.
      user = await db.update(C.users, existing.id, {
        pendingPasswordHash,
        ...(!existing.phone && data.phone && { phone: data.phone }),
        ...(!existing.address && data.address && { address: data.address }),
      });
    } else {
      user = await db.create(C.users, {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        accountNumber: '',
        status: 'active',
        emailVerified: false,
        registeredVia: 'mobile_app',
        pendingPasswordHash,
        tokenVersion: 0,
        expoPushTokens: [],
        createdAt: nowIso(),
      });
    }
    await issueVerification(user);
    res.status(201).json({ email: user.email, verificationRequired: true, linkedToExistingRecord: Boolean(existing) });
  }),
);

const verifySchema = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') });

router.post(
  '/verify-email',
  limiter(20),
  asyncHandler(async (req, res) => {
    const { email: addr, code } = parse(verifySchema, req.body);
    const [user] = await db.list(C.users, { where: [['email', '==', addr]], limit: 1 });
    const v = user?.verification;
    const invalid = () => badRequest('Please correct the highlighted fields.', { fields: { code: 'Incorrect or expired code' } });
    if (!user || !v || !user.pendingPasswordHash) throw invalid();
    if (v.attempts >= MAX_ATTEMPTS || Date.parse(v.expiresAt) < Date.now()) {
      throw badRequest('This code has expired. Request a new one.', { fields: { code: 'Code expired — request a new one' } });
    }
    const ok = crypto.timingSafeEqual(Buffer.from(v.codeHash, 'hex'), Buffer.from(hashCode(code), 'hex'));
    if (!ok) {
      await db.update(C.users, user.id, { verification: { ...v, attempts: v.attempts + 1 } });
      throw invalid();
    }

    const firstAccount = !user.passwordHash;
    const verified = await db.update(C.users, user.id, {
      passwordHash: user.pendingPasswordHash,
      pendingPasswordHash: null,
      verification: null,
      emailVerified: true,
      emailVerifiedAt: nowIso(),
      tokenVersion: (user.tokenVersion ?? 0) + (firstAccount ? 0 : 1),
      expoPushTokens: user.expoPushTokens ?? [],
    });
    if (firstAccount) {
      await logUserManagement({ admin: { id: null }, userId: user.id, actionType: 'app_account_created', remarks: 'Homeowner registered in the SeeWater mobile app' });
      await logSystem({ category: 'admin_action', action: 'homeowner_registered', description: `${user.fullName} registered a SeeWater app account`, status: 'success' });
    }
    res.json(session(verified));
  }),
);

router.post(
  '/resend-verification',
  limiter(5),
  asyncHandler(async (req, res) => {
    const { email: addr } = parse(z.object({ email }), req.body);
    const [user] = await db.list(C.users, { where: [['email', '==', addr]], limit: 1 });
    // Same response whether or not the account exists.
    if (user?.pendingPasswordHash) await issueVerification(user);
    res.json({ ok: true });
  }),
);

router.post(
  '/login',
  limiter(20),
  asyncHandler(async (req, res) => {
    const data = parse(z.object({ email, password: z.string().min(1, 'Password is required') }), req.body);
    const [user] = await db.list(C.users, { where: [['email', '==', data.email]], limit: 1 });

    const ok = await bcrypt.compare(data.password, user?.passwordHash || user?.pendingPasswordHash || DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Incorrect email or password.');
    if (user.status !== 'active') throw forbidden('This account has been deactivated. Please contact MCWD.');
    if (!user.emailVerified || !user.passwordHash) {
      await issueVerification(user);
      return res.status(403).json({ error: { message: 'Please verify your email. We sent you a new code.', code: 'EMAIL_NOT_VERIFIED', email: user.email } });
    }
    await db.update(C.users, user.id, { lastLoginAt: nowIso() });
    res.json(session(user));
  }),
);

router.get('/me', requireHomeowner, (req, res) => res.json({ user: publicUser(req.user) }));

const profileSchema = z.object({
  fullName: trimmed(2, 100),
  phone,
  address: z.string().trim().max(300).optional().default(''),
});

router.patch(
  '/profile',
  requireHomeowner,
  asyncHandler(async (req, res) => {
    const data = parse(profileSchema, req.body);
    const updated = await db.update(C.users, req.user.id, { ...data, updatedAt: nowIso() });
    await logUserManagement({ admin: { id: null }, userId: req.user.id, actionType: 'profile_updated_by_homeowner', remarks: 'Updated in the mobile app' });
    res.json({ user: publicUser(updated) });
  }),
);

const preferencesSchema = z.object({
  notificationPreferences: z
    .object(Object.fromEntries(Object.keys(NOTIFICATION_PREF_DEFAULTS).map((k) => [k, z.boolean().optional()])))
    .strict()
    .optional(),
  // Liters per household per day; null turns the usage threshold off.
  dailyUsageLimitLiters: z.number({ invalid_type_error: 'Enter a number of liters' }).int('Use whole liters').min(10, 'Use at least 10 L').max(100000, 'Use at most 100,000 L').nullable().optional(),
});

router.patch(
  '/preferences',
  requireHomeowner,
  asyncHandler(async (req, res) => {
    const data = parse(preferencesSchema, req.body);
    const patch = { updatedAt: nowIso() };
    if (data.notificationPreferences) patch.notificationPreferences = { ...NOTIFICATION_PREF_DEFAULTS, ...req.user.notificationPreferences, ...data.notificationPreferences };
    if (data.dailyUsageLimitLiters !== undefined) {
      patch.dailyUsageLimitLiters = data.dailyUsageLimitLiters;
      // A new limit can alert again today.
      patch.usageLimitNotices = {};
    }
    const updated = await db.update(C.users, req.user.id, patch);
    res.json({ user: publicUser(updated) });
  }),
);

const passwordSchema = z
  .object({ currentPassword: z.string().min(1, 'Current password is required'), newPassword: password, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

router.post(
  '/password',
  requireHomeowner,
  asyncHandler(async (req, res) => {
    const data = parse(passwordSchema, req.body);
    if (!(await bcrypt.compare(data.currentPassword, req.user.passwordHash))) {
      throw badRequest('Please correct the highlighted fields.', { fields: { currentPassword: 'Current password is incorrect' } });
    }
    // Bumping tokenVersion signs out every other session.
    const updated = await db.update(C.users, req.user.id, { passwordHash: await bcrypt.hash(data.newPassword, 12), tokenVersion: (req.user.tokenVersion ?? 0) + 1, passwordChangedAt: nowIso() });
    res.json(session(updated));
  }),
);

router.post(
  '/push-token',
  requireHomeowner,
  asyncHandler(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().regex(/^(Exponent|Expo)PushToken\[.+\]$/, 'Invalid Expo push token') }), req.body);
    const tokens = new Set(req.user.expoPushTokens ?? []);
    tokens.add(token);
    await db.update(C.users, req.user.id, { expoPushTokens: [...tokens].slice(-5) });
    res.json({ ok: true });
  }),
);

router.post(
  '/logout',
  requireHomeowner,
  asyncHandler(async (req, res) => {
    const token = req.body?.pushToken;
    if (token) await db.update(C.users, req.user.id, { expoPushTokens: (req.user.expoPushTokens ?? []).filter((t) => t !== token) });
    res.status(204).end();
  }),
);

export default router;
