import clsx from 'clsx';
import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

const control =
  'block w-full rounded-lg border bg-surface text-sm text-ink placeholder:text-faint transition-colors focus:outline-none focus:ring-2 focus:ring-ocean-500/30 disabled:bg-canvas disabled:text-muted';
const state = (error) => (error ? 'border-crit-600 focus:border-crit-600' : 'border-line-strong focus:border-ocean-500');

// Label + control + hint/error wrapper. Children receive id/aria props via render prop.
export function Field({ label, hint, error, required, className, children }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-semibold text-ink-soft">
          {label}
          {required && <span className="ml-0.5 text-crit-600" aria-hidden>*</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-crit-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, required, className, suffix, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => (
        <div className="relative">
          <input {...a11y} required={required} className={clsx(control, state(error), 'h-10 px-3', suffix && 'pr-14')} {...props} />
          {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted">{suffix}</span>}
        </div>
      )}
    </Field>
  );
}

export function Textarea({ label, hint, error, required, className, rows = 4, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => <textarea {...a11y} rows={rows} required={required} className={clsx(control, state(error), 'px-3 py-2')} {...props} />}
    </Field>
  );
}

export function Select({ label, hint, error, required, className, options = [], placeholder, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => (
        <div className="relative">
          <select {...a11y} required={required} className={clsx(control, state(error), 'h-10 appearance-none pl-3 pr-9')} {...props}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      )}
    </Field>
  );
}

// Compact select for filter bars (no label row).
export function FilterSelect({ value, onChange, options, placeholder, label, className }) {
  return (
    <div className={clsx('relative', className)}>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(control, 'h-9 appearance-none border-line-strong pl-3 pr-8 text-[13px]', value && 'border-ocean-500/60 bg-ocean-50/50 text-ocean-800')}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-ocean-600' : 'bg-slate-300',
        )}
      >
        <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}
