'use client';

// Firebase client SDK for the admin website.
// • Auth: admin sign-in (email/password), password reset and password change.
// • Firestore: read-only live listeners (security rules allow admins to read only).
// • Storage: profile pictures and announcement attachments.
// All values are public web-app config (NEXT_PUBLIC_*); no secrets live here.

import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Firebase Storage needs the Blaze plan for new projects; uploads are hidden until enabled.
export const storageEnabled = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_ENABLED === 'true';

const useEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || '127.0.0.1';

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let services = null;

export function firebase() {
  if (services) return services;
  if (!firebaseConfigured) {
    throw new Error('Firebase is not configured. Copy admin/.env.example to admin/.env.local and fill in your Firebase web app settings.');
  }
  const app = getApps()[0] ?? initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = storageEnabled ? getStorage(app) : null;
  const rtdb = getDatabase(app);
  if (useEmulators && !auth.emulatorConfig) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
    connectDatabaseEmulator(rtdb, emulatorHost, 9000);
    if (storage) connectStorageEmulator(storage, emulatorHost, 9199);
  }
  setPersistence(auth, browserLocalPersistence).catch(() => {});
  services = { app, auth, db, storage, rtdb };
  return services;
}

// Firebase Auth error codes → messages for admins.
export function authErrorMessage(err) {
  switch (err?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Incorrect email or password.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes or reset your password.';
    case 'auth/network-request-failed':
      return 'Cannot reach Firebase. Check your connection and try again.';
    case 'auth/weak-password':
      return 'Choose a stronger password (at least 10 characters with letters and numbers).';
    case 'auth/requires-recent-login':
      return 'For security, please sign in again and retry.';
    default:
      return err?.message || 'Something went wrong. Please try again.';
  }
}
