'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, Menu, X, Search, User, Users, ArrowRight } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { MolecularNetwork } from '@/components/ui/MolecularNetwork';
import { GROUP_BUY_ENABLED } from '@/lib/features';

const EASE = 'cubic-bezier(0.16,1,0.3,1)';

export function Navbar({ researchLive = false }: { researchLive?: boolean }) {
  const { itemCount } = useCart();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // menuOpen is the logical on/off state. menuClosing keeps the overlay in
  // the DOM for the exit transition after it flips false, and menuEntered
  // flips two frames after opening so the entrance has a "from" state.
  const [menuClosing, setMenuClosing] = useState(false);
  const [menuEntered, setMenuEntered] = useState(false);
  const menuMounted = menuOpen || menuClosing;
  const menuVisible = menuOpen && menuEntered;
  const openMenu = () => { setMenuEntered(false); setMenuClosing(false); setMenuOpen(true); };
  const closeMenu = () => { if (!menuOpen) return; setMenuClosing(true); setMenuOpen(false); };
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const links = [
    { href: '/products', label: 'Products' },
    ...(researchLive ? [{ href: '/research', label: 'Research' }] : []),
    { href: '/insights', label: 'Insights' },
    { href: '/calculator', label: 'Calculator' },
    { href: '/track', label: 'Track Order' },
    { href: '/about', label: 'About' },
  ];

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      setSearchOpen(false);
      setSearchQuery('');
    }
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  return (
    <>
    <nav className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" aria-label="Ascend MY home" className="flex items-center gap-2 shrink-0">
            <Image src="/images/pill-icon.png" alt="" width={32} height={32} />
            <span className={`font-display font-bold text-lg sm:text-xl tracking-tight ${searchOpen ? 'hidden sm:block' : ''}`}>Ascend MY</span>
          </Link>

          {/* Center: Nav links or Search input */}
          <div className="flex-1 flex justify-center mx-1 sm:mx-4">
            {searchOpen ? (
              <form onSubmit={handleSearch} className="w-full max-w-md animate-search-expand">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search peptides..."
                    className="w-full pl-10 pr-10 py-2 rounded-full border border-border bg-surface-elevated text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
                  />
                  <button
                    type="button"
                    onClick={closeSearch}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-border rounded-full transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5 text-text-muted" />
                  </button>
                </div>
              </form>
            ) : (
              <div className="hidden md:flex items-center gap-8">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center sm:gap-2 shrink-0">
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

            {!searchOpen && (
              <button
                onClick={() => { setSearchOpen(true); closeMenu(); }}
                className="p-1.5 sm:p-3 hover:bg-surface-elevated rounded-lg transition-colors cursor-pointer"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </button>
            )}

            {/* Accounts exist only for commenting on Insights, so this stays a
                quiet icon rather than a "Sign in" call to action competing
                with the cart. */}
            {/* On phones it moves into the menu to leave room for Group Buy. */}
            <Link
              href="/account"
              className="hidden md:block p-3 hover:bg-surface-elevated rounded-lg transition-colors"
              aria-label="Your account"
            >
              <User className="w-5 h-5" />
            </Link>

            <Link
              href="/cart"
              aria-label={itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart'}
              className="relative p-1.5 sm:p-3 hover:bg-surface-elevated rounded-lg transition-colors"
            >
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-medium">
                  {itemCount}
                </span>
              )}
            </Link>

            {!searchOpen && (
              <button
                onClick={() => (menuOpen ? closeMenu() : openMenu())}
                className="md:hidden p-1.5 sm:p-3 hover:bg-surface-elevated rounded-lg transition-colors cursor-pointer"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>

    {/* Full-screen mobile menu — rendered as a sibling of <nav>, not a
        descendant: <nav> has backdrop-blur, and a backdrop-filter ancestor
        becomes the containing block for position:fixed children, which
        would confine this overlay to the nav's own (short) bounding box
        instead of the viewport. */}
    {menuMounted && (
        <div
          role="dialog"
          aria-modal="true"
          className="md:hidden fixed inset-0 z-[100] bg-primary overflow-hidden transition-opacity duration-500"
          style={{ transitionTimingFunction: EASE, opacity: menuVisible ? 1 : 0 }}
        >
          <MolecularNetwork className="absolute inset-0 w-full h-full" />

          <div
            className="relative z-10 flex flex-col h-full transition-transform duration-500"
            style={{ transitionTimingFunction: EASE, transform: menuVisible ? 'translateY(0)' : 'translateY(-16px)' }}
          >
            <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8 shrink-0">
              <Link href="/" className="flex items-center gap-2" onClick={closeMenu}>
                <Image src="/images/pill-icon.png" alt="" width={32} height={32} className="invert" />
                <span className="font-display font-bold text-xl tracking-tight text-white">Ascend MY</span>
              </Link>
              <button
                onClick={closeMenu}
                aria-label="Close menu"
                className="p-3 hover:bg-white/10 rounded-lg transition-colors cursor-pointer text-white"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <nav className="flex-1 flex flex-col justify-center px-8 sm:px-12 overflow-y-auto">
              {[...links, { href: '/account', label: 'Account' }].map((link, i) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={closeMenu}
                  className="py-4 border-b border-white/10 font-display text-3xl font-bold text-white transition-all duration-500"
                  style={{
                    transitionTimingFunction: EASE,
                    transitionDelay: menuVisible ? `${120 + i * 70}ms` : '0ms',
                    opacity: menuVisible ? 1 : 0,
                    transform: menuVisible ? 'translateX(0)' : 'translateX(24px)',
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div
              className="px-8 sm:px-12 pb-10 shrink-0 transition-all duration-500"
              style={{
                transitionTimingFunction: EASE,
                transitionDelay: menuVisible ? `${120 + (links.length + 1) * 70}ms` : '0ms',
                opacity: menuVisible ? 1 : 0,
                transform: menuVisible ? 'translateY(0)' : 'translateY(16px)',
              }}
            >
              <p className="text-white/50 text-sm">Premium Research Peptides · Malaysia</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
