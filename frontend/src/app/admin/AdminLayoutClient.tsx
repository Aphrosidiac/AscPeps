'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Package, ShoppingBag, Settings, LogOut, Menu, X, Tag, BarChart3, Newspaper, Mail } from 'lucide-react';
import { useAuth, AuthProvider } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/insights', label: 'Insights', icon: Newspaper },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/admin/emails', label: 'Emails', icon: Mail },
  { href: '/admin/discounts', label: 'Discounts', icon: Tag },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminLayoutClient({ children }: { children: React.ReactNode }) {
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (!token && pathname !== '/admin/login') {
        router.push('/admin/login');
      } else {
        setReady(true);
      }
    }
  }, [loading, token, pathname, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (pathname === '/admin/login') return <>{children}</>;
  if (!ready) return <div className="flex items-center justify-center min-h-screen"><p className="text-text-muted">Loading...</p></div>;

  return (
    <div className="flex min-h-screen">
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 lg:hidden bg-surface border-b border-border px-4 h-14 flex items-center justify-between">
        <h2 className="font-display font-bold text-lg">ASCEND Admin</h2>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-surface-elevated rounded-lg cursor-pointer">
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed top-0 left-0 z-30 h-full w-64 bg-surface border-r border-border p-4 flex flex-col transition-transform duration-300',
        'lg:translate-x-0 lg:static lg:z-auto',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="mb-8 pt-1">
          <h2 className="font-display font-bold text-lg">ASCEND Admin</h2>
        </div>
        <nav className="space-y-1 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
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
        <button onClick={() => { logout(); router.push('/admin/login'); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-danger transition-colors cursor-pointer">
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-background overflow-auto pt-18 lg:pt-8">{children}</main>
    </div>
  );
}
