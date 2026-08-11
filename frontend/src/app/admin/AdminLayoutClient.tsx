'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Package, ShoppingBag, Settings, LogOut, Menu, X, Tag, BarChart3, Newspaper, Mail, Store, Wallet, Bot, Truck, Users, Megaphone, MessageSquare } from 'lucide-react';
import { useAuth, AuthProvider } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/finance', label: 'Finance', icon: Wallet },
  { href: '/admin/products', label: 'Products', icon: Package },
  { href: '/admin/insights', label: 'Insights', icon: Newspaper },
  { href: '/admin/comments', label: 'Comments', icon: MessageSquare },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/admin/delivery', label: 'Delivery', icon: Truck },
  { href: '/admin/emails', label: 'Emails', icon: Mail },
  { href: '/admin/subscribers', label: 'Subscribers', icon: Users },
  { href: '/admin/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/admin/discounts', label: 'Discounts', icon: Tag },
  { href: '/admin/agent', label: 'Agent', icon: Bot },
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
        <h2 className="font-display font-bold text-lg">Ascend MY Admin</h2>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-surface-elevated rounded-lg cursor-pointer">
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — stays position:fixed at every breakpoint (previously
          lg:static let it fall into the row's normal flow on desktop, so it
          stretched to match main's content height instead of the viewport;
          on a page taller than one screen that left a tall blank gap below
          Logout, matching only the content height rather than the actual
          viewport). h-screen instead of h-full for the same reason: fixed
          positioning's containing block is the viewport, so an explicit
          viewport unit is the more direct/robust way to express "full
          height" than a percentage. */}
      <aside className={cn(
        'fixed top-0 left-0 z-30 h-screen w-64 bg-surface border-r border-border p-4 flex flex-col transition-transform duration-300',
        'lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="mb-8 pt-1">
          <h2 className="font-display font-bold text-lg">Ascend MY Admin</h2>
        </div>
        <nav className="space-y-1 flex-1">
          {navItems.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              // Nav items cascade in on first paint. Capped so a longer menu
              // never leaves the last item arriving noticeably late.
              style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
              className={cn(
                'row-rise flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                pathname === item.href
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated hover:translate-x-0.5'
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        {/* Back to the storefront. A plain <Link> rather than target="_blank"
            so it's a normal same-tab navigation; the admin session survives it
            either way since the token lives in localStorage. */}
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors border-t border-border mt-2 pt-3"
        >
          <Store className="w-4 h-4" />
          View Storefront
        </Link>
        <button onClick={() => { logout(); router.push('/admin/login'); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-danger transition-colors cursor-pointer">
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </aside>

      {/* Main content — aside is fixed (out of flow) at every breakpoint
          now, so this needs its own left margin to clear it on desktop
          instead of relying on flexbox to share the row with aside. */}
      <main className="flex-1 lg:ml-64 p-4 sm:p-6 lg:p-8 bg-background overflow-auto pt-18 lg:pt-8 min-h-screen">{children}</main>
    </div>
  );
}
