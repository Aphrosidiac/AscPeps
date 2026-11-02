'use client';

/**
 * The admin sidebar. Pages are grouped by the job they serve, each group a
 * submenu that opens in place; on a desktop the whole bar folds to an icon
 * rail whose groups open as flyouts.
 *
 * Replaced the single list of 21 links (2026-10-26): the order it had grown
 * into no longer said which pages belonged together.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GROUP_BUY_ENABLED } from '@/lib/features';
import {
  ChevronRight,
  Headset,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Newspaper,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  Store,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { SECTIONS as MONEY_SECTIONS } from './money/money-ui';
import { cn } from '@/lib/utils';

type Leaf = { href: string; label: string; icon?: LucideIcon; exact?: boolean };
type Group = { id: string; label: string; icon: LucideIcon; items: Leaf[] };
type Entry = Leaf | Group;

const isGroup = (e: Entry): e is Group => 'items' in e;

export const NAV: Entry[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  // Second, not inside a group: it can do everything below it, and it is
  // where a question about any of it gets asked. A headset, not the sparkles
  // every AI button wears: Abby is the secretary on the line.
  { href: '/admin/assistant', label: 'Assistant', icon: Headset },
  {
    id: 'sales',
    label: 'Sales',
    icon: ShoppingBag,
    items: [
      { href: '/admin/orders', label: 'Orders' },
      ...(GROUP_BUY_ENABLED ? [{ href: '/admin/group-buys', label: 'Group Buys' }] : []),
      { href: '/admin/payments', label: 'Payments' },
      { href: '/admin/delivery', label: 'Delivery' },
      { href: '/admin/emails', label: 'Order emails' },
      { href: '/admin/analytics', label: 'Analytics' },
    ],
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    icon: Package,
    items: [
      { href: '/admin/products', label: 'Products' },
      // Beside Products: a second name for the same catalogue, and the first
      // thing anyone does after adding a SKU is map it.
      { href: '/admin/shadow-skus', label: 'Shadow SKUs' },
      { href: '/admin/suppliers', label: 'Suppliers' },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: Megaphone,
    items: [
      { href: '/admin/campaigns', label: 'Campaigns' },
      { href: '/admin/subscribers', label: 'Subscribers' },
      { href: '/admin/discounts', label: 'Discounts' },
      { href: '/admin/affiliates', label: 'Affiliates' },
      { href: '/admin/popups', label: 'Popups' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    icon: Newspaper,
    items: [
      { href: '/admin/research', label: 'Research' },
      { href: '/admin/research-sources', label: 'Research sources' },
      { href: '/admin/research-people', label: 'Writers & reviewers' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    icon: Wallet,
    items: [
      // Ascend Money's own tabs, each its own address — one list for both.
      ...MONEY_SECTIONS.map((s) => ({
        href: s.href,
        label: s.label,
        exact: s.href === '/admin/money',
      })),
      // In Money, not off with Setup: a document is almost always the receipt
      // behind a number on one of the pages above it.
      { href: '/admin/documents', label: 'Documents' },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: Settings,
    items: [
      { href: '/admin/settings', label: 'Store settings' },
      { href: '/admin/agent', label: 'WhatsApp link' },
    ],
  },
];

const LEAVES = NAV.flatMap<{ leaf: Leaf; group: Group | null }>((e) =>
  isGroup(e) ? e.items.map((leaf) => ({ leaf, group: e })) : [{ leaf: e, group: null }]
);

const matches = (leaf: Leaf, pathname: string) =>
  leaf.exact ? pathname === leaf.href : pathname === leaf.href || pathname.startsWith(leaf.href + '/');

/** The page you are on: the longest address that matches, so
 *  /admin/money/partners/3 is Partners and not Overview. */
export function activeEntry(pathname: string) {
  let best: (typeof LEAVES)[number] | null = null;
  for (const l of LEAVES) {
    if (matches(l.leaf, pathname) && (!best || l.leaf.href.length > best.leaf.href.length)) best = l;
  }
  return best;
}

export const RAIL_KEY = 'ascend-admin-nav-rail';

const RAIL_W = 64;

// Tailwind's lg: the bar is pinned from here up, a drawer below it.
const DESKTOP = '(min-width: 1024px)';
const subscribeDesktop = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const useIsDesktop = () =>
  useSyncExternalStore(subscribeDesktop, () => window.matchMedia(DESKTOP).matches, () => true);

type Flyout =
  | { kind: 'tip'; key: string; label: string; rect: DOMRect; anchor: HTMLElement }
  | { kind: 'menu'; key: string; group: Group; rect: DOMRect; anchor: HTMLElement; focusFirst: boolean };

export function AdminNav({
  drawerOpen,
  onCloseDrawer,
  rail,
  onRailChange,
  onLogout,
}: {
  drawerOpen: boolean;
  /** `dismissed`: closed with X, Esc or the backdrop rather than by
   *  picking a page, so focus goes back to the menu button. */
  onCloseDrawer: (dismissed?: boolean) => void;
  rail: boolean;
  onRailChange: (rail: boolean) => void;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const current = activeEntry(pathname);
  const currentGroup = current?.group?.id ?? null;
  const isDesktop = useIsDesktop();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Phone drawer: focus lands on its close button, Esc closes it, and the
  // page behind stops scrolling while it is open.
  useEffect(() => {
    if (!drawerOpen || isDesktop) return;
    closeRef.current?.focus({ preventScroll: true });
    // On a short phone the page you are on can sit below the fold.
    document.querySelector('aside nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseDrawer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen, isDesktop, onCloseDrawer]);

  // One group open at a time, so the bar never grows back into the long
  // list it replaced. Landing on a page opens its group; a folded group names
  // the page you are on inside it.
  const [openId, setOpenId] = useState<string | null>(currentGroup);
  const [seenGroup, setSeenGroup] = useState(currentGroup);
  if (seenGroup !== currentGroup) {
    setSeenGroup(currentGroup);
    if (currentGroup) setOpenId(currentGroup);
  }
  const toggleGroup = (id: string) => setOpenId((o) => (o === id ? null : id));

  // ── Rail flyouts and tooltips ──────────────────────────────────────────
  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const { cancel: cancelClose, schedule } = useDelay();
  const scheduleClose = () => schedule(() => setFlyout(null), 140);
  const showTip = (key: string, label: string, el: HTMLElement) => {
    cancelClose();
    setFlyout((f) => (f?.kind === 'menu' && f.key === key ? f : { kind: 'tip', key, label, rect: el.getBoundingClientRect(), anchor: el }));
  };
  const showMenu = (group: Group, el: HTMLElement, focusFirst = false) => {
    cancelClose();
    setFlyout({ kind: 'menu', key: group.id, group, rect: el.getBoundingClientRect(), anchor: el, focusFirst });
  };
  const closeFlyout = (refocus: boolean) => {
    cancelClose();
    if (refocus) flyout?.anchor.focus();
    setFlyout(null);
  };

  const [seenPlace, setSeenPlace] = useState(`${pathname}|${rail}`);
  if (seenPlace !== `${pathname}|${rail}`) {
    setSeenPlace(`${pathname}|${rail}`);
    setFlyout(null);
  }

  // ── Rows ───────────────────────────────────────────────────────────────
  const leafClass = (active: boolean) =>
    cn(
      // Thumb-sized below lg (44px rows, 15px type); desktop keeps 36px.
      'flex items-center gap-3 rounded-lg px-3 h-11 text-[15px] lg:h-9 lg:text-sm font-medium transition-colors duration-150',
      active ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
    );

  const tipProps = (key: string, label: string) =>
    rail
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => showTip(key, label, e.currentTarget),
          onMouseLeave: () => scheduleClose(),
          onFocus: (e: React.FocusEvent<HTMLElement>) => showTip(key, label, e.currentTarget),
          onBlur: () => scheduleClose(),
        }
      : {};

  const railButton = (active: boolean, holdsActive = false) =>
    cn(
      'relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-150 cursor-pointer',
      active
        ? 'bg-primary text-white'
        : holdsActive
          ? 'bg-surface-elevated text-text-primary'
          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
    );

  const tree = NAV.map((entry, i) => {
    const delay = { animationDelay: `${Math.min(i * 30, 240)}ms` };
    if (!isGroup(entry)) {
      const active = current?.leaf === entry;
      const Icon = entry.icon!;
      return (
        <li key={entry.href} className="row-rise" style={delay}>
          {rail ? (
            <Link href={entry.href} aria-label={entry.label} aria-current={active ? 'page' : undefined} className={railButton(active)} {...tipProps(entry.href, entry.label)}>
              <Icon className="h-[18px] w-[18px]" />
            </Link>
          ) : (
            <Link href={entry.href} aria-current={active ? 'page' : undefined} onClick={() => onCloseDrawer()} className={leafClass(active)}>
              <Icon className="h-4 w-4 shrink-0" />
              {entry.label}
            </Link>
          )}
        </li>
      );
    }

    const holdsActive = currentGroup === entry.id;
    const isOpen = openId === entry.id;
    const Icon = entry.icon;
    const divider = i > 0 && !isGroup(NAV[i - 1]);

    if (rail) {
      const menuOpen = flyout?.kind === 'menu' && flyout.key === entry.id;
      return (
        <li key={entry.id} className={cn('row-rise', divider && 'mt-3 border-t border-border pt-3')} style={delay}>
          <button
            type="button"
            aria-label={entry.label}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={railButton(false, holdsActive || menuOpen)}
            onMouseEnter={(e) => showMenu(entry, e.currentTarget)}
            onMouseLeave={scheduleClose}
            // detail 0 = Enter/Space, so the keyboard lands inside the menu.
            onClick={(e) => (menuOpen && e.detail !== 0 ? closeFlyout(false) : showMenu(entry, e.currentTarget, e.detail === 0))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                showMenu(entry, e.currentTarget, true);
              }
            }}
          >
            <Icon className="h-[18px] w-[18px]" />
            {holdsActive && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />}
          </button>
        </li>
      );
    }

    return (
      <li key={entry.id} className={cn('row-rise', divider && 'mt-3 border-t border-border pt-3')} style={delay}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`nav-${entry.id}`}
          onClick={() => toggleGroup(entry.id)}
          className={cn(
            'group flex w-full items-center gap-3 rounded-lg px-3 h-11 text-[15px] lg:h-9 lg:text-sm transition-colors duration-150 cursor-pointer hover:bg-surface-elevated',
            holdsActive ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary hover:text-text-primary'
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{entry.label}</span>
          {/* Folded with the page you are on inside it: say so. */}
          {holdsActive && !isOpen && (
            <span className="max-w-[96px] truncate text-xs font-medium text-text-muted">{current?.leaf.label}</span>
          )}
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 motion-reduce:transition-none',
              isOpen && 'rotate-90'
            )}
          />
        </button>
        {/* 0fr → 1fr animates to the submenu's real height. `inert` keeps a
            folded group's links out of the Tab order. */}
        <div
          id={`nav-${entry.id}`}
          inert={!isOpen}
          className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
          style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <ul className="ml-[19px] space-y-0.5 border-l border-border py-1 pl-2.5">
              {entry.items.map((leaf) => {
                const active = current?.leaf === leaf;
                return (
                  <li key={leaf.href}>
                    <Link
                      href={leaf.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => onCloseDrawer()}
                      // Inside a submenu the guide line marks the page, so the
                      // row stays light instead of a second black pill.
                      className={cn(
                        'relative flex h-10 items-center rounded-lg px-2.5 text-[15px] lg:h-8 lg:text-sm transition-colors duration-150',
                        active
                          ? 'bg-surface-elevated font-semibold text-text-primary'
                          : 'font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
                      )}
                    >
                      {/* The guide line turns ink beside the page you are on. */}
                      {active && <span aria-hidden className="absolute -left-[11px] top-2 bottom-2 w-[2px] rounded-full bg-primary lg:top-1.5 lg:bottom-1.5" />}
                      {leaf.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </li>
    );
  });

  return (
    <>
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 lg:z-30 flex h-dvh w-72 max-w-[85vw] flex-col border-r border-border bg-surface',
          'transition-[width,transform] duration-200 ease-out motion-reduce:transition-none lg:translate-x-0',
          rail ? 'lg:w-16' : 'lg:w-64',
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Admin"
        // A closed drawer is off-screen: keep it out of Tab and VoiceOver too.
        inert={!isDesktop && !drawerOpen}
      >
        {/* Brand */}
        {/* Brand kit rev 1.1 SVGs, copied verbatim (brand/production/…/07_DEVELOPMENT). */}
        <div className={cn('flex h-16 shrink-0 items-center gap-2.5', rail ? 'lg:justify-center lg:px-0 px-5' : 'px-5')}>
          <Link href="/admin/dashboard" aria-label="Ascend MY admin home" className={cn('flex h-11 shrink-0 items-center', rail && 'lg:hidden')}>
            <Image src="/brand/ascend-my-primary-black.svg" alt="Ascend MY" width={132} height={19} unoptimized priority />
          </Link>
          {rail && (
            <Link href="/admin/dashboard" aria-label="Ascend MY admin home" className="hidden shrink-0 lg:block">
              <Image src="/brand/ascend-my-mark-black.svg" alt="Ascend MY" width={24} height={22} unoptimized priority />
            </Link>
          )}
          <span className={cn('rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-text-muted', rail && 'lg:hidden')}>Admin</span>
          <span className="flex-1" />
          <button
            ref={closeRef}
            type="button"
            onClick={() => onCloseDrawer(true)}
            aria-label="Close menu"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary lg:hidden cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Pages */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1 [scrollbar-width:thin]" onScroll={() => flyout && setFlyout(null)}>
          <ul className={cn('space-y-0.5', rail && 'space-y-1')}>{tree}</ul>
        </nav>

        {/* Storefront, log out, fold */}
        <div className={cn('flex shrink-0 gap-1 border-t border-border p-3', rail ? 'flex-col items-center' : 'items-center')}>
          {rail ? (
            <Link href="/" aria-label="View storefront" className={railButton(false)} {...tipProps('store', 'View storefront')}>
              <Store className="h-[18px] w-[18px]" />
            </Link>
          ) : (
            <Link href="/" className={cn(leafClass(false), 'min-w-0 flex-1')}>
              <Store className="h-4 w-4 shrink-0" />
              <span className="truncate">Storefront</span>
            </Link>
          )}
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            className={cn(railButton(false), 'mx-0 h-11 w-11 lg:h-9 lg:w-9 hover:text-danger', rail && 'lg:h-10 lg:w-10')}
            {...(rail ? tipProps('logout', 'Log out') : {})}
            title={rail ? undefined : 'Log out'}
          >
            <LogOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onRailChange(!rail)}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(railButton(false), 'mx-0 hidden h-9 w-9 lg:flex', rail && 'lg:h-10 lg:w-10')}
            {...(rail ? tipProps('fold', 'Expand sidebar') : {})}
            title={rail ? undefined : 'Collapse sidebar'}
          >
            {rail ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {rail && flyout && (
        <FlyoutLayer
          flyout={flyout}
          pathname={pathname}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onClose={closeFlyout}
        />
      )}
    </>
  );
}

/** One pending timeout, cleared on unmount — the flyout's close delay, so
 *  the pointer can cross the gap from icon to menu. */
function useDelay() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useMemo(
    () => ({
      cancel() {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      },
      schedule(fn: () => void, ms: number) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(fn, ms);
      },
    }),
    []
  );
}

/** Portalled: the aside is transformed, which would trap a fixed child. */
function FlyoutLayer({
  flyout,
  pathname,
  onEnter,
  onLeave,
  onClose,
}: {
  flyout: Flyout;
  pathname: string;
  onEnter: () => void;
  onLeave: () => void;
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const left = RAIL_W + 8;

  // Beside its icon, nudged up if it would run off the bottom.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { rect } = flyout;
    const h = el.offsetHeight;
    const want = flyout.kind === 'tip' ? rect.top + rect.height / 2 - h / 2 : rect.top - 6;
    setTop(Math.max(8, Math.min(want, window.innerHeight - h - 8)));
  }, [flyout]);

  useEffect(() => {
    if (flyout.kind === 'menu' && flyout.focusFirst && top !== null) {
      ref.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    }
  }, [flyout, top]);

  if (flyout.kind === 'tip') {
    return createPortal(
      <div
        ref={ref}
        role="tooltip"
        className="pointer-events-none fixed z-50 whitespace-pre rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white shadow-md"
        style={{ left, top: top ?? flyout.rect.top, visibility: top === null ? 'hidden' : undefined }}
      >
        {flyout.label}
      </div>,
      document.body
    );
  }

  const links = () => Array.from(ref.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'Tab') {
      e.preventDefault();
      onClose(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[(at + 1) % all.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      all[(at - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      all[all.length - 1]?.focus();
    }
  };

  const current = activeEntry(pathname);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={flyout.group.label}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={onKeyDown}
      className="panel-reveal fixed z-50 w-56 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
      style={{ left, top: top ?? flyout.rect.top, visibility: top === null ? 'hidden' : undefined }}
    >
      <p className="px-2.5 pb-1.5 pt-1 text-xs font-semibold text-text-muted">{flyout.group.label}</p>
      {flyout.group.items.map((leaf) => {
        const active = current?.leaf === leaf;
        return (
          <Link
            key={leaf.href}
            href={leaf.href}
            role="menuitem"
            aria-current={active ? 'page' : undefined}
            onClick={() => onClose(false)}
            className={cn(
              'flex h-8 items-center rounded-lg px-2.5 text-sm outline-none transition-colors',
              active
                ? 'bg-surface-elevated font-semibold text-text-primary'
                : 'font-medium text-text-secondary hover:bg-surface-elevated hover:text-text-primary focus-visible:bg-surface-elevated focus-visible:text-text-primary'
            )}
          >
            {leaf.label}
          </Link>
        );
      })}
    </div>,
    document.body
  );
}
