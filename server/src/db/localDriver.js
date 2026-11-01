// JSON-file document store for development and automated tests.
// Implements the same interface as the Firestore driver. Not for production use.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { matches, compareBy } from './query.js';

export function createLocalDriver({ file }) {
  const filePath = file === ':memory:' ? null : path.resolve(file);
  let data = {};

  if (filePath && fs.existsSync(filePath)) {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  let writeTimer = null;
  function persist() {
    if (!filePath) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushSync, 50);
  }
  function flushSync() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath);
  }

  const bucket = (name) => (data[name] ||= {});
  const clone = (v) => (v === undefined ? null : structuredClone(v));

  return {
    name: 'local',

    async get(collection, id) {
      const doc = bucket(collection)[id];
      return doc ? clone({ id, ...doc }) : null;
    },

    async list(collection, { where = [], orderBy, limit } = {}) {
      let docs = Object.entries(bucket(collection)).map(([id, doc]) => ({ id, ...doc }));
      docs = docs.filter((doc) => matches(doc, where));
      if (orderBy) docs.sort(compareBy(orderBy[0], orderBy[1]));
      if (limit) docs = docs.slice(0, limit);
      return clone(docs);
    },

    async create(collection, doc, id = crypto.randomUUID()) {
      bucket(collection)[id] = clone(doc);
      persist();
      return { id, ...clone(doc) };
    },

    async set(collection, id, doc) {
      bucket(collection)[id] = clone(doc);
      persist();
      return { id, ...clone(doc) };
    },

    async update(collection, id, patch) {
      const existing = bucket(collection)[id];
      if (!existing) return null;
      bucket(collection)[id] = { ...existing, ...clone(patch) };
      persist();
      return { id, ...clone(bucket(collection)[id]) };
    },

    async remove(collection, id) {
      const existed = Boolean(bucket(collection)[id]);
      delete bucket(collection)[id];
      persist();
      return existed;
    },

    async count(collection, opts) {
      return (await this.list(collection, opts)).length;
    },

    async reset() {
      data = {};
      flushSync();
    },

    async close() {
      clearTimeout(writeTimer);
      flushSync();
    },
  };
}
