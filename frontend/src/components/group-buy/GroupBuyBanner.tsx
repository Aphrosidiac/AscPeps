'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import type { GroupBuyPromo } from '@/types';
import { countdown } from '@/lib/group-buy';
import { useNow } from '@/lib/use-now';

const noSubscribe = () => () => {};

const TONE = {
  INK: 'bg-[#0A0A0A] text-white',
  GREEN: 'bg-[#22C55E] text-[#0A0A0A]',
  COBALT: 'bg-[#3155D9] text-white',
} as const;

/**
 * The Group Buy banner across the top of the store, replacing the
 * announcement bar while a batch has it on (Admin → Group Buys → Promotion).
 * Closing it hides it for this visit only — the batch is time-limited.
 */
export function GroupBuyBanner({ banner }: { banner: NonNullable<GroupBuyPromo['banner']> }) {
  const key = `ascend-gb-banner-hidden:${banner.slug}`;
  const [closedNow, setClosedNow] = useState(false);
  // Closed earlier this visit? Read from sessionStorage after hydration
  // (false on the server), without a mount effect.
  const closedBefore = useSyncExternalStore(noSubscribe, () => {
    try { return !!sessionStorage.getItem(key); } catch { return false; }
  }, () => false);
  const hidden = closedNow || closedBefore;
  const now = useNow();
  const c = now === null ? null : countdown(banner.phase === 'UPCOMING' ? banner.opensAt : banner.closesAt, now);
  const left = !c || c.done ? null : c.d > 0 ? `${c.d}d ${c.h}h` : `${c.h}h ${c.m}m`;

  if (hidden) return null;
  return (
    <div className={`relative ${TONE[banner.tone] ?? TONE.INK}`}>
      <Link href={`/group-buy/${banner.slug}`} className="flex items-center justify-center gap-x-3 gap-y-0.5 flex-wrap px-10 py-2 text-center text-[13px] leading-snug">
        <span className="font-medium">{banner.text}</span>
        {left && <span className="opacity-80 tabular-nums">{banner.phase === 'UPCOMING' ? 'Opens in' : 'Ends in'} {left}</span>}
        <span className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">{banner.cta} <ArrowRight className="w-3.5 h-3.5" /></span>
      </Link>
      <button
        type="button"
        aria-label="Hide banner"
        onClick={() => { setClosedNow(true); try { sessionStorage.setItem(key, '1'); } catch { /* storage blocked */ } }}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded opacity-70 hover:opacity-100 cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
