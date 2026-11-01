import { compareBy } from '../db/query.js';

// Applies text search, sorting and pagination to an in-memory list and returns
// the standard list response shape used by every collection endpoint.
export function paginate(items, { q, searchFields = [], sort, order = 'desc', page = 1, pageSize = 10, allowedSorts }) {
  let rows = items;

  if (q && searchFields.length) {
    const needle = q.toLowerCase();
    rows = rows.filter((row) =>
      searchFields.some((f) => String(row[f] ?? '').toLowerCase().includes(needle)),
    );
  }

  if (sort && (!allowedSorts || allowedSorts.includes(sort))) {
    rows = [...rows].sort(compareBy(sort, order));
  }

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;

  return {
    items: rows.slice(start, start + pageSize),
    page: current,
    pageSize,
    total,
    totalPages,
  };
}
