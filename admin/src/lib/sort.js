// Comparator for client-side table sorting; nulls always sort last.
export function compareBy(key, order = 'asc') {
  const dir = order === 'desc' ? -1 : 1;
  return (a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === y) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string') return x.localeCompare(y) * dir;
    return (x < y ? -1 : 1) * dir;
  };
}
