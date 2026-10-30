'use client';
import Image from 'next/image';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import { ArrowRight, Check, X } from 'lucide-react';
import type { GroupBuyPromo } from '@/types';
import { rewardHeadline, rewardOff } from '@/lib/group-buy';
import { signupGroupBuy } from '@/lib/group-buy-api';
import { Button } from '@/components/ui/Button';

// Never between a shopper and a purchase, or on pages they came to finish a job on.
const EXCLUDED = ['/checkout', '/cart', '/account', '/admin', '/unsubscribe', '/track', '/receipt', '/pay', '/group-buy'];

type Popup = NonNullable<GroupBuyPromo['popup']>;

function onPage(pages: Popup['pages'], path: string): boolean {
  if (EXCLUDED.some((p) => path.startsWith(p))) return false;
  if (pages === 'HOME') return path === '/';
  if (pages === 'PRODUCTS') return path.startsWith('/products');
  return true;
}

/** Has this popup already been shown as often as the batch allows? */
function seen(p: Popup): boolean {
  try {
    const k = `ascend-gb-popup:${p.key}`;
    if (p.frequency === 'SESSION') return !!sessionStorage.getItem(k);
    if (p.frequency === 'EVERY') return false;
    const at = Number(localStorage.getItem(k));
    if (!at) return false;
    return p.frequency === 'ONCE' ? true : Date.now() - at < 24 * 3600 * 1000;
  } catch {
    return true; // storage blocked: cannot tell, so do not nag
  }
}

function markSeen(p: Popup) {
  try {
    const k = `ascend-gb-popup:${p.key}`;
    if (p.frequency === 'SESSION') sessionStorage.setItem(k, '1');
    else localStorage.setItem(k, String(Date.now()));
  } catch { /* storage blocked */ }
}

/**
 * The Group Buy popup (Admin → Group Buys → Promotion): opens after the set
 * delay on the chosen pages, as often as the batch says, with the sign-up box
 * when the batch has a reward. While it is on, the newsletter popup stays shut.
 */
export function GroupBuyPopup({ popup }: { popup: Popup }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  // The page it last opened on. "Every page view" means once per page: closing
  // it must not start the timer again on the same page.
  const shownOn = useRef<string | null>(null);

  useEffect(() => {
    if (open || shownOn.current === pathname || !onPage(popup.pages, pathname) || seen(popup)) return;
    const t = setTimeout(() => {
      markSeen(popup);
      shownOn.current = pathname;
      setOpen(true);
      posthog.capture('group_buy_popup_shown', { batch: popup.slug, path: pathname });
    }, Math.max(popup.delaySec, 0) * 1000);
    return () => clearTimeout(t);
  }, [popup, pathname, open]);

  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('busy');
    try {
      const r = await signupGroupBuy(popup.slug, { email, source: 'POPUP' });
      setState('done');
      setMessage(r.reward ? 'You’re on the list — your code is on its way to your inbox.' : 'You’re on the list. We’ll email you as the batch moves.');
      posthog.capture('group_buy_signup', { batch: popup.slug, source: 'POPUP' });
    } catch (err) {
      setState('error');
      setMessage((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Could not sign you up. Try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog-backdrop absolute inset-0 bg-black/0 sm:bg-black/50 sm:backdrop-blur-[2px]" aria-hidden />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="gb-popup-title" className="sheet-rise relative w-full sm:max-w-md bg-surface border-t sm:border border-border sm:rounded-2xl shadow-2xl overflow-hidden">
        <button type="button" onClick={close} aria-label="Close" className="absolute top-3 right-3 z-10 p-2 rounded-lg bg-surface/80 text-text-muted hover:text-text-primary cursor-pointer">
          <X className="w-4 h-4" />
        </button>
        {popup.imageUrl && <Image src={popup.imageUrl} alt="" width={640} height={337} sizes="(min-width: 640px) 448px, 100vw" className="w-full aspect-[1.9] object-cover" />}
        <div className="p-5 sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Group Buy · {popup.label}</p>
          <h2 id="gb-popup-title" className="mt-1 font-display text-xl font-bold leading-snug pr-8">{popup.title}</h2>
          {popup.body && <p className="mt-1.5 text-sm text-text-secondary leading-relaxed">{popup.body}</p>}

          {popup.reward && popup.phase !== 'CLOSED' && (
            <div className="mt-4 rounded-xl border border-border bg-surface-elevated/60 p-4">
              <p className="text-sm font-semibold">{rewardHeadline(popup.reward)}</p>
              {state === 'done' ? (
                <p className="mt-2 flex items-start gap-2 text-sm text-success"><Check className="w-4 h-4 mt-0.5 shrink-0" />{message}</p>
              ) : (
                <form onSubmit={join} className="mt-3 flex gap-2">
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address"
                    className="min-w-0 flex-1 h-11 rounded-lg border border-border bg-surface px-3 text-base focus:outline-none focus:border-primary" />
                  <Button type="submit" disabled={state === 'busy'} className="h-11 shrink-0">{state === 'busy' ? '…' : `Get ${rewardOff(popup.reward)}`}</Button>
                </form>
              )}
              {state === 'error' && <p className="mt-2 text-xs text-danger">{message}</p>}
              {state !== 'done' && <p className="mt-2 text-xs text-text-muted">Single-use code, emailed to you{popup.reward.validDays ? ` and valid ${popup.reward.validDays} days` : ''}.</p>}
            </div>
          )}

          <Link href={`/group-buy/${popup.slug}`} onClick={close} className="mt-4 inline-flex">
            <Button variant={popup.reward ? 'secondary' : 'primary'}>{popup.cta} <ArrowRight className="w-4 h-4" /></Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
