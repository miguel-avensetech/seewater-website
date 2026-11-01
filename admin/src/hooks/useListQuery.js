'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from './useApi';
import { useAuth } from '@/components/layout/AuthProvider';

/**
 * State for server-side search / filter / sort / pagination lists.
 * The search box is debounced; any filter change resets to page 1.
 */
export function useListQuery(path, { initial = {}, pageSize: fixedPageSize, refreshMs, liveKey } = {}) {
  const { admin } = useAuth();
  const pageSize = fixedPageSize ?? admin.preferences?.rowsPerPage ?? 10;
  const [params, setParams] = useState({ q: '', sort: undefined, order: 'desc', page: 1, pageSize, ...initial });
  const [search, setSearch] = useState(params.q);

  useEffect(() => {
    const t = setTimeout(() => setParams((p) => (p.q === search ? p : { ...p, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => params, [params]);
  const result = useApi(path, { query, refreshMs, liveKey });

  return {
    ...result,
    params,
    search,
    setSearch,
    setFilter: (name, value) => setParams((p) => ({ ...p, [name]: value || undefined, page: 1 })),
    setPage: (page) => setParams((p) => ({ ...p, page })),
    setPageSize: (size) => setParams((p) => ({ ...p, pageSize: size, page: 1 })),
    toggleSort: (key) =>
      setParams((p) => ({ ...p, sort: key, order: p.sort === key && p.order === 'desc' ? 'asc' : 'desc', page: 1 })),
    clearFilters: () => {
      setSearch('');
      setParams({ q: '', sort: undefined, order: 'desc', page: 1, pageSize, ...initial });
    },
  };
}
