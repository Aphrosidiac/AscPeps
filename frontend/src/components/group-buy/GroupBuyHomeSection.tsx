'use client';
import Image from 'next/image';

import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import type { GroupBuyPromo } from '@/types';
import { formatPrice } from '@/lib/utils';
import { countdown, rewardHeadline, sortTiers } from '@/lib/group-buy';
import { useNow } from '@/lib/use-now';

/**
 * The home page's Group Buy section (Admin → Group Buys → Promotion → Home
 * page section): the batch, its countdown, a few of its products with the
 * best tier price against today's store price, and the way in.
 */
export function GroupBuyHomeSection({ home }: { home: NonNullable<GroupBuyPromo['home']> }) {
  const upcoming = home.phase === 'UPCOMING';
  const now = useNow();
  const left = now === null ? null : countdown(upcoming ? home.opensAt : home.closesAt, now);

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="overflow-hidden rounded-2xl bg-[#0A0A0A] text-white grid lg:grid-cols-[1.05fr_1fr]">
        <div
          className="relative p-7 sm:p-10 flex flex-col"
          style={home.imageUrl ? { backgroundImage: `linear-gradient(rgba(10,10,10,.78), rgba(10,10,10,.86)), url(${home.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Group Buy · {home.label}</span>
            {upcoming ? (
              <span className="rounded-full bg-[#3155D9] px-2.5 py-0.5 text-xs font-medium">Opening soon</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium"><span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />Live now</span>
            )}
          </div>
          <h2 className="mt-4 font-display text-3xl sm:text-4xl font-bold tracking-tight leading-[1.05]">{home.title}</h2>
          {home.body && <p className="mt-3 max-w-lg text-white/70 leading-relaxed">{home.body}</p>}

          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">{upcoming ? 'Opens in' : 'Closes in'}</p>
            <div className="mt-2 flex gap-2" suppressHydrationWarning>
              {([['d', 'days'], ['h', 'hrs'], ['m', 'min'], ['s', 'sec']] as const).map(([k, l]) => (
                <span key={k} className="flex min-w-[56px] flex-col items-center rounded-lg bg-white/[0.08] px-2 py-2">
                  <span className="font-display text-2xl font-semibold tabular-nums" suppressHydrationWarning>{left ? String(left[k]).padStart(2, '0') : '–'}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/50">{l}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/70">
            {home.joined != null && <span className="inline-flex items-center gap-1.5"><Users className="w-4 h-4" /> {home.joined} {home.joinedLabel}</span>}
            {home.shipEstimate && <span>Ships {home.shipEstimate}</span>}
            <span>{home.itemCount} product{home.itemCount === 1 ? '' : 's'}</span>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3 lg:mt-auto lg:pt-7">
            <Link href={`/group-buy/${home.slug}`} className="inline-flex h-12 items-center gap-2 rounded-lg bg-[#22C55E] px-6 text-[15px] font-semibold text-[#0A0A0A] transition-colors hover:bg-[#1eb455]">
              {home.cta} <ArrowRight className="w-4 h-4" />
            </Link>
            {home.reward && <span className="text-sm text-white/70">{rewardHeadline(home.reward)}</span>}
          </div>
        </div>

        <div className="border-t border-white/10 lg:border-t-0 lg:border-l p-4 sm:p-6">
          <ul className="divide-y divide-white/10">
            {home.items.map((i) => {
              const tiers = sortTiers(i.tiers);
              const perVial = i.sellUnit === 'KIT' ? i.packSize : 1;
              const best = tiers[tiers.length - 1];
              const bestVial = Math.round(best.price / perVial);
              const off = i.storePrice > 0 ? Math.round((1 - bestVial / i.storePrice) * 100) : 0;
              return (
                <li key={i.name} className="flex items-center gap-3 py-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/10">
                    {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="48px" className="object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-white/50">{i.sellUnit === 'KIT' ? `Kit of ${i.packSize} vials` : 'Per vial'} · {tiers.length} price tier{tiers.length === 1 ? '' : 's'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">from {formatPrice(bestVial)}<span className="text-white/50 font-normal">/vial</span></p>
                    <p className="text-xs text-white/50"><span className="line-through">{formatPrice(i.storePrice)}</span>{off > 0 ? ` · ${off}% off` : ''}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {home.itemCount > home.items.length && (
            <Link href={`/group-buy/${home.slug}`} className="mt-2 inline-flex items-center gap-1 text-sm text-white/70 hover:text-white">
              +{home.itemCount - home.items.length} more in the batch <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
