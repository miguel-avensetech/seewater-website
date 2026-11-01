'use client';

import { useEffect, useRef, useState } from 'react';
import { BellRing, Eye, EyeOff, KeyRound, Moon, Save, SlidersHorizontal, Trash2, Upload, UserCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useForm, rules } from '@/hooks/useForm';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DescriptionList, PageHeader, Tabs } from '@/components/ui/Layout';
import { Input, Select, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ErrorState, InlineNotice, PageLoader } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime, initials } from '@/lib/format';
import { authErrorMessage, storageEnabled } from '@/lib/firebase';
import { changeAdminPassword } from '@/lib/session';
import { IMAGE_TYPES, safeName, uploadFile, validateFile } from '@/lib/upload';
import { lookup, ROLE } from '@/lib/labels';
import { useTheme } from '@/lib/theme';

function AvatarUploader() {
  const { admin, setAdmin } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = validateFile(file, { types: IMAGE_TYPES, maxBytes: 2 * 1024 * 1024 });
    if (problem) return setError(problem);
    setError(null);
    setProgress(0);
    try {
      const up = await uploadFile(`admins/${admin.id}/avatar-${Date.now()}-${safeName(file.name)}`, file, { onProgress: setProgress });
      const { admin: updated } = await api('/auth/profile', { method: 'PATCH', body: { fullName: admin.fullName, department: admin.department ?? '', phone: admin.phone ?? '', photoURL: up.url, photoPath: up.path } });
      setAdmin(updated);
      toast.success('Profile picture updated');
    } catch (err) {
      setError(err.message);
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    try {
      const { admin: updated } = await api('/auth/profile', { method: 'PATCH', body: { fullName: admin.fullName, department: admin.department ?? '', phone: admin.phone ?? '', photoURL: null, photoPath: null } });
      setAdmin(updated);
      toast.success('Profile picture removed');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {admin.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={admin.photoURL} alt="Your profile picture" className="h-16 w-16 rounded-full object-cover ring-2 ring-ocean-100" />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-aqua-400 to-ocean-600 text-lg font-bold text-white">{initials(admin.fullName)}</span>
      )}
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={pick} aria-label="Upload profile picture" />
          <Button size="sm" variant="secondary" icon={Upload} loading={progress !== null} onClick={() => input.current?.click()}>
            {progress !== null ? `Uploading ${progress}%` : admin.photoURL ? 'Change picture' : 'Upload picture'}
          </Button>
          {admin.photoURL && progress === null && <Button size="sm" variant="ghost" icon={Trash2} onClick={remove}>Remove</Button>}
        </div>
        <p className="text-xs text-muted">PNG, JPG or WebP, up to 2 MB. Stored in Firebase Storage.</p>
        {error && <p className="text-xs font-medium text-crit-700" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function ProfileSection() {
  const { admin, setAdmin } = useAuth();
  const toast = useToast();
  const form = useForm(
    { fullName: admin.fullName ?? '', department: admin.department ?? '', phone: admin.phone ?? '' },
    {
      validate: (v) => ({ fullName: rules.required(v.fullName, 'Full name') || rules.minLen(v.fullName, 2) }),
      onSubmit: async (v) => {
        const { admin: updated } = await api('/auth/profile', { method: 'PATCH', body: v });
        setAdmin(updated);
        toast.success('Profile updated');
      },
    },
  );

  return (
    <Card>
      <CardHeader icon={UserCircle2} title="Admin profile" description="Your name and contact details as shown in logs and announcements." />
      <CardBody className="space-y-6">
        {storageEnabled ? <AvatarUploader /> : <p className="text-[13px] text-muted">Profile pictures need Firebase Storage, which isn’t enabled for this project. Your initials are shown instead.</p>}
        <DescriptionList
          columns={3}
          items={[
            { label: 'Role', value: lookup(ROLE, admin.role).label },
            { label: 'Last sign-in', value: fmtDateTime(admin.lastLoginAt) },
            { label: 'Account created', value: fmtDateTime(admin.createdAt) },
          ]}
        />
        <form onSubmit={form.handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit" className="sm:col-span-2">{form.formError}</InlineNotice>}
          <Input label="Full name" required {...form.bind('fullName')} />
          <Input label="Email" type="email" value={admin.email} disabled hint="Your Firebase sign-in email. Ask a super admin to change it." />
          <Input label="Department" placeholder="e.g. Operations" {...form.bind('department')} />
          <Input label="Phone" type="tel" {...form.bind('phone')} />
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" icon={Save} loading={form.submitting}>Save profile</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function PasswordSection() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const form = useForm(
    { currentPassword: '', newPassword: '', confirmPassword: '' },
    {
      validate: (v) => ({
        currentPassword: rules.required(v.currentPassword, 'Current password'),
        newPassword: !v.newPassword ? 'New password is required' : v.newPassword.length < 10 ? 'Use at least 10 characters' : !/[A-Za-z]/.test(v.newPassword) || !/\d/.test(v.newPassword) ? 'Include letters and numbers' : null,
        confirmPassword: v.confirmPassword !== v.newPassword ? 'Passwords do not match' : null,
      }),
      onSubmit: async (v) => {
        try {
          await changeAdminPassword(v.currentPassword, v.newPassword);
        } catch (err) {
          if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
            form.setErrors({ currentPassword: 'Current password is incorrect' });
            throw new Error('Current password is incorrect');
          }
          if (err.code?.startsWith('auth/')) throw new Error(authErrorMessage(err));
          throw err;
        }
        toast.success('Password changed', 'Other signed-in sessions have been signed out.');
        form.reset();
      },
    },
  );
  const type = show ? 'text' : 'password';

  return (
    <Card>
      <CardHeader
        icon={KeyRound}
        title="Change password"
        description="Managed by Firebase Authentication. At least 10 characters with letters and numbers."
        actions={<Button size="sm" variant="ghost" icon={show ? EyeOff : Eye} onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? 'Hide' : 'Show'}</Button>}
      />
      <CardBody>
        <form onSubmit={form.handleSubmit} noValidate className="grid max-w-xl gap-4">
          {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
          <Input label="Current password" type={type} autoComplete="current-password" {...form.bind('currentPassword')} />
          <Input label="New password" type={type} autoComplete="new-password" {...form.bind('newPassword')} />
          <Input label="Confirm new password" type={type} autoComplete="new-password" {...form.bind('confirmPassword')} />
          <div className="flex justify-end">
            <Button type="submit" loading={form.submitting}>Update password</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, explicit, setTheme } = useTheme();
  return (
    <Card className="mb-6">
      <CardHeader icon={Moon} title="Appearance" description="Saved in this browser. Applies to the whole console, including the sign-in page." />
      <CardBody className="max-w-xl space-y-3">
        <Switch checked={theme === 'dark'} onChange={(on) => setTheme(on ? 'dark' : 'light')} label="Dark mode" description={explicit ? 'You chose this theme.' : 'Currently following your system setting.'} />
        {explicit && (
          <button type="button" onClick={() => setTheme(null)} className="text-[13px] font-semibold text-ocean-700 hover:underline">
            Use system setting instead
          </button>
        )}
      </CardBody>
    </Card>
  );
}

function PreferencesSection() {
  const { admin, setAdmin } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState({ defaultUsagePeriod: 'daily', rowsPerPage: 10, ...admin.preferences });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const { admin: updated } = await api('/auth/preferences', { method: 'PATCH', body: { defaultUsagePeriod: prefs.defaultUsagePeriod, rowsPerPage: Number(prefs.rowsPerPage) } });
      setAdmin(updated);
      toast.success('Preferences saved');
    } catch (err) {
      toast.error('Could not save preferences', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader icon={SlidersHorizontal} title="Account preferences" description="Applied across the dashboard for your account." />
      <CardBody className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Select label="Default usage view" options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} value={prefs.defaultUsagePeriod} onChange={(e) => setPrefs((p) => ({ ...p, defaultUsagePeriod: e.target.value }))} />
        <Select label="Rows per page" options={[10, 25, 50].map((n) => ({ value: n, label: `${n} rows` }))} value={prefs.rowsPerPage} onChange={(e) => setPrefs((p) => ({ ...p, rowsPerPage: Number(e.target.value) }))} />
        <div className="flex justify-end sm:col-span-2">
          <Button icon={Save} loading={busy} onClick={save}>Save preferences</Button>
        </div>
      </CardBody>
    </Card>
  );
}

const num = (v, o) => rules.number(v, o);

function SystemSection() {
  const toast = useToast();
  const { canEdit } = useAuth();
  const { data, error, loading, reload } = useApi('/settings');
  const form = useForm(
    {},
    {
      validate: (v) => ({
        highFlowWarningLpm: num(v.highFlowWarningLpm, { min: 0.1, max: 200 }),
        highFlowCriticalLpm: num(v.highFlowCriticalLpm, { min: 0.1, max: 200 }) || (Number(v.highFlowCriticalLpm) <= Number(v.highFlowWarningLpm) ? 'Must be above the warning level' : null),
        leakMinFlowLpm: num(v.leakMinFlowLpm, { min: 0.05, max: 10 }),
        dailyUsageWarningLiters: num(v.dailyUsageWarningLiters, { min: 50, max: 100000 }),
        alertCooldownMinutes: num(v.alertCooldownMinutes, { min: 1, max: 1440 }),
      }),
      onSubmit: async (v) => {
        const body = {
          leakAlertsEnabled: v.leakAlertsEnabled,
          highFlowAlertsEnabled: v.highFlowAlertsEnabled,
          deviceOfflineAlertsEnabled: v.deviceOfflineAlertsEnabled,
          autoShutoffOnCriticalLeak: v.autoShutoffOnCriticalLeak,
          highFlowWarningLpm: Number(v.highFlowWarningLpm),
          highFlowCriticalLpm: Number(v.highFlowCriticalLpm),
          leakMinFlowLpm: Number(v.leakMinFlowLpm),
          dailyUsageWarningLiters: Math.round(Number(v.dailyUsageWarningLiters)),
          alertCooldownMinutes: Math.round(Number(v.alertCooldownMinutes)),
        };
        await api('/settings', { method: 'PATCH', body });
        toast.success('System settings saved');
        reload({ silent: true });
      },
    },
  );

  useEffect(() => {
    if (data) form.reset(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.updatedAt, Boolean(data)]);

  if (loading && !data) return <PageLoader />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const v = form.values;
  const disabled = !canEdit;

  return (
    <form onSubmit={form.handleSubmit} noValidate className="space-y-6">
      {!canEdit && <InlineNotice tone="info">Your account is read-only. Only administrators can change system settings.</InlineNotice>}
      {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
      <Card>
        <CardHeader icon={BellRing} title="Alert notifications" description="Controls which detections create alerts and homeowner notifications." />
        <CardBody className="divide-y divide-line [&>*]:py-4 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          <Switch disabled={disabled} checked={Boolean(v.leakAlertsEnabled)} onChange={(c) => form.set('leakAlertsEnabled', c)} label="Leak detection alerts" description="Raise a possible-leak alert when pipe vibration exceeds the baseline threshold while water is flowing." />
          <Switch disabled={disabled} checked={Boolean(v.highFlowAlertsEnabled)} onChange={(c) => form.set('highFlowAlertsEnabled', c)} label="High-flow alerts" description="Raise an alert when a flow sensor exceeds its warning or critical level." />
          <Switch disabled={disabled} checked={Boolean(v.deviceOfflineAlertsEnabled)} onChange={(c) => form.set('deviceOfflineAlertsEnabled', c)} label="Device offline alerts" description="Raise an alert when a device stops reporting." />
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={SlidersHorizontal} title="Detection thresholds" description="System defaults. Sensors with their own calibrated thresholds use those instead." />
        <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input disabled={disabled} label="High-flow warning" type="number" step="0.5" suffix="L/min" {...form.bind('highFlowWarningLpm')} />
          <Input disabled={disabled} label="High-flow critical" type="number" step="0.5" suffix="L/min" {...form.bind('highFlowCriticalLpm')} />
          <Input disabled={disabled} label="Minimum flow to confirm a leak" type="number" step="0.05" suffix="L/min" hint="Vibration below this flow is treated as noise" {...form.bind('leakMinFlowLpm')} />
          <Input disabled={disabled} label="Daily usage warning" type="number" step="10" suffix="L" hint="Flags households in Water Usage" {...form.bind('dailyUsageWarningLiters')} />
          <Input disabled={disabled} label="Alert cooldown" type="number" step="1" suffix="min" hint="Suppresses duplicate alerts per sensor" {...form.bind('alertCooldownMinutes')} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon={AlertTriangle} title="Automatic shutoff" />
        <CardBody className="space-y-3">
          <Switch disabled={disabled} checked={Boolean(v.autoShutoffOnCriticalLeak)} onChange={(c) => form.set('autoShutoffOnCriticalLeak', c)} label="Send shutoff on critical leak" description="Automatically queue a valve-close command when a critical possible-leak alert is raised." />
          <p className="text-[13px] text-muted">The valve is only reported as closed after the device confirms it. Homeowners can still restore water through an administrator.</p>
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex items-center justify-end gap-3">
          {data?.updatedAt && <span className="text-xs text-muted">Last changed {fmtDateTime(data.updatedAt)}</span>}
          <Button type="submit" icon={Save} loading={form.submitting}>Save system settings</Button>
        </div>
      )}
    </form>
  );
}

const TABS = [
  { value: 'profile', label: 'Profile' },
  { value: 'security', label: 'Security' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'system', label: 'Alerts & system' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState('profile');
  return (
    <>
      <PageHeader title="Settings" description="Manage your administrator account and system-wide monitoring behaviour." />
      <div className="mb-6 overflow-x-auto pb-1">
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
      </div>
      <div className="max-w-4xl">
        {tab === 'profile' && <ProfileSection />}
        {tab === 'security' && <PasswordSection />}
        {tab === 'preferences' && (
          <>
            <AppearanceCard />
            <PreferencesSection />
          </>
        )}
        {tab === 'system' && <SystemSection />}
      </div>
    </>
  );
}
