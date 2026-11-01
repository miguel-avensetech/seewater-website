'use client';

import { useCallback, useState } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Minimal form state with client validation and server field-error mapping.
 * validate(values) returns { field: message } for invalid fields.
 */
export function useForm(initialValues, { validate, onSubmit } = {}) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const set = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }, []);

  // Props for <Input>/<Select>/<Textarea>: value, onChange, error.
  const bind = (name) => ({
    name,
    value: values[name] ?? '',
    error: errors[name],
    onChange: (e) => set(name, e.target.value),
  });

  const reset = useCallback((next = initialValues) => {
    setValues(next);
    setErrors({});
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setFormError(null);
    const clientErrors = validate ? Object.fromEntries(Object.entries(validate(values) || {}).filter(([, v]) => v)) : {};
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return false;
    setSubmitting(true);
    try {
      await onSubmit(values);
      return true;
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      setFormError(err.message || 'Something went wrong');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  return { values, setValues, set, bind, errors, setErrors, formError, submitting, handleSubmit, reset };
}

export const rules = {
  required: (v, label = 'This field') => (v === undefined || v === null || String(v).trim() === '' ? `${label} is required` : null),
  email: (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Enter a valid email address' : null),
  minLen: (v, n) => (v && String(v).trim().length < n ? `Must be at least ${n} characters` : null),
  number: (v, { min, max } = {}) => {
    if (v === '' || v === null || v === undefined) return 'Required';
    const n = Number(v);
    if (!Number.isFinite(n)) return 'Enter a number';
    if (min !== undefined && n < min) return `Minimum ${min}`;
    if (max !== undefined && n > max) return `Maximum ${max}`;
    return null;
  },
};
