'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import { X } from 'lucide-react';

/**
 * A store popup that sends the visitor somewhere (create an account, join the
 * affiliate programme) rather than collecting an email in place. Same manners
 * as the newsletter popup (components/newsletter/NewsletterPopup.tsx): never on
 * checkout, cart or account pages; on desktop only on an upward exit after a
 * few seconds, on a phone after 15 s or half a page; a dismissal holds for a
 * month; a bottom sheet on phones with the page still visible above it.
 */

const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;
const EXCLUDED_PREFIXES = ['/checkout', '/cart', '/account', '/admin', '/unsubscribe', '/track', '/receipt', '/pay', '/affiliate', '/group-buy'];
const MOBILE_MAX_WIDTH = 768;
const DESKTOP_MIN_DWELL_MS = 5000;
const MOBILE_DWELL_MS = 15000;
const MOBILE_SCROLL_FRACTION = 0.5;

export interface PromoPopupProps {
  /** Storage and analytics name, e.g. "signup". */
  id: string;
  enabled: boolean;
  heading: string;
  body: string;
  ctaLabel: string;
  href: string;
  /** Small print under the button. */
  note?: string;
  /** Extra reason to stay quiet (e.g. already signed in). Read when the trigger fires. */
  skip?: () => boolean;
}

export function PromoPopup({ id, enabled, heading, body, ctaLabel, href, note, skip }: PromoPopupProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dismissedKey = `ascend-${id}-popup-dismissed-at`;

  const suppressed = useCallback(() => {
    if (pathname && EXCLUDED_PREFIXES.some((p) => pathname.startsWith(p))) return true;
    try {
      const at = Number(localStorage.getItem(dismissedKey));
      if (at && Date.now() - at < DISMISS_FOR_MS) return true;
    } catch {
      return true;
    }
    return skip?.() ?? false;
  }, [pathname, dismissedKey, skip]);

  const show = useCallback(() => {
    if (suppressed()) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    posthog.capture(`${id}_popup_shown`, { path: pathname });
  }, [suppressed, id, pathname]);

  const close = useCallback(
    (reason: 'dismissed' | 'clicked') => {
      setOpen(false);
      try {
        // Clicking through counts too: they have seen the offer.
        localStorage.setItem(dismissedKey, String(Date.now()));
      } catch {
        /* storage blocked */
      }
      posthog.capture(`${id}_popup_${reason}`, { path: pathname });
      if (reason === 'dismissed') restoreFocusRef.current?.focus?.();
    },
    [dismissedKey, id, pathname]
  );

  useEffect(() => {
    if (!enabled || open || suppressed()) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (window.innerWidth < MOBILE_MAX_WIDTH) {
      timers.push(setTimeout(show, MOBILE_DWELL_MS));
      const onScroll = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollable > 0 && window.scrollY / scrollable >= MOBILE_SCROLL_FRACTION) show();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        timers.forEach(clearTimeout);
        window.removeEventListener('scroll', onScroll);
      };
    }
    let armed = false;
    timers.push(setTimeout(() => { armed = true; }, DESKTOP_MIN_DWELL_MS));
    const onMouseOut = (e: MouseEvent) => {
      if (!armed || e.relatedTarget || e.clientY > 0) return;
      show();
    };
    document.addEventListener('mouseout', onMouseOut);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('mouseout', onMouseOut);
    };
  }, [enabled, open, suppressed, show]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close('dismissed');
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const f = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    dialogRef.current?.querySelector<HTMLElement>('[data-cta]')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (!open) return null;

  const external = /^https?:\/\//.test(href);
  const ctaClass =
    'mt-5 inline-flex w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary-light transition-colors';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) close('dismissed');
      }}
    >
      <div className="dialog-backdrop absolute inset-0 bg-black/0 sm:bg-black/50 sm:backdrop-blur-[2px]" aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-popup-heading`}
        className="sheet-rise relative w-full sm:max-w-md bg-surface border-t sm:border border-border sm:rounded-2xl shadow-2xl p-5 sm:p-7"
      >
        <button
          type="button"
          onClick={() => close('dismissed')}
          aria-label="Close"
          className="absolute top-3 right-3 p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
        <h2 id={`${id}-popup-heading`} className="font-display text-lg sm:text-xl font-bold text-text-primary pr-8 leading-snug">
          {heading}
        </h2>
        <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">{body}</p>
        {external ? (
          <a data-cta href={href} className={ctaClass} onClick={() => close('clicked')}>
            {ctaLabel}
          </a>
        ) : (
          <Link data-cta href={href} className={ctaClass} onClick={() => close('clicked')}>
            {ctaLabel}
          </Link>
        )}
        {note ? <p className="mt-3 text-xs text-text-muted leading-relaxed">{note}</p> : null}
      </div>
    </div>
  );
}
