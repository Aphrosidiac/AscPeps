'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ShoppingCart, Menu, X, Search } from 'lucide-react';
import { useCart } from '@/lib/cart';

export function Navbar() {
  const { itemCount } = useCart();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const links = [
    { href: '/products', label: 'Products' },
    { href: '/track', label: 'Track Order' },
    { href: '/about', label: 'About' },
  ];

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

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
    <nav className="sticky top-0 z-50 bg-surface/95 backdrop-blur border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <Image src="/images/pill-icon.png" alt="ASCEND" width={32} height={32} />
            <span className={`font-display font-bold text-xl tracking-tight ${searchOpen ? 'hidden sm:block' : ''}`}>ASCEND</span>
          </Link>

          {/* Center: Nav links or Search input */}
          <div className="flex-1 flex justify-center mx-4">
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

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {!searchOpen && (
              <button
                onClick={() => { setSearchOpen(true); setMenuOpen(false); }}
                className="p-2 hover:bg-surface-elevated rounded-lg transition-colors cursor-pointer"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </button>
            )}

            <Link href="/cart" className="relative p-2 hover:bg-surface-elevated rounded-lg transition-colors">
              <ShoppingCart className="w-5 h-5" />
              {itemCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-medium">
                  {itemCount}
                </span>
              )}
            </Link>

            {!searchOpen && (
              <button
                onClick={() => { setMenuOpen(!menuOpen); }}
                className="md:hidden p-2 hover:bg-surface-elevated rounded-lg transition-colors cursor-pointer"
              >
                {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Menu */}
        {menuOpen && !searchOpen && (
          <div className="md:hidden pb-4 border-t border-border mt-2 pt-4">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block py-2 text-sm font-medium text-text-secondary hover:text-text-primary"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
