import { z } from 'zod';
import { badRequest } from './errors.js';

export { z };

// Parses and returns validated data, or throws a 400 with field-level messages.
export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    fields[key] ||= issue.message;
  }
  throw badRequest('Please correct the highlighted fields.', { fields });
}

export const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

export const trimmed = (min = 1, max = 200) =>
  z.string().trim().min(min, min === 1 ? 'Required' : `Must be at least ${min} characters`).max(max);

// Common list query params: search, sort, order, page, pageSize.
export const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(50).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
