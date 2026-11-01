'use client';

import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { firebase, storageEnabled } from './firebase';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const ATTACHMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'];

/**
 * Uploads a file to Firebase Storage (rules enforce who may write where, type and
 * size) and returns metadata to store in Firestore via the API.
 */
export function uploadFile(path, file, { onProgress } = {}) {
  const { storage, auth } = firebase();
  if (!storageEnabled || !storage) return Promise.reject(new Error('File uploads are not enabled (Firebase Storage is not set up for this project).'));
  if (!auth.currentUser) {
    return Promise.reject(new Error('Your Firebase session has ended. Sign out and sign in again to upload files.'));
  }
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err.code === 'storage/unauthorized' ? new Error('Upload rejected: check the file type and size, and that you are signed in as an administrator.') : err),
      async () => {
        resolve({ url: await getDownloadURL(task.snapshot.ref), path, name: file.name, contentType: file.type, size: file.size });
      },
    );
  });
}

export function validateFile(file, { types, maxBytes }) {
  if (!file) return 'Choose a file';
  if (!types.includes(file.type)) return `Unsupported file type. Allowed: ${types.map((t) => t.split('/')[1].toUpperCase()).join(', ')}`;
  if (file.size > maxBytes) return `File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`;
  return null;
}

export const safeName = (name) => name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').slice(-80);

export function fmtBytes(n) {
  if (n == null) return '';
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
