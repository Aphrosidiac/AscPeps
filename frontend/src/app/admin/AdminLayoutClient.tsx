'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { Menu } from 'lucide-react';
import { useAuth, AuthProvider } from '@/hooks/useAuth';
import { adminGetMe } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AdminNav, RAIL_KEY } from './AdminNav';

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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback((dismissed?: boolean) => {
    setSidebarOpen(false);
    if (dismissed) menuButtonRef.current?.focus();
  }, []);
  // Desktop only: the bar folded to an icon rail. Remembered per browser.
  // Read in the initialiser: the first client paint is the loading screen,
  // which does not depend on it, so the server's `false` cannot mismatch.
  const [rail, setRail] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const changeRail = (next: boolean) => {
    setRail(next);
    try {
      localStorage.setItem(RAIL_KEY, String(next));
    } catch {}
  };

  // Nothing admin renders until the session is known to be good: no token
  // (or an expired one, dropped by useAuth) goes straight to login, and a
  // token that looks fine is asked about once — /auth/me — so a revoked one
  // never flashes the dashboard first. `replace`, so Back does not bounce
  // through the page you were turned away from. A network failure is not a
  // verdict: the page renders and reports its own errors.
  useEffect(() => {
    if (loading || ready || pathname === '/admin/login') return;
    if (!token) {
      router.replace('/admin/login');
      return;
    }
    let live = true;
    adminGetMe(token)
      .then(() => live && setReady(true))
      .catch((err) => {
        if (!live) return;
        const status = err?.response?.status;
        if (status === 401 || status === 403 || status === 404) {
          logout();
          router.replace('/admin/login');
        } else {
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [loading, ready, token, pathname, router, logout]);

  // Any navigation closes the phone drawer — adjusted during render rather
  // than in an effect.
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (drawerPath !== pathname) {
    setDrawerPath(pathname);
    setSidebarOpen(false);
  }

  if (pathname === '/admin/login') return <>{children}</>;
  if (!ready) return <div className="flex items-center justify-center min-h-screen"><p className="text-text-muted">Loading...</p></div>;

  return (
    // --admin-nav-w: anything fixed beside the bar (a save bar) clears it.
    <div className="flex min-h-screen" style={{ '--admin-nav-w': rail ? '4rem' : '16rem' } as React.CSSProperties}>
      {/* Mobile top bar */}
      <div className="fixed top-0 left-0 right-0 z-40 lg:hidden bg-surface border-b border-border px-2 h-14 flex items-center gap-2">
        <button ref={menuButtonRef} onClick={() => setSidebarOpen(true)} aria-label="Open menu" aria-expanded={sidebarOpen} className="h-11 w-11 flex items-center justify-center hover:bg-surface-elevated rounded-lg cursor-pointer">
          <Menu className="w-5 h-5" />
        </button>
        <Image src="/brand/ascend-my-primary-black.svg" alt="Ascend MY" width={120} height={17} unoptimized />
        <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-text-muted">Admin</span>
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => closeDrawer(true)} />
      )}

      {/* Sidebar — position:fixed at every breakpoint with h-dvh, so it is
          always the viewport's height, never the page's (lg:static once left
          a tall blank gap under it on long pages). */}
      <AdminNav
        drawerOpen={sidebarOpen}
        onCloseDrawer={closeDrawer}
        rail={rail}
        onRailChange={changeRail}
        onLogout={() => { logout(); router.push('/admin/login'); }}
      />

      {/* Main content — aside is fixed (out of flow) at every breakpoint
          now, so this needs its own left margin to clear it on desktop
          instead of relying on flexbox to share the row with aside.

          overflow-x-clip, not overflow-auto: `auto` made <main> a scroll
          container that never actually scrolled (it grows with its content
          and the body scrolls), so every `sticky bottom-*` save bar inside it
          measured against a scrollport the size of the whole page and never
          stuck — the forms had to portal a fixed bar to document.body to get
          around it. `clip` contains stray horizontal overflow the same way
          without creating a scroll container. Tables scroll in their own
          overflow-x-auto wrappers. */}
      <main
        className={cn(
          'admin-main flex-1 min-w-0 p-4 sm:p-6 lg:p-8 bg-background overflow-x-clip pt-18 lg:pt-8 min-h-screen',
          'transition-[margin] duration-200 ease-out motion-reduce:transition-none',
          rail ? 'lg:ml-16' : 'lg:ml-64'
        )}
      >{children}</main>
    </div>
  );
}
