'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertCircle, ChevronDown, LogOut, Package, UserRound } from 'lucide-react';
import type { Member } from '@/types';

/**
 * The signed-in member's avatar in the portal bar: opens a small menu with who
 * is signed in, the account page, their orders and Sign out.
 */
export function AccountMenu({ member, onSignOut }: { member: Member; onSignOut: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const ref = useRef<HTMLDivElement>(null);

  // Following a link closes it.
  if (open && openedAt !== pathname) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = member.displayName.slice(0, 1).toUpperCase();
  return (
    <div className="gbp-menu" ref={ref}>
      <button
        type="button"
        className="gbp-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${member.displayName}`}
        onClick={() => { setOpenedAt(pathname); setOpen((v) => !v); }}
      >
        <span className="gbp-avatar">{initial}</span>
        <span className="nm">{member.displayName.split(' ')[0]}</span>
        <ChevronDown size={16} className="chev" />
      </button>
      {open && (
        <div className="gbp-menu-pop" role="menu">
          <div className="who">
            <span className="gbp-avatar">{initial}</span>
            <span className="txt"><b>{member.displayName}</b><span>{member.email}</span></span>
          </div>
          {!member.emailVerified && (
            <Link role="menuitem" href="/group-buy/account" className="warn"><AlertCircle size={16} />Confirm your email</Link>
          )}
          <Link role="menuitem" href="/group-buy/account"><UserRound size={16} />Account settings</Link>
          <Link role="menuitem" href="/group-buy/orders"><Package size={16} />My orders</Link>
          <div className="sep" />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={16} />Sign out</button>
        </div>
      )}
    </div>
  );
}
