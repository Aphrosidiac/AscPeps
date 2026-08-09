'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import { X } from 'lucide-react';
import { NewsletterForm, SUBSCRIBED_KEY } from './NewsletterForm';

const DISMISSED_KEY = 'ascend-newsletter-dismissed-at';
const SHOWN_THIS_SESSION_KEY = 'ascend-newsletter-shown';

// A dismissal is remembered for a month, in localStorage rather than
// sessionStorage. sessionStorage is the common shortcut here and it is wrong:
// it forgets on tab close, so the same person gets asked again tomorrow, and
// again the day after. That is what turns a popup into the thing people
// install blockers for.
const DISMISS_FOR_MS = 30 * 24 * 60 * 60 * 1000;

// Routes where a signup prompt is never worth the interruption. Checkout and
// cart are the obvious ones — trading a live purchase for an email address is
// a straight loss — and the rest are places the visitor arrived with a
// specific job to finish.
const EXCLUDED_PREFIXES = ['/checkout', '/cart', '/account', '/admin', '/unsubscribe', '/track', '/receipt'];

// Below this width we treat the visit as touch: there is no mouseleave to
// detect an exit from, so the trigger has to be scroll or dwell instead.
// Matches Tailwind's md breakpoint.
const MOBILE_MAX_WIDTH = 768;

// Desktop: ignore a mouseleave in the first few seconds. A cursor flicking to
// a bookmark bar the moment the page loads is not an exit intent, and firing
// then is indistinguishable from an on-load popup — which is precisely what
// Google's intrusive-interstitial rule targets.
const DESKTOP_MIN_DWELL_MS = 5000;

// Mobile: whichever comes first. Both are well past the "delayed until the
// content has been seen" line, so neither carries interstitial risk.
const MOBILE_DWELL_MS = 15000;
const MOBILE_SCROLL_FRACTION = 0.5;

interface NewsletterPopupProps {
  enabled: boolean;
  heading: string;
  body: string;
}

function suppressed(pathname: string | null): boolean {
  if (pathname && EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  try {
    if (localStorage.getItem(SUBSCRIBED_KEY)) return true;
    if (sessionStorage.getItem(SHOWN_THIS_SESSION_KEY)) return true;
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY));
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_FOR_MS) return true;
  } catch {
    // Storage blocked. Without it we cannot tell whether this person has
    // already been asked, and asking someone twice is worse than not asking —
    // so stay quiet.
    return true;
  }
  return false;
}

export function NewsletterPopup({ enabled, heading, body }: NewsletterPopupProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // What had focus before the dialog opened, so it can be handed back on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    if (suppressed(pathname)) return;
    try {
      sessionStorage.setItem(SHOWN_THIS_SESSION_KEY, '1');
    } catch {
      /* storage blocked — suppressed() already refused to open in that case */
    }
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    posthog.capture('newsletter_popup_shown', { path: pathname });
  }, [pathname]);

  const close = useCallback(
    (reason: 'dismissed' | 'subscribed') => {
      setOpen(false);
      if (reason === 'dismissed') {
        try {
          localStorage.setItem(DISMISSED_KEY, String(Date.now()));
        } catch {
          /* storage blocked */
        }
        posthog.capture('newsletter_popup_dismissed', { path: pathname });
      }
      restoreFocusRef.current?.focus?.();
    },
    [pathname]
  );

  // Trigger wiring. Re-runs on navigation so the exclusion list is re-checked
  // when someone moves from a product page into checkout.
  useEffect(() => {
    if (!enabled || open || suppressed(pathname)) return;

    const isMobile = window.innerWidth < MOBILE_MAX_WIDTH;
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (isMobile) {
      timers.push(setTimeout(show, MOBILE_DWELL_MS));

      const onScroll = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        // A page too short to scroll would divide by ~0 and fire instantly;
        // on those the dwell timer above is the only trigger.
        if (scrollable <= 0) return;
        if (window.scrollY / scrollable >= MOBILE_SCROLL_FRACTION) show();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        timers.forEach(clearTimeout);
        window.removeEventListener('scroll', onScroll);
      };
    }

    let armed = false;
    timers.push(setTimeout(() => { armed = true; }, DESKTOP_MIN_DWELL_MS));

    const onMouseOut = (event: MouseEvent) => {
      // relatedTarget is null when the cursor leaves the viewport entirely
      // rather than moving between elements; clientY <= 0 restricts it to
      // upward exits, towards the tab bar and address bar. Together those
      // approximate "about to leave" without firing on every stray movement
      // out of the left or right edge.
      if (!armed || event.relatedTarget || event.clientY > 0) return;
      show();
    };
    document.addEventListener('mouseout', onMouseOut);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener('mouseout', onMouseOut);
    };
  }, [enabled, open, pathname, show]);

  // Esc to close, and a focus trap while open. Both are what separate a
  // dialog from a div that happens to sit on top of the page.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close('dismissed');
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // Focus the email field, not the close button: the dialog is asking for
    // one thing and the caret should already be where the answer goes.
    dialogRef.current?.querySelector<HTMLElement>('input[type="email"]')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4"
      // The scrim is only a backdrop on desktop. On mobile the sheet
      // deliberately leaves the page visible and readable above it — a
      // full-screen dim on a phone is the shape Google treats as an intrusive
      // interstitial, whatever the element underneath is doing.
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) close('dismissed');
      }}
    >
      <div className="dialog-backdrop absolute inset-0 bg-black/0 sm:bg-black/50 sm:backdrop-blur-[2px]" aria-hidden />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="newsletter-popup-heading"
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

        <h2
          id="newsletter-popup-heading"
          className="font-display text-lg sm:text-xl font-bold text-text-primary pr-8 leading-snug"
        >
          {heading}
        </h2>
        <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">{body}</p>

        <NewsletterForm
          source="FOOTER"
          ctaLabel="Send it"
          tone="light"
          className="mt-4"
          onSuccess={() => close('subscribed')}
        />

        <p className="mt-3 text-xs text-text-muted leading-relaxed">
          Research updates and restock alerts. Unsubscribe in one click, any time.
        </p>
      </div>
    </div>
  );
}
