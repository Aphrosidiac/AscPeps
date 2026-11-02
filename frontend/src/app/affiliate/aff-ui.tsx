'use client';

import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import type { MyAffiliate, OrderState, PayoutStatus } from '@/lib/affiliate-api';
import type { Member } from '@/types';

/* ── Where we are: affiliate.ascendpeptides.my serves these pages at "/",
      the store's own host at "/affiliate" (src/proxy.ts). ── */

const noop = () => () => {};
const onAffHost = () => window.location.hostname.startsWith('affiliate.');

/** Turns a portal path ("/orders") into this host's href. "/affiliate/…" until hydrated. */
export function useAffHref() {
  const short = useSyncExternalStore(noop, onAffHost, () => false);
  return useCallback((p: string) => (short ? p : `/affiliate${p === '/' ? '' : p}`), [short]);
}

/** The portal path of the current page ("/", "/orders"…), whichever host. */
export function usePortalPath(): string {
  const p = usePathname() || '/';
  const stripped = p.startsWith('/affiliate') ? p.slice('/affiliate'.length) : p;
  return stripped || '/';
}

/** The store's own origin, for the share link: the affiliate host without its prefix. */
export function useStoreOrigin(): string {
  return useSyncExternalStore(
    noop,
    () => (process.env.NEXT_PUBLIC_STORE_URL || window.location.origin.replace('://affiliate.', '://')),
    () => process.env.NEXT_PUBLIC_STORE_URL || 'https://ascendpeptides.my'
  );
}

/* ── The signed-in affiliate, for every page ── */

export interface AffState {
  member: Member;
  data: MyAffiliate;
  reload: () => Promise<void>;
}
export const AffContext = createContext<AffState | null>(null);
export function useAff(): AffState {
  const v = useContext(AffContext);
  if (!v) throw new Error('useAff outside the affiliate shell');
  return v;
}

/* ── Formatting ── */

export const rm = (sen: number) =>
  `${sen < 0 ? '−' : ''}RM ${(Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function when(iso: string | Date, withTime = false) {
  return new Date(iso).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
  });
}

export const STATE_TONE: Record<OrderState, string> = {
  AWAITING_PAYMENT: 'pill-warn',
  EARNED: 'pill-ok',
  PART_REFUNDED: 'pill-info',
  REFUNDED: 'pill-bad',
  CANCELLED: 'pill-neutral',
  NOT_PAID: 'pill-neutral',
};

export const PAYOUT_TONE: Record<PayoutStatus, string> = { REQUESTED: 'pill-warn', PAID: 'pill-ok', CANCELLED: 'pill-neutral' };

/* ── Pieces ── */

export function PageHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-8">
      <div className="min-w-0">
        <h1 className="st-title fg">{title}</h1>
        {sub ? <p className="mt-1 text-[14px] leading-5 fg-2">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, help, error, children }: { label: string; help?: React.ReactNode; error?: string | null; children: React.ReactNode }) {
  // The help and error sit outside the <label>, so the field's name is just
  // its label; they are tied to the control by aria-describedby instead.
  const id = useId();
  const note = error ?? help;
  const control = isValidElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children) && note
    ? cloneElement(children, { 'aria-describedby': id, ...(error ? { 'aria-invalid': true } : {}) })
    : children;
  return (
    <div className="block">
      <label className="block">
        <span className="field-label">{label}</span>
        {control}
      </label>
      {error ? <p id={id} className="field-error">{error}</p> : help ? <p id={id} className="field-help">{help}</p> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: React.ReactNode }) {
  const bg = { info: 'var(--st-info-soft)', warn: 'var(--st-warn-soft)', bad: 'var(--st-bad-soft)', ok: 'var(--st-ok-soft)' }[tone];
  const fg = { info: 'var(--st-info)', warn: 'var(--st-warn)', bad: 'var(--st-bad)', ok: 'var(--st-ok)' }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : undefined} className="rounded-[18px] px-4 py-3 text-[13px] leading-[19px]" style={{ background: bg, color: fg }}>
      {children}
    </div>
  );
}

/** A copy button that says it worked. */
export function CopyButton({ text, label, className = 'btn btn-soft btn-sm' }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => setDone(true), () => {});
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** A small dialog in the portal's own style: sheet on a phone, card on a desktop. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Held in a ref: callers pass a new function each render, and re-running the
  // effect would hand focus back to the opener behind the scrim mid-dialog.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button.btn-ink, input')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !ref.current) return;
      // Keep Tab inside the dialog.
      const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select, textarea, a[href]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="scrim" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="st-h fg">{title}</h2>
          <button type="button" className="btn-ring -mr-2 -mt-2 h-10 w-10" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Tabs: an ink pill that travels to the current tab ── */

export function Tabs({ items }: { items: { href: string; label: string }[] }) {
  const path = usePortalPath();
  const href = useAffHref();
  // The ink moves on press, before the next page has rendered; a press only
  // counts on the page it was made on, so arriving drops it.
  const [pressed, setPressed] = useState<{ href: string; on: string } | null>(null);
  const active = (p: string) => (p === '/' ? path === '/' : path === p || path.startsWith(`${p}/`));
  const current = (pressed?.on === path ? pressed.href : null) ?? items.find((i) => active(i.href))?.href ?? null;

  const refs = useRef(new Map<string, HTMLElement | null>());
  const [box, setBox] = useState<{ x: number; w: number; h: number } | null>(null);
  const measure = useCallback(() => {
    const el = current ? refs.current.get(current) : null;
    setBox(el ? { x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight } : null);
  }, [current]);
  useLayoutEffect(() => {
    measure();
    // On a narrow strip the current tab may sit past the edge.
    const el = current ? refs.current.get(current) : null;
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const ro = new ResizeObserver(measure);
    for (const el of refs.current.values()) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, current]);

  return (
    <nav aria-label="Affiliate" className="tabs-wrap">
      <div className="tabs">
        {box ? <span aria-hidden className="tab-ink" style={{ width: box.w, height: box.h, transform: `translateX(${box.x}px)` }} /> : null}
        {items.map((i) => (
          <Link
            key={i.href}
            href={href(i.href)}
            ref={(el) => {
              refs.current.set(i.href, el);
            }}
            aria-current={i.href === current ? 'page' : undefined}
            data-unmeasured={!box ? '' : undefined}
            onClick={(e) => {
              if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) setPressed({ href: i.href, on: path });
            }}
            className="tab"
          >
            {i.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
