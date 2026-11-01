'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { firebase, firebaseConfigured } from '@/lib/firebase';

// Real-time change signals.
//   Realtime Database  /live/devices  → device status, latest readings, valve state
//                      /live/alerts   → open / acknowledged alerts
//   Firestore          newest system log
// The API keeps /live current; pages refresh from the API when a signal fires.
// Security rules allow admins to read and nobody to write. Listeners are
// unsubscribed on sign-out and unmount; pages fall back to polling without them.

const LiveContext = createContext({ live: false, connected: {}, versions: {}, snapshot: {} });

export function LiveProvider({ children }) {
  const [versions, setVersions] = useState({});
  const [connected, setConnected] = useState({});
  const [snapshot, setSnapshot] = useState({ devices: null, alerts: null });

  useEffect(() => {
    if (!firebaseConfigured) return undefined;
    const { auth, db, rtdb } = firebase();
    let unsubs = [];
    const stop = () => {
      unsubs.forEach((u) => u());
      unsubs = [];
      setConnected({});
    };
    const bump = (...names) => setVersions((v) => Object.fromEntries([...Object.entries(v), ...names.map((n) => [n, (v[n] ?? 0) + 1])]));
    const ok = (...names) => setConnected((c) => ({ ...c, ...Object.fromEntries(names.map((n) => [n, true])) }));
    const fail = (...names) => setConnected((c) => ({ ...c, ...Object.fromEntries(names.map((n) => [n, false])) }));

    const offAuth = onAuthStateChanged(auth, async (user) => {
      stop();
      if (!user) return;
      const { claims } = await user.getIdTokenResult();
      if (claims.role !== 'admin') return;

      let firstDevices = true;
      unsubs.push(
        onValue(
          ref(rtdb, 'live/devices'),
          (snap) => {
            ok('devices', 'readings');
            setSnapshot((s) => ({ ...s, devices: snap.val() ?? {} }));
            if (firstDevices) firstDevices = false;
            else bump('devices', 'readings');
          },
          () => fail('devices', 'readings'),
        ),
      );
      let firstAlerts = true;
      unsubs.push(
        onValue(
          ref(rtdb, 'live/alerts'),
          (snap) => {
            ok('alerts');
            setSnapshot((s) => ({ ...s, alerts: snap.val() ?? {} }));
            if (firstAlerts) firstAlerts = false;
            else bump('alerts');
          },
          () => fail('alerts'),
        ),
      );
      let firstLog = true;
      unsubs.push(
        onSnapshot(
          query(collection(db, 'systemLogs'), orderBy('createdAt', 'desc'), limit(1)),
          () => {
            ok('logs');
            if (firstLog) firstLog = false;
            else bump('logs');
          },
          () => fail('logs'),
        ),
      );
    });

    return () => {
      offAuth();
      stop();
    };
  }, []);

  const value = useMemo(() => ({ live: Object.values(connected).some(Boolean), connected, versions, snapshot }), [connected, versions, snapshot]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export const useLiveStatus = () => useContext(LiveContext);

/**
 * Returns { liveKey, live } for the given sources. Pass liveKey to useApi so the
 * page silently refreshes when any of those sources change.
 */
export function useLive(sources) {
  const { versions, connected } = useContext(LiveContext);
  return {
    liveKey: sources.map((s) => versions[s] ?? 0).join('.'),
    live: sources.every((s) => connected[s]),
  };
}
