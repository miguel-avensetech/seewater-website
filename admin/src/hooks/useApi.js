'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Loads `path` (with optional query) and exposes { data, error, loading, reload }.
 * `refreshMs` re-fetches silently in the background (used by live monitoring).
 * Pass path = null to skip loading.
 */
export function useApi(path, { query, refreshMs, liveKey } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  const controller = useRef(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!path) return;
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      if (!silent) setLoading(true);
      try {
        const json = await api(path, { query, signal: ac.signal });
        setData(json);
        setError(null);
      } catch (err) {
        if (err.name !== 'AbortError') setError(err);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    load();
    return () => controller.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !path) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load({ silent: true });
    }, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs, path]);

  // Firestore change signal (see LiveProvider): refresh at most every 3 s.
  const lastLive = useRef(liveKey);
  const liveTimer = useRef(null);
  useEffect(() => {
    if (!path || liveKey === undefined || liveKey === lastLive.current) return;
    lastLive.current = liveKey;
    if (liveTimer.current) return; // a refresh is already scheduled
    liveTimer.current = setTimeout(() => {
      liveTimer.current = null;
      load({ silent: true });
    }, 3000);
  }, [liveKey, load, path]);
  useEffect(() => () => clearTimeout(liveTimer.current), []);

  // A path that has just been enabled counts as loading until its first response.
  const pending = Boolean(path) && data === null && error === null;
  return { data, error, loading: loading || pending, reload: load, setData };
}
