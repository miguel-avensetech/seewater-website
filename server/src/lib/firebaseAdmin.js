// Firebase Admin SDK — trusted server environment only. Never import this from
// the admin website or the mobile app.

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getDatabase } from 'firebase-admin/database';
import { existsSync } from 'node:fs';
import { config } from '../config.js';

let firestore = null;

export function firebaseApp() {
  if (getApps().length) return getApps()[0];
  const { projectId, clientEmail, privateKey, serviceAccountPath, storageBucket, databaseURL, emulators } = config.firebase;

  let credential;
  if (projectId && clientEmail && privateKey) credential = cert({ projectId, clientEmail, privateKey });
  else if (serviceAccountPath) {
    if (!existsSync(serviceAccountPath)) {
      throw new Error(
        `Service-account key not found at ${serviceAccountPath}. Download it from Firebase console → Project settings → ` +
          'Service accounts → Generate new private key, and save it there (never commit it).',
      );
    }
    credential = applicationDefault();
  }
  else if (!emulators) {
    throw new Error(
      'Firebase credentials missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY ' +
        '(or GOOGLE_APPLICATION_CREDENTIALS) in server/.env — or run the Firebase Emulator Suite and set ' +
        'FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST / FIREBASE_STORAGE_EMULATOR_HOST.',
    );
  }
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is required.');
  return initializeApp({
    ...(credential && { credential }),
    projectId,
    storageBucket: storageBucket || `${projectId}.appspot.com`,
    databaseURL: databaseURL || `https://${projectId}-default-rtdb.firebaseio.com`,
  });
}

export const adminAuth = () => getAuth(firebaseApp());

export function adminFirestore() {
  if (!firestore) {
    firestore = getFirestore(firebaseApp());
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export const adminBucket = () => getStorage(firebaseApp()).bucket();

export const adminDatabase = () => getDatabase(firebaseApp());
