'use client';

import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from './Button';

export function Modal({ open, onClose, title, description, children, footer, size = 'md', busy = false }) {
  const titleId = useId();
  const panel = useRef(null);
  // Refs keep the focus effect from re-running (and stealing focus) on every parent render.
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busyRef.current) closeRef.current();
      if (e.key === 'Tab' && panel.current) {
        const focusables = panel.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const target = panel.current?.querySelector('[data-autofocus], input:not([disabled]), select, textarea') || panel.current;
      target?.focus();
    }, 10);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-navy-950/45 backdrop-blur-[2px]" onClick={() => !busy && onClose()} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(
          'relative flex max-h-[92vh] w-full animate-pop-in flex-col rounded-t-2xl bg-surface shadow-pop outline-none sm:rounded-2xl',
          { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl' }[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={busy} aria-label="Close dialog" icon={X} />
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/60 px-5 py-3 sm:flex-row sm:justify-end">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation for destructive or high-impact actions (delete, water shutoff).
 * `confirmText` requires the admin to type a phrase before confirming.
 */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'danger', confirmText, children }) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      setError(null);
    }
  }, [open]);

  async function handle() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const blocked = confirmText && typed.trim().toUpperCase() !== confirmText.toUpperCase();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={handle} loading={busy} disabled={blocked} data-autofocus={!confirmText || undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        {tone === 'danger' && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crit-50 text-crit-600">
            <AlertTriangle className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0 space-y-3 text-sm text-ink-soft">
          {typeof message === 'string' ? <p>{message}</p> : message}
          {children}
          {confirmText && (
            <label className="block">
              <span className="text-[13px] text-muted">
                Type <strong className="font-mono text-ink">{confirmText}</strong> to confirm
              </span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1.5 block h-10 w-full rounded-lg border border-line-strong px-3 font-mono text-sm uppercase focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30" autoComplete="off" />
            </label>
          )}
          {error && <p className="rounded-lg bg-crit-50 px-3 py-2 text-[13px] font-medium text-crit-700" role="alert">{error}</p>}
        </div>
      </div>
    </Modal>
  );
}
