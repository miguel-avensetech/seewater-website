// Shared in-memory query helpers used by the local driver (and by services that
// refine Firestore results without requiring composite indexes).

const OPS = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

export function matches(doc, where = []) {
  return where.every(([field, op, value]) => {
    const fn = OPS[op];
    if (!fn) throw new Error(`Unsupported operator: ${op}`);
    return fn(doc[field], value);
  });
}

export function compareBy(field, direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    const x = a[field];
    const y = b[field];
    if (x === y) return 0;
    if (x === undefined || x === null) return 1;
    if (y === undefined || y === null) return -1;
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y) * dir;
    return (x < y ? -1 : 1) * dir;
  };
}
