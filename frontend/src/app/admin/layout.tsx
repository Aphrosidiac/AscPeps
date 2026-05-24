'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Package, ShoppingBag, Settings, LogOut } from 'lucide-react';
import { useAuth, AuthProvider } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AdminLayoutInner>{children}</AdminLayoutInner>
    </AuthProvider>
  );
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const { token, logout, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!token && pathname !== '/admin/login') {
        router.push('/admin/login');
      } else {
        setReady(true);
      }
    }
  }, [loading, token, pathname, router]);

  if (pathname === '/admin/login') return <>{children}</>;
  if (!ready) return <div className="flex items-center justify-center min-h-screen"><p className="text-text-muted">Loading...</p></div>;

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-surface border-r border-border p-4 flex flex-col">
        <div className="mb-8">
          <h2 className="font-display font-bold text-lg">ASCEND Admin</h2>
        </div>
        <nav className="space-y-1 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                pathname === item.href
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <button onClick={() => { logout(); router.push('/admin/login'); }} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-text-secondary hover:text-danger transition-colors cursor-pointer">
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </aside>
      <main className="flex-1 p-8 bg-background overflow-auto">{children}</main>
    </div>
  );
}
