'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Cpu, Droplets, Home, Pencil, Plus, Trash2, History, Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { DescriptionList, PageHeader } from '@/components/ui/Layout';
import { StatusBadge, SourcesNote } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState, ErrorState, PageLoader } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { TimeSeriesChart, CHART } from '@/components/charts/Charts';
import { HouseFormModal, UserFormModal } from '@/components/domain/UserForms';
import { fmtBucket, fmtDate, fmtDateTime, fmtLiters, fmtRelative, initials } from '@/lib/format';
import { ALERT_STATUS, ALERT_TYPE, CONNECTION, HOUSE_STATUS, USER_STATUS } from '@/lib/labels';

export default function UserDetailPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { canEdit } = useAuth();
  const { data, error, loading, reload } = useApi(`/users/${id}`);
  const [editUser, setEditUser] = useState(false);
  const [house, setHouse] = useState({ open: false, house: null });
  const [confirm, setConfirm] = useState(null);

  if (loading && !data) return <PageLoader />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const { user, houses, devices, usage, recentAlerts, history } = data;

  return (
    <>
      <Link href="/users" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All users
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-aqua-400 to-ocean-600 text-sm font-bold text-white">{initials(user.fullName)}</span>
            {user.fullName}
          </span>
        }
        actions={
          canEdit && (
            <>
              <Button variant="secondary" icon={Pencil} onClick={() => setEditUser(true)}>Edit</Button>
              <Button variant="danger-outline" icon={Trash2} onClick={() => setConfirm({ type: 'user' })}>Delete</Button>
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Account information" actions={<StatusBadge map={USER_STATUS} value={user.status} />} />
            <CardBody>
              <DescriptionList
                items={[
                  { label: 'Email', value: user.email },
                  { label: 'Phone', value: user.phone || '—' },
                  { label: 'Address', value: user.address },
                  { label: 'MCWD account', value: user.accountNumber || '—' },
                  { label: 'Registered', value: fmtDate(user.createdAt) },
                  { label: 'Last updated', value: user.updatedAt ? fmtDateTime(user.updatedAt) : '—' },
                  { label: 'Mobile app', value: user.hasAppAccount ? `Registered${user.emailVerifiedAt ? ` · verified ${fmtDate(user.emailVerifiedAt)}` : ''}` : 'No app account yet — the homeowner can sign up with this email' },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Droplets} title="Water consumption — last 30 days" description={`Total ${fmtLiters(usage.last30DaysLiters)} across all households`} actions={<SourcesNote sources={usage.sources} />} />
            <CardBody>
              {usage.daily.length ? (
                <TimeSeriesChart data={usage.daily} xKey="date" xFormatter={(k) => fmtBucket(k, 'daily')} yUnit="L" height={220} series={[{ key: 'liters', label: 'Consumption', unit: 'L', color: CHART.ocean }]} />
              ) : (
                <EmptyState icon={Droplets} title="No consumption recorded" message="Usage will appear once a device is installed and reporting." className="py-8" />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={Home} title="Households" actions={canEdit && <Button size="sm" variant="secondary" icon={Plus} onClick={() => setHouse({ open: true, house: null })}>Add household</Button>} />
            {houses.length ? (
              <ul className="divide-y divide-line">
                {houses.map((h) => {
                  const hDevices = devices.filter((d) => d.houseId === h.id);
                  return (
                    <li key={h.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{h.houseName}</p>
                            <StatusBadge map={HOUSE_STATUS} value={h.houseStatus} />
                          </div>
                          <p className="mt-0.5 text-[13px] text-muted">{h.address}</p>
                          <p className="mt-0.5 text-xs text-faint">Installed {h.installationDate ? fmtDate(h.installationDate) : '—'}</p>
                        </div>
                        {canEdit && (
                          <div className="flex gap-1">
                            <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label={`Edit ${h.houseName}`} onClick={() => setHouse({ open: true, house: h })} />
                            <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label={`Remove ${h.houseName}`} onClick={() => setConfirm({ type: 'house', house: h })} />
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {hDevices.length ? (
                          hDevices.map((d) => (
                            <Link key={d.id} href={`/devices/${d.id}`} className="inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px] hover:border-ocean-200 hover:bg-ocean-50/50">
                              <Cpu className="h-3.5 w-3.5 text-ocean-600" />
                              <span className="font-mono font-semibold text-ink">{d.deviceName}</span>
                              <StatusBadge map={CONNECTION} value={d.connectionStatus} />
                            </Link>
                          ))
                        ) : (
                          <ButtonLink href="/devices" size="sm" variant="ghost" icon={Plus}>Register a device for this household</ButtonLink>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Home} title="No households" message="Add a household to assign IoT devices and start monitoring." action={canEdit && <Button size="sm" icon={Plus} onClick={() => setHouse({ open: true, house: null })}>Add household</Button>} />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader icon={Bell} title="Recent alerts" />
            {recentAlerts.length ? (
              <ul className="divide-y divide-line">
                {recentAlerts.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge map={ALERT_TYPE} value={a.alertType} dot={false} />
                      <StatusBadge map={ALERT_STATUS} value={a.alertStatus} />
                    </div>
                    <p className="mt-1.5 text-[13px] text-ink-soft">{a.description}</p>
                    <p className="mt-0.5 text-xs text-faint">{fmtRelative(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No alerts" message="No alerts recorded for this homeowner." className="py-8" />
            )}
          </Card>

          <Card>
            <CardHeader icon={History} title="Management history" />
            {history.length ? (
              <ol className="space-y-3 px-5 py-4">
                {history.map((h) => (
                  <li key={h.id} className="text-[13px]">
                    <p className="font-medium capitalize text-ink">{h.actionType.replaceAll('_', ' ')}</p>
                    <p className="text-muted">{h.remarks}</p>
                    <p className="text-xs text-faint">{fmtDateTime(h.actionDate)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No admin actions recorded" className="py-8" />
            )}
          </Card>
        </div>
      </div>

      <UserFormModal open={editUser} user={user} onClose={() => setEditUser(false)} onSaved={() => reload({ silent: true })} />
      <HouseFormModal open={house.open} house={house.house} userId={user.id} defaultAddress={user.address} onClose={() => setHouse({ open: false, house: null })} onSaved={() => reload({ silent: true })} />
      <ConfirmDialog
        open={confirm?.type === 'user'}
        onClose={() => setConfirm(null)}
        title={`Delete ${user.fullName}?`}
        confirmLabel="Delete user"
        message={houses.length ? 'This user still has households. Remove them first, or mark the user inactive instead.' : 'This permanently removes the homeowner account. Management history is kept.'}
        onConfirm={async () => {
          await api(`/users/${user.id}`, { method: 'DELETE' });
          toast.success('User deleted');
          router.replace('/users');
        }}
      />
      <ConfirmDialog
        open={confirm?.type === 'house'}
        onClose={() => setConfirm(null)}
        title={`Remove ${confirm?.house?.houseName}?`}
        confirmLabel="Remove household"
        message="Devices must be unassigned from this household first. Historical usage records are kept."
        onConfirm={async () => {
          await api(`/houses/${confirm.house.id}`, { method: 'DELETE' });
          toast.success('Household removed');
          reload({ silent: true });
        }}
      />
    </>
  );
}
