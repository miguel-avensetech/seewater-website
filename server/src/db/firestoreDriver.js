// Cloud Firestore driver (firebase-admin). This is the production database.
//
// Query note: to avoid requiring composite indexes, services only combine one
// equality filter OR one range filter with an orderBy on the same field. Any
// further narrowing is done in memory by the service layer.

import { Timestamp } from 'firebase-admin/firestore';
import { config } from '../config.js';
import { adminFirestore } from '../lib/firebaseAdmin.js';

// Timestamps (e.g. TTL `expireAt`) are returned as ISO strings like every other date.
const plain = (data) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Timestamp ? v.toDate().toISOString() : v]));

export function createFirestoreDriver() {
  const db = adminFirestore();

  const toDoc = (snap) => (snap.exists ? { id: snap.id, ...plain(snap.data()) } : null);

  return {
    name: 'firestore',

    async get(collection, id) {
      return toDoc(await db.collection(collection).doc(id).get());
    },

    async list(collection, { where = [], orderBy, limit } = {}) {
      let q = db.collection(collection);
      for (const [field, op, value] of where) q = q.where(field, op, value);
      if (orderBy) q = q.orderBy(orderBy[0], orderBy[1] || 'asc');
      if (limit) q = q.limit(limit);
      const snap = await q.get();
      return snap.docs.map(toDoc);
    },

    async create(collection, doc, id) {
      const ref = id ? db.collection(collection).doc(id) : db.collection(collection).doc();
      await ref.set(doc);
      return { id: ref.id, ...doc };
    },

    async set(collection, id, doc) {
      await db.collection(collection).doc(id).set(doc);
      return { id, ...doc };
    },

    async update(collection, id, patch) {
      const ref = db.collection(collection).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return null;
      await ref.update(patch);
      return { id, ...snap.data(), ...patch };
    },

    async remove(collection, id) {
      const ref = db.collection(collection).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return false;
      await ref.delete();
      return true;
    },

    async count(collection, { where = [] } = {}) {
      let q = db.collection(collection);
      for (const [field, op, value] of where) q = q.where(field, op, value);
      const snap = await q.count().get();
      return snap.data().count;
    },

    // Emulator only: wipes all documents (used by tests and `seed --reset`).
    async reset() {
      const host = process.env.FIRESTORE_EMULATOR_HOST;
      if (!host) throw new Error('reset() is only available against the Firestore emulator.');
      const projectId = config.firebase.projectId;
      const res = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Emulator reset failed: ${res.status}`);
    },

    async close() {},
  };
}
