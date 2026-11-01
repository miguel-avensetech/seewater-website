// Central runtime configuration. All secrets come from the environment (.env),
// never from source code or the frontend bundle.

const env = process.env;

function required(name, fallbackForDev) {
  const value = env[name];
  if (value) return value;
  if (env.NODE_ENV !== 'production' && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProduction: env.NODE_ENV === 'production',
  port: Number(env.PORT || 4000),

  // "firestore" (default, production) or "local" (JSON file, development/testing only).
  dbDriver: (env.DB_DRIVER || 'firestore').toLowerCase(),
  localDbFile: env.LOCAL_DB_FILE || 'data/local-db.json',
  firebase: {
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    // Private keys pasted into .env usually carry escaped newlines.
    privateKey: env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    serviceAccountPath: env.GOOGLE_APPLICATION_CREDENTIALS,
    storageBucket: env.FIREBASE_STORAGE_BUCKET,
    // Realtime Database holds live state (current readings, device status, active alerts, valves).
    databaseURL: env.FIREBASE_DATABASE_URL,
    // Storage is optional (requires the Blaze plan for new projects).
    storageEnabled: env.FIREBASE_STORAGE_ENABLED !== 'false',
    // When these are set (Firebase Emulator Suite), the Admin SDK talks to the
    // local emulators and no service-account credentials are needed.
    emulators: Boolean(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST),
  },

  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  // Admin sessions are Firebase session cookies (5 min – 14 days).
  sessionHours: Math.min(Math.max(Number(env.SESSION_HOURS || 8), 1), 336),
  cookieName: 'sw_session',
  // Device activation codes expire if unused for this many days.
  activationCodeDays: Number(env.ACTIVATION_CODE_DAYS || 30),
  // Raw sensor readings get an expireAt for a Firestore TTL policy; daily
  // summaries (waterUsage) are kept.
  readingRetentionDays: Number(env.READING_RETENTION_DAYS || 90),

  // Homeowner (mobile app) sessions use bearer tokens with their own audience,
  // so they can never be accepted by admin routes.
  homeownerAudience: 'seewater-homeowner',
  homeownerSessionDays: Number(env.HOMEOWNER_SESSION_DAYS || 30),

  // Outgoing email (verification codes). Without SMTP settings, codes are
  // printed to the server console in development only.
  smtp: {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.MAIL_FROM || 'SeeWater <no-reply@seewater.local>',
  },

  // Expo push notifications (https://docs.expo.dev/push-notifications/sending-notifications/).
  pushEnabled: env.PUSH_ENABLED !== 'false' && env.NODE_ENV !== 'test',
  expoAccessToken: env.EXPO_ACCESS_TOKEN,

  // A device is considered connected if it reported within this window.
  deviceOnlineWindowMinutes: Number(env.DEVICE_ONLINE_WINDOW_MINUTES || 5),
};
