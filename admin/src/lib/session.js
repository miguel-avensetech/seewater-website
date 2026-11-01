'use client';

import { EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
import { api } from './api';
import { firebase } from './firebase';

// Exchanges the signed-in Firebase user's fresh ID token for the server's
// httpOnly session cookie. The server checks the admin custom claim.
async function createServerSession(user) {
  const idToken = await user.getIdToken(true);
  return api('/auth/session', { method: 'POST', body: { idToken } });
}

export async function signInAdmin(email, password) {
  const { auth } = firebase();
  const cred = await signInWithEmailAndPassword(auth, email, password);
  try {
    return await createServerSession(cred.user);
  } catch (err) {
    // Not an administrator (or disabled): don't leave a Firebase session behind.
    await signOut(auth).catch(() => {});
    throw err;
  }
}

export async function signOutAdmin() {
  try {
    await api('/auth/logout', { method: 'POST' });
  } finally {
    await signOut(firebase().auth).catch(() => {});
  }
}

export function sendPasswordReset(email) {
  return sendPasswordResetEmail(firebase().auth, email);
}

// Firebase revokes existing sessions when the password changes, so a new
// server session is created right after.
export async function changeAdminPassword(currentPassword, newPassword) {
  const { auth } = firebase();
  const user = auth.currentUser;
  if (!user) {
    const err = new Error('Please sign out and sign in again before changing your password.');
    err.code = 'auth/requires-recent-login';
    throw err;
  }
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, newPassword);
  await createServerSession(user);
  await api('/auth/password-changed', { method: 'POST' }).catch(() => {});
}
