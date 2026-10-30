'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Layers, Package, Store, UserRound } from 'lucide-react';
import { useMemberSession } from '@/lib/member-session';

const NAV = [
  { href: '/group-buy', label: 'Batches', icon: Layers, match: (p: string) => p === '/group-buy' || (/^\/group-buy\/[^/]+/.test(p) && !/^\/group-buy\/(orders|sign-in|join)(\/|$)/.test(p)) },
  { href: '/group-buy/orders', label: 'My orders', icon: Package, match: (p: string) => p.startsWith('/group-buy/orders') },
];

/**
 * The portal frame: blurred top bar with the store's own logo plus a "Group Buy" tag,
 * section nav (Cobalt rule under the current one), the green Store pill and the
 * member's account on the right, and a thumb bar on phones (the account moves
 * there). Content is capped at 1280px, like the store.
 */
export function PortalShell({ children, className }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname() ?? '/group-buy';
  const { member, ready, signOut } = useMemberSession();
  const next = encodeURIComponent(pathname);

  return (
    <div className={`gbp ${className ?? ''}`}>
      <header className="gbp-top">
        <div className="gbp-bar">
          <Link href="/group-buy" className="gbp-brand" aria-label="Group Buy home">
            <Image src="/images/pill-icon.png" alt="" width={32} height={32} />
            <span className="word">Ascend MY</span>
            <span className="tag">Group Buy</span>
          </Link>
          <nav className="gbp-nav" aria-label="Group Buy">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={n.match(pathname) ? 'page' : undefined}>{n.label}</Link>
            ))}
          </nav>
          <div className="gbp-grow" />
          {/* The way back mirrors the store's own Group Buy pill: same shape,
              same spot, never folded away on phones. */}
          <Link href="/products" className="gbp-switch"><Store size={16} className="ico" />Store<ArrowRight size={16} className="ir" /></Link>
          <div className="gbp-acct">
            {!ready ? null : member ? (
              <>
                <button type="button" onClick={signOut} className="gbp-btn ghost sm" title={member.email}>Sign out</button>
                <span className="gbp-avatar" aria-label={`Signed in as ${member.displayName}`}>{member.displayName.slice(0, 1).toUpperCase()}</span>
              </>
            ) : (
              <>
                <Link href={`/group-buy/sign-in?next=${next}`} className="gbp-btn ghost sm">Sign in</Link>
                <Link href={`/group-buy/join?next=${next}`} className="gbp-btn primary sm">Create account</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="gbp-content">{children}</main>

      <footer className="gbp-foot">
        <div className="gbp-foot-in">
          <span>Ascend MY · For laboratory and research use only.</span>
          <nav>
            <Link href="/products">Store</Link>
            <Link href="/track">Track an order</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </div>
      </footer>

      <nav className="gbp-thumb" aria-label="Group Buy">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.match(pathname) ? 'page' : undefined}><n.icon size={19} />{n.label}</Link>
        ))}
        <Link href={member ? '/account' : `/group-buy/sign-in?next=${next}`}><UserRound size={19} />{member ? 'Account' : 'Sign in'}</Link>
      </nav>
    </div>
  );
}
