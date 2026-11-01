'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Logo } from './Logo';
import { signOutAdmin } from '@/lib/session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const router = useRouter();
  const [admin, setAdmin] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api('/auth/me')
      .then(({ admin }) => !cancelled && setAdmin(admin))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOutAdmin();
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }, [router]);

  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas">
        <Logo className="h-10 w-10 animate-pulse" />
        <p className="text-sm text-muted">{error && error.status !== 401 ? error.message : 'Loading SeeWater…'}</p>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ admin, setAdmin, logout, canEdit: admin.role !== 'viewer' }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
