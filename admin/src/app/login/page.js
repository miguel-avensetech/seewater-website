'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, Activity, Waves, BellRing } from 'lucide-react';
import { authErrorMessage, firebaseConfigured } from '@/lib/firebase';
import { sendPasswordReset, signInAdmin } from '@/lib/session';
import { Modal } from '@/components/ui/Modal';
import { useForm, rules } from '@/hooks/useForm';
import { Button } from '@/components/ui/Button';
import { InlineNotice } from '@/components/ui/States';
import { Wordmark } from '@/components/layout/Logo';
import clsx from 'clsx';

function ResetPasswordDialog({ open, onClose, initialEmail }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ busy: false, sent: false, error: null });
  useEffect(() => {
    if (open) {
      setEmail(initialEmail || '');
      setState({ busy: false, sent: false, error: null });
    }
  }, [open, initialEmail]);

  async function submit(e) {
    e.preventDefault();
    const bad = rules.required(email, 'Email') || rules.email(email);
    if (bad) return setState({ busy: false, sent: false, error: bad });
    setState({ busy: true, sent: false, error: null });
    try {
      await sendPasswordReset(email.trim());
      setState({ busy: false, sent: true, error: null });
    } catch (err) {
      // Don't reveal whether an account exists.
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') setState({ busy: false, sent: true, error: null });
      else setState({ busy: false, sent: false, error: authErrorMessage(err) });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Reset your password"
      description="We’ll email you a link to choose a new password."
      footer={
        state.sent ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="reset-form" loading={state.busy}>Send reset link</Button>
          </>
        )
      }
    >
      {state.sent ? (
        <InlineNotice tone="ok" title="Check your inbox">
          If an account exists for {email}, a password reset link is on its way.
        </InlineNotice>
      ) : (
        <form id="reset-form" onSubmit={submit} noValidate className="space-y-3">
          <label htmlFor="reset-email" className="block text-[13px] font-semibold text-ink-soft">Email address</label>
          <input id="reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="block h-11 w-full rounded-lg border border-line-strong px-3 text-sm focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-500/30" autoComplete="email" />
          {state.error && <p className="text-xs font-medium text-crit-700" role="alert">{state.error}</p>}
        </form>
      )}
    </Modal>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [show, setShow] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const form = useForm(
    { email: '', password: '' },
    {
      validate: (v) => ({ email: rules.required(v.email, 'Email') || rules.email(v.email), password: rules.required(v.password, 'Password') }),
      onSubmit: async (v) => {
        try {
          await signInAdmin(v.email.trim(), v.password);
        } catch (err) {
          // Firebase Auth errors carry a code like "auth/invalid-credential".
          if (err.code?.startsWith('auth/')) throw new Error(authErrorMessage(err));
          throw err;
        }
        router.replace(safeNext);
        router.refresh();
      },
    },
  );

  const fieldCls = (err) =>
    clsx(
      'block h-11 w-full rounded-lg border bg-surface pl-10 text-sm text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-ocean-500/30',
      err ? 'border-crit-600' : 'border-line-strong focus:border-ocean-500',
    );

  return (
    <form onSubmit={form.handleSubmit} noValidate className="space-y-5">
      {!firebaseConfigured && (
        <InlineNotice tone="warn" title="Firebase is not configured">
          Add your Firebase web app settings to <code>admin/.env.local</code> (see <code>.env.example</code>) and restart the dashboard.
        </InlineNotice>
      )}
      {params.get('expired') && !form.formError && (
        <InlineNotice tone="warn" title="Session ended">
          Please sign in again to continue.
        </InlineNotice>
      )}
      {form.formError && (
        <InlineNotice tone="crit" title="Sign-in failed">
          {form.formError}
        </InlineNotice>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[13px] font-semibold text-ink-soft">
          Email address
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <input id="email" type="email" autoComplete="username" autoFocus placeholder="admin@mcwd.gov.ph" aria-invalid={!!form.errors.email} aria-describedby={form.errors.email ? 'email-err' : undefined} className={fieldCls(form.errors.email)} {...form.bind('email')} />
        </div>
        {form.errors.email && <p id="email-err" className="text-xs font-medium text-crit-700">{form.errors.email}</p>}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="block text-[13px] font-semibold text-ink-soft">
            Password
          </label>
          <button type="button" onClick={() => setResetOpen(true)} className="text-[13px] font-semibold text-ocean-700 hover:underline">
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" aria-hidden />
          <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••••" aria-invalid={!!form.errors.password} aria-describedby={form.errors.password ? 'pw-err' : undefined} className={clsx(fieldCls(form.errors.password), 'pr-11')} {...form.bind('password')} />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-faint hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {form.errors.password && <p id="pw-err" className="text-xs font-medium text-crit-700">{form.errors.password}</p>}
      </div>

      <Button type="submit" className="h-11 w-full" loading={form.submitting} disabled={!firebaseConfigured}>
        {form.submitting ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-ok-600" aria-hidden />
        Authorized MCWD administrators only. Activity is logged.
      </p>
      <ResetPasswordDialog open={resetOpen} onClose={() => setResetOpen(false)} initialEmail={form.values.email} />
    </form>
  );
}

const features = [
  { icon: Activity, title: 'Live flow monitoring', text: 'Household flow rates and consumption from ESP32 sensor gateways.' },
  { icon: Waves, title: 'Vibration-based leak detection', text: 'Piezo sensors checked against calibrated environmental baselines.' },
  { icon: BellRing, title: 'Alerts and remote shutoff', text: 'High-flow and leak alerts with device-confirmed valve control.' },
];
``
export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="ripple-bg relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col">
        <Wordmark light />
        <div className="my-auto max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-aqua-400">Smart residential water management</p>
          <h1 className="mt-3 text-[34px] font-bold leading-tight tracking-tight">See every liter. Catch every leak.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">Monitor connected households, calibrate sensors, and respond to abnormal water use from one console.</p>
          <ul className="mt-10 space-y-5">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] ring-1 ring-white/10">
                  <Icon className="h-5 w-5 text-aqua-400" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-[13px] text-white/55">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/40">SeeWater · IoT-Powered App for Smart Water Usage and Leak Detection</p>
      </aside>

      <main className="flex items-center justify-center bg-surface px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-ink">Welcome back</h2>
          <p className="mb-8 mt-1.5 text-sm text-muted">Sign in to the SeeWater administration console.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
