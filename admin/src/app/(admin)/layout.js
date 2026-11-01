import { AuthProvider } from '@/components/layout/AuthProvider';
import { AppShell } from '@/components/layout/AppShell';
import { LiveProvider } from '@/components/layout/LiveProvider';

export default function AdminLayout({ children }) {
  return (
    <AuthProvider>
      <LiveProvider>
        <AppShell>{children}</AppShell>
      </LiveProvider>
    </AuthProvider>
  );
}
