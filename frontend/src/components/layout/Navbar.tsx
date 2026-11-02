'use client';

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, Menu, X, Truck, User, Users, ArrowRight } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { GROUP_BUY_ENABLED } from '@/lib/features';
import { useMemberSession } from '@/lib/member-session';
import { HeaderMenus } from './HeaderMenus';
import { MobileMenu } from './MobileMenu';
import type { HeaderMenuData } from '@/lib/header-menu';
import { useStoreSettings } from '@/lib/store-settings';

// Whether the page has scrolled past the top (the homepage's dark header turns white).
const onScroll = (cb: () => void) => {
  addEventListener('scroll', cb, { passive: true });
  return () => removeEventListener('scroll', cb);
};
const scrolledNow = () => scrollY > 24;

const EMPTY_MENU: HeaderMenuData = { categories: [], supplies: null, feature: null, research: [] };

/**
 * The store header, after Bayang's (our standard): wordmark, the menus in the
 * middle (HeaderMenus), then the account pill, search, a thin pole and the
 * cart. On the homepage it sits dark on the dark hero and turns white once
 * the page scrolls.
 */
export function Navbar({ researchLive = false, menu = EMPTY_MENU }: { researchLive?: boolean; menu?: HeaderMenuData }) {
  const { itemCount, openCart } = useCart();
  const { member, ready } = useMemberSession();
  const settings = useStoreSettings();
  const signupBonus = settings?.signup_bonus_enabled === 'true' ? Number(settings.signup_bonus_pct || 10) : null;
  const pathname = usePathname() ?? '/';
  const scrolled = useSyncExternalStore(onScroll, scrolledNow, () => false);
  const navRef = useRef<HTMLElement>(null);
  // Where the header ends when the phone menu opens: the menu opens under it.
  const [menuTop, setMenuTop] = useState(64);
  const menuData = { ...menu, research: researchLive ? menu.research : [] };
  const [menuOpen, setMenuOpen] = useState(false);
  // menuOpen is the logical on/off state. menuClosing keeps the overlay in
  // the DOM for the exit transition after it flips false, and menuEntered
  // flips two frames after opening so the entrance has a "from" state.
  const [menuClosing, setMenuClosing] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const menuMounted = menuOpen || menuClosing;
  // Dark on the homepage hero until it scrolls, and under the (ink) phone menu.
  const dark = (pathname === '/' && !scrolled) || menuOpen;
  const iconBtn = `rounded-full transition-colors cursor-pointer ${dark ? 'hover:bg-white/10' : 'hover:bg-[rgb(10_10_10/0.06)]'}`;
  const menuVisible = menuOpen && menuEntered;
  const openMenu = () => {
    setMenuTop(Math.max(0, Math.round(navRef.current?.getBoundingClientRect().bottom ?? 64)));
    setMenuEntered(false); setMenuClosing(false); setMenuOpen(true);
  };
  const closeMenu = () => { if (!menuOpen) return; setMenuClosing(true); setMenuOpen(false); };


  useEffect(() => {
    if (menuOpen) {
      // A single rAF isn't enough: it can fire before the browser has ever
      // painted the just-mounted "closed" frame, so the transition has no
      // starting point to animate from and the menu simply pops in. Waiting
      // two frames guarantees the closed state actually painted first.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setMenuEntered(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    if (!menuClosing) return;
    const timeout = setTimeout(() => { setMenuClosing(false); setMenuEntered(false); }, 500);
    return () => clearTimeout(timeout);
  }, [menuOpen, menuClosing]);

  useEffect(() => {
    if (!menuMounted) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuClosing(true); setMenuOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuMounted]);

  return (
    <>
    <nav
      ref={navRef}
      className={`sticky top-0 z-50 border-b transition-[background-color,color,border-color] duration-[240ms] ${
        dark ? 'bg-primary text-white border-transparent' : 'bg-surface text-text-primary border-border'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex md:grid md:grid-cols-[1fr_auto_1fr] items-center justify-between h-16 gap-4">
          <Link href="/" aria-label="Ascend MY home" className="flex items-center gap-2 shrink-0 justify-self-start">
            <Image src="/images/pill-icon.png" alt="" width={32} height={32} className={`transition-[filter] duration-[240ms] ${dark ? 'invert' : ''}`} />
            <span className="font-display font-bold text-lg sm:text-xl tracking-tight">Ascend MY</span>
          </Link>

          {/* Center: the menus */}
          <div className="flex-1 md:flex-none flex justify-center mx-1 sm:mx-0">
              <div className="hidden md:block">
                <HeaderMenus data={menuData} pathname={pathname} />
              </div>
          </div>

          <div className="flex items-center justify-self-end gap-0.5 sm:gap-1.5 shrink-0">
            {/* Group Buy is always one tap away, phones included: it never
                folds into the menu, even with no batch open (the page then
                says when the next one starts). */}
            {GROUP_BUY_ENABLED && <Link
              href="/group-buy"
              className="group mr-0.5 sm:mr-2 inline-flex h-9 items-center gap-1 sm:gap-1.5 rounded-full bg-[#22C55E] px-2 sm:px-4 text-xs sm:text-sm font-semibold text-[#0A0A0A] whitespace-nowrap transition-colors hover:bg-[#1eb455]"
            >
              <Users className="hidden sm:block w-4 h-4" />
              Group Buy
              <span className="hidden lg:inline rounded-full bg-[#0A0A0A]/10 px-1.5 py-px text-[11px] font-medium">Bulk</span>
              <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 transition-transform duration-300 group-hover:translate-x-[3px]" />
            </Link>}

            {/* Track order is a main action (Fakhrul, 2026-11-03): customers come
                back for it more than anything else, so it is never in a menu. */}
            <Link
              href="/track"
              aria-current={pathname === '/track' ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-1.5 sm:p-2.5 lg:px-3 text-sm font-medium ${iconBtn}`}
            >
              <Truck className="w-5 h-5" aria-hidden="true" />
              <span className="sm:hidden">Track</span>
              <span className="hidden sm:inline">Track order</span>
            </Link>

            {/* The account, made worth pressing (Fakhrul, 2026-11-03): signed out
                a "Sign in" pill — with the first-order discount on it while the
                sign-up bonus is on — and signed in their initial, like the
                account page. Both go to /account, which signed out shows what an
                account gives and the way in. A plain icon until the session is read, so the
                first paint matches the server's. On phones it moves into the
                menu to leave room for Group Buy. */}
            {!ready ? (
              <Link href="/account" className={`hidden md:block p-2.5 ${iconBtn}`} aria-label="Your account">
                <User className="w-5 h-5" />
              </Link>
            ) : member ? (
              <Link
                href="/account"
                aria-label={`Your account, ${member.displayName}`}
                className={`hidden md:grid place-items-center mx-1.5 h-9 w-9 rounded-full bg-success font-display text-[15px] font-bold text-primary ring-offset-2 transition-shadow hover:ring-2 hover:ring-success/60 ${dark ? 'ring-offset-primary' : 'ring-offset-surface'}`}
              >
                {member.displayName.slice(0, 1).toUpperCase()}
              </Link>
            ) : (
              <>
              {/* Tablet widths: the pill track leaves no room for the full pill. */}
              <Link href="/account" className={`hidden md:block lg:hidden p-2.5 ${iconBtn}`} aria-label="Sign in">
                <User className="w-5 h-5" />
              </Link>
              <Link
                href="/account"
                // Bayang's "liquid glass" header pill: a soft ink film on white, a light one on the dark hero.
                className={`hidden lg:inline-flex mx-1 h-10 items-center gap-2 whitespace-nowrap rounded-full pl-3.5 pr-4 ${signupBonus ? 'xl:pr-2' : ''} text-sm font-semibold transition-colors ${
                  dark
                    ? 'bg-white/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.28),inset_0_0_0_1px_rgb(255_255_255/0.14)] hover:bg-white/25'
                    : 'bg-[rgb(10_10_10/0.06)] shadow-[inset_0_1px_0_rgb(255_255_255/0.7),inset_0_0_0_1px_rgb(10_10_10/0.05)] hover:bg-[rgb(10_10_10/0.1)]'
                }`}
              >
                <User className="h-4 w-4" aria-hidden="true" />
                Sign in
                {signupBonus && (
                  <span className="hidden xl:inline rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {signupBonus}% off
                  </span>
                )}
              </Link>
              </>
            )}

            {/* Bayang's thin pole between the controls and the cart. */}
            <span className="hidden md:block mx-1 h-5 w-px bg-current opacity-25" aria-hidden="true" />

            {/* Opens the slide-in cart; still a link to /cart for a new tab, or
                if scripts fail. On /cart itself it just goes there. */}
            <Link
              href="/cart"
              aria-label={itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart'}
              aria-haspopup="dialog"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                if (window.location.pathname === '/cart') return;
                e.preventDefault();
                openCart();
              }}
              className={`relative p-1.5 sm:p-2.5 ${iconBtn}`}
            >
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <span className={`absolute -top-0.5 -right-0.5 text-[11px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-semibold ${dark ? 'bg-white text-primary' : 'bg-primary text-white'}`}>
                  {itemCount}
                </span>
              )}
            </Link>

            <button
              onClick={() => (menuOpen ? closeMenu() : openMenu())}
              className={`md:hidden p-1.5 sm:p-2.5 ${iconBtn}`}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </nav>

    {menuMounted && (
      <MobileMenu
        data={menuData}
        visible={menuVisible}
        top={menuTop}
        onClose={closeMenu}
        account={
          member
            ? { label: 'Your account', badge: null, initial: member.displayName.slice(0, 1).toUpperCase() }
            : { label: 'Sign in', badge: signupBonus ? `${signupBonus}% off` : null, initial: null }
        }
      />
    )}
    </>
  );
}
