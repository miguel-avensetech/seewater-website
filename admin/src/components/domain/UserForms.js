'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { useForm, rules } from '@/hooks/useForm';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { InlineNotice } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { HOUSE_STATUS, USER_STATUS, options } from '@/lib/labels';

const emptyUser = { fullName: '', email: '', phone: '', address: '', accountNumber: '', status: 'active' };

export function UserFormModal({ open, user, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(user);
  const form = useForm(emptyUser, {
    validate: (v) => ({
      fullName: rules.required(v.fullName, 'Full name') || rules.minLen(v.fullName, 2),
      email: rules.required(v.email, 'Email') || rules.email(v.email),
      phone: v.phone && !/^[+\d][\d\s-]{6,19}$/.test(v.phone.trim()) ? 'Enter a valid phone number' : null,
      address: rules.required(v.address, 'Address') || rules.minLen(v.address, 5),
    }),
    onSubmit: async (v) => {
      const saved = await api(editing ? `/users/${user.id}` : '/users', { method: editing ? 'PATCH' : 'POST', body: v });
      toast.success(editing ? 'User updated' : 'User added', saved.fullName);
      onSaved(saved);
      onClose();
    },
  });

  useEffect(() => {
    if (open) form.reset(user ? { ...emptyUser, ...Object.fromEntries(Object.keys(emptyUser).map((k) => [k, user[k] ?? emptyUser[k]])) } : emptyUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      title={editing ? 'Edit homeowner' : 'Add homeowner'}
      description={editing ? 'Update account and contact details.' : 'Create a homeowner account. They complete sign-up and set a password in the SeeWater mobile app.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="user-form" loading={form.submitting}>{editing ? 'Save changes' : 'Add user'}</Button>
        </>
      }
    >
      <form id="user-form" onSubmit={form.handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit" className="sm:col-span-2">{form.formError}</InlineNotice>}
        <Input label="Full name" required autoComplete="off" {...form.bind('fullName')} className="sm:col-span-2" />
        <Input label="Email" type="email" required autoComplete="off" {...form.bind('email')} />
        <Input label="Phone" type="tel" placeholder="+63 9XX XXX XXXX" {...form.bind('phone')} />
        <Textarea label="Residential address" required rows={2} {...form.bind('address')} className="sm:col-span-2" />
        <Input label="MCWD account number" hint="Optional" {...form.bind('accountNumber')} />
        <Select label="Account status" options={options(USER_STATUS)} {...form.bind('status')} />
      </form>
    </Modal>
  );
}

const emptyHouse = { houseName: '', address: '', installationDate: '', houseStatus: 'pending_installation', ownerId: '' };

// When `userId` is omitted (Households page), the admin picks the homeowner.
export function HouseFormModal({ open, userId, house, defaultAddress, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(house);
  const chooseOwner = !editing && !userId;
  const owners = useApi(open && chooseOwner ? '/users' : null, { query: { pageSize: 100, sort: 'fullName', order: 'asc', status: 'active' } });
  const form = useForm(emptyHouse, {
    validate: (v) => ({
      houseName: rules.required(v.houseName, 'Household name') || rules.minLen(v.houseName, 2),
      address: rules.required(v.address, 'Address') || rules.minLen(v.address, 5),
      ownerId: chooseOwner ? rules.required(v.ownerId, 'Homeowner') : null,
    }),
    onSubmit: async (v) => {
      const { ownerId, ...fields } = v;
      const saved = editing
        ? await api(`/houses/${house.id}`, { method: 'PATCH', body: fields })
        : chooseOwner
          ? await api('/houses', { method: 'POST', body: { ...fields, userId: ownerId } })
          : await api(`/users/${userId}/houses`, { method: 'POST', body: fields });
      toast.success(editing ? 'Household updated' : 'Household added', saved.houseName);
      onSaved(saved);
      onClose();
    },
  });

  useEffect(() => {
    if (open) form.reset(house ? { houseName: house.houseName, address: house.address, installationDate: house.installationDate ?? '', houseStatus: house.houseStatus } : { ...emptyHouse, address: defaultAddress ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, house]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={form.submitting}
      size="sm"
      title={editing ? 'Edit household' : 'Add household'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={form.submitting}>Cancel</Button>
          <Button type="submit" form="house-form" loading={form.submitting}>{editing ? 'Save changes' : 'Add household'}</Button>
        </>
      }
    >
      <form id="house-form" onSubmit={form.handleSubmit} noValidate className="space-y-4">
        {form.formError && !Object.keys(form.errors).length && <InlineNotice tone="crit">{form.formError}</InlineNotice>}
        {chooseOwner && (
          <Select
            label="Homeowner"
            required
            placeholder={owners.loading ? 'Loading homeowners…' : 'Choose a homeowner'}
            options={(owners.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.fullName} — ${u.email}` }))}
            {...form.bind('ownerId')}
            onChange={(e) => {
              form.set('ownerId', e.target.value);
              const u = owners.data?.items.find((x) => x.id === e.target.value);
              if (u && !form.values.address) form.set('address', u.address ?? '');
            }}
          />
        )}
        <Input label="Household name" placeholder="e.g. Santos Residence" required {...form.bind('houseName')} />
        <Textarea label="Address" required rows={2} {...form.bind('address')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Installation date" type="date" {...form.bind('installationDate')} />
          <Select label="Monitoring status" options={options(HOUSE_STATUS)} {...form.bind('houseStatus')} />
        </div>
      </form>
    </Modal>
  );
}
