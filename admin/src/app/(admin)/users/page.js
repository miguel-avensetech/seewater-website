'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, UserPlus, Users } from 'lucide-react';
import { useListQuery } from '@/hooks/useListQuery';
import { useAuth } from '@/components/layout/AuthProvider';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/Layout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable, Pagination, SearchInput, TableToolbar } from '@/components/ui/DataTable';
import { FilterSelect } from '@/components/ui/Field';
import { ClearFilters } from '@/components/ui/Filters';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { UserFormModal } from '@/components/domain/UserForms';
import { fmtDate, fmtLiters, initials } from '@/lib/format';
import { USER_STATUS, options } from '@/lib/labels';

export default function UsersPage() {
  const router = useRouter();
  const { canEdit } = useAuth();
  const list = useListQuery('/users');
  const { data, params } = list;
  const [modal, setModal] = useState({ open: false, user: null });

  return (
    <>
      <PageHeader
        title="User Management"
        description="Registered homeowners, their households, connected devices and recent water consumption."
        actions={canEdit && <Button icon={UserPlus} onClick={() => setModal({ open: true, user: null })}>Add user</Button>}
      />
      <Card>
        <TableToolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name, email, phone, address, account…" className="md:w-96" />
          <FilterSelect label="Status" value={params.status} onChange={(v) => list.setFilter('status', v)} placeholder="All statuses" options={options(USER_STATUS)} />
          <ClearFilters params={params} keys={['status']} onClear={list.clearFilters} />
        </TableToolbar>
        <DataTable
          minWidth={900}
          rows={data?.items}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          sort={params.sort ?? 'createdAt'}
          order={params.order}
          onSort={list.toggleSort}
          onRowClick={(u) => router.push(`/users/${u.id}`)}
          empty={
            <EmptyState
              icon={Users}
              title={params.q || params.status ? 'No users match' : 'No homeowners yet'}
              message={params.q || params.status ? 'Try a different search or filter.' : 'Add the first homeowner to start registering households and devices.'}
              action={canEdit && !params.q && <Button icon={UserPlus} onClick={() => setModal({ open: true, user: null })}>Add user</Button>}
            />
          }
          columns={[
            {
              key: 'fullName',
              header: 'Homeowner',
              sortable: true,
              render: (u) => (
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ocean-50 text-xs font-bold text-ocean-700">{initials(u.fullName)}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{u.fullName}</p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                </div>
              ),
            },
            { key: 'address', header: 'Address', className: 'max-w-xs truncate text-[13px]', render: (u) => <span title={u.address}>{u.address}</span> },
            { key: 'deviceCount', header: 'Households / devices', sortable: true, className: 'tabular text-[13px]', render: (u) => `${u.householdCount} / ${u.deviceCount}` },
            { key: 'usage30dLiters', header: 'Usage (30 days)', sortable: true, className: 'tabular font-medium text-ink', render: (u) => fmtLiters(u.usage30dLiters) },
            { key: 'status', header: 'Status', sortable: true, render: (u) => <div className="flex flex-col items-start gap-1"><StatusBadge map={USER_STATUS} value={u.status} />{u.hasAppAccount && <Badge tone="aqua">App account</Badge>}</div> },
            { key: 'createdAt', header: 'Registered', sortable: true, className: 'tabular whitespace-nowrap text-[13px]', render: (u) => fmtDate(u.createdAt) },
            canEdit && {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              render: (u) => (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  icon={Pencil}
                  aria-label={`Edit ${u.fullName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ open: true, user: u });
                  }}
                />
              ),
            },
          ].filter(Boolean)}
        />
        {data && <Pagination {...data} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>

      <UserFormModal open={modal.open} user={modal.user} onClose={() => setModal({ open: false, user: null })} onSaved={(u) => (modal.user ? list.reload({ silent: true }) : router.push(`/users/${u.id}`))} />
    </>
  );
}
