'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

/**
 * The first look after approval: a spotlight over the real dashboard, one
 * thing at a time — balance, code, then each tab and the Guide. Shown once
 * per affiliate on this browser (on Overview), and again from the account
 * menu's "Take the tour" (/?tour=1). Targets are marked with data-tour; the
 * visible one is used, so it works with the phone's second row of tabs too.
 */

interface Stop {
  target: string | null;
  title: string;
  body: string;
}

const PAD = 8;
const doneKey = (id: string) => `ascend-aff-tour:${id}`;

export function Tour({ affiliateId, firstName, discountPct, commission, path }: { affiliateId: string; firstName: string; discountPct: number; commission: string; path: string }) {
  const stops: Stop[] = [
    { target: null, title: `Welcome, ${firstName} — you’re live`, body: 'Your code works at checkout from now on. Here’s a quick look at where everything is.' },
    { target: 'balance', title: 'Available now', body: 'What you can ask for today. New commission waits in a short hold first, then lands here.' },
    { target: 'code', title: 'Your code and link', body: `Copy either one and share it. Your people get ${discountPct}% off; you earn ${commission} of what they pay.` },
    { target: 'tab:/products', title: 'Products', body: 'Every product with what it earns you — and a link for each one.' },
    { target: 'tab:/orders', title: 'Orders', body: 'Every order made with your code and what it earned. Never who bought it.' },
    { target: 'tab:/payouts', title: 'Payouts', body: 'Your payouts, and every change to your balance.' },
    { target: 'tab:/settings', title: 'Settings', body: 'Your bank account and contact details. Changes go to us to approve.' },
    { target: 'guide', title: 'The Guide', body: 'Everything explained — earning, payouts, refunds, rules. It’s in your account menu too.' },
  ];

  const [on, setOn] = useState(false);
  const [i, setI] = useState(0);
  // The target's box, kept with the target it belongs to.
  const [box, setBox] = useState<{ target: string; rect: DOMRect } | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Start: first visit to Overview, or asked for with ?tour=1.
  useEffect(() => {
    if (path !== '/') return;
    let asked = false;
    let seen = true;
    try {
      asked = new URLSearchParams(window.location.search).get('tour') === '1';
      seen = localStorage.getItem(doneKey(affiliateId)) === '1';
    } catch {
      /* storage blocked: no tour rather than one every visit */
    }
    if (!asked && seen) return;
    const t = setTimeout(() => (setI(0), setOn(true)), 600);
    return () => clearTimeout(t);
  }, [path, affiliateId]);

  // "Take the tour" while already on Overview (the URL change alone wouldn't re-run the above).
  useEffect(() => {
    const start = () => path === '/' && (setI(0), setOn(true));
    window.addEventListener('ascend-aff-tour', start);
    return () => window.removeEventListener('ascend-aff-tour', start);
  }, [path]);

  const finish = useCallback(() => {
    setOn(false);
    try {
      localStorage.setItem(doneKey(affiliateId), '1');
    } catch {
      /* fine */
    }
    if (new URLSearchParams(window.location.search).has('tour')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('tour');
      window.history.replaceState(null, '', url);
    }
  }, [affiliateId]);

  const stop = stops[i];

  // Find the visible target, bring it into view, and follow it.
  useLayoutEffect(() => {
    const target = stop.target;
    if (!on || !target) return;
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find((e) => e.offsetParent !== null);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center' });
    const measure = () => setBox({ target, rect: el.getBoundingClientRect() });
    // A timer, not an animation frame: it still runs in a background tab.
    const frame = setTimeout(measure, 0);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [on, i, stop.target]);
  const measured = box && box.target === stop.target ? box.rect : null;
  // A target taller than the room left for the card (the balance panel on a
  // phone): light its top part and keep the card clear below it.
  const room = typeof window === 'undefined' ? 0 : window.innerHeight - 210 - (PAD + 12) - 16;
  const rect =
    measured && measured.bottom > room && measured.top < room - 80 && measured.top - (PAD + 12) - 210 <= 16 && measured.width > window.innerWidth - 120
      ? new DOMRect(measured.left, measured.top, measured.width, room - measured.top)
      : measured;

  useEffect(() => {
    if (!on) return;
    nextRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, stops.length - 1));
      if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [on, i, finish, stops.length]);

  if (!on) return null;
  // Target not measured yet (a frame): just the dim, so the card doesn't flash in the middle.
  if (stop.target && !rect) return <div aria-hidden className="fixed inset-0 z-[70]" style={{ background: 'rgb(10 10 10 / 0.6)' }} />;

  const last = i === stops.length - 1;
  const W = Math.min(340, window.innerWidth - 32);
  // The card goes below the target when there's room, else above; centred with no target.
  let cardStyle: React.CSSProperties;
  if (rect) {
    // Below if it fits, else above, else beside (right, then left) — never off-screen.
    const CARD_H = 210;
    const GAP = PAD + 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const centred = Math.min(Math.max(16, rect.left + rect.width / 2 - W / 2), vw - W - 16);
    const sideTop = Math.min(Math.max(16, rect.top + rect.height / 2 - CARD_H / 2), vh - CARD_H - 16);
    if (rect.bottom + GAP + CARD_H < vh) cardStyle = { top: rect.bottom + GAP, left: centred, width: W };
    else if (rect.top - GAP - CARD_H > 16) cardStyle = { bottom: vh - rect.top + GAP, left: centred, width: W };
    else if (rect.right + GAP + W < vw - 16) cardStyle = { top: sideTop, left: rect.right + GAP, width: W };
    else if (rect.left - GAP - W > 16) cardStyle = { top: sideTop, left: rect.left - GAP - W, width: W };
    else cardStyle = { bottom: 16, left: centred, width: W };
  } else {
    // Centred by layout (the wrapper below), not by a transform the card's fade-in would override.
    cardStyle = { width: Math.min(420, window.innerWidth - 32) };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* The dim, with a window cut around the target. */}
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[24px] transition-all duration-300 ease-out"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 2px rgb(255 255 255 / 0.9), 0 0 0 9999px rgb(10 10 10 / 0.6)',
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0" style={{ background: 'rgb(10 10 10 / 0.6)' }} />
      )}

      <div className={rect ? 'contents' : 'fixed inset-0 flex items-center justify-center p-4'}>
        <div key={i} className={`aff-tour-card pop p-5 ${rect ? 'fixed' : 'relative'}`} style={cardStyle}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[12px] font-medium fg-3 tnum">
              {i === 0 ? 'Quick tour' : `${i} of ${stops.length - 1}`}
            </p>
            <button type="button" onClick={finish} aria-label="Skip the tour" className="-mr-1 -mt-1 rounded-full p-1 fg-3 hover:fg">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <h2 id="tour-title" className="st-h fg mt-1">{stop.title}</h2>
          <p className="mt-1.5 text-[14px] leading-[21px] fg-2">{stop.body}</p>
          <div className="mt-5 flex items-center gap-2">
            {i > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={finish}>Skip</button>
            )}
            <div className="flex flex-1 justify-center gap-1" aria-hidden>
              {stops.slice(1).map((_, n) => (
                <span key={n} className="h-1.5 w-1.5 rounded-full" style={{ background: n + 1 <= i ? 'var(--st-solid)' : 'var(--st-hair)' }} />
              ))}
            </div>
            <button ref={nextRef} type="button" className="btn btn-ink btn-sm" onClick={() => (last ? finish() : setI(i + 1))}>
              {i === 0 ? 'Show me' : last ? 'Done' : 'Next'} {last ? null : <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
