'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { AffiliateEarnings } from '@/components/popups/AffiliateEarnings';
import { AFFILIATE_URL } from '@/lib/affiliate-url';
import { getMyAffiliate } from '@/lib/affiliate-api';
import type { AffiliateOffer } from '@/lib/affiliate-offer';

/*
 * Where the store promotes Ascend Affiliate besides the popup: the homepage,
 * a confirmed order, the account page (and the footer link). All from the one
 * live offer (lib/affiliate-offer.ts): with the programme off, none of them
 * render. Copy says only what the programme does — the code's discount, the
 * commission, payouts to their bank, free to join.
 */

const OfferContext = createContext<AffiliateOffer | null>(null);

export function AffiliateOfferProvider({ offer, children }: { offer: AffiliateOffer | null; children: React.ReactNode }) {
  return <OfferContext value={offer}>{children}</OfferContext>;
}

export const useAffiliateOffer = () => useContext(OfferContext);

const join = AFFILIATE_URL;
const guide = `${AFFILIATE_URL.replace(/\/$/, '')}/guide`;

function pitch(o: AffiliateOffer) {
  return `Get your own code: anyone who uses it gets ${o.discountPct}% off, and you earn ${o.commission} of every paid order, paid to your bank. Free to join.`;
}

/** Homepage: a section after the products. */
export function AffiliateBand() {
  const o = useAffiliateOffer();
  if (!o) return null;
  return (
    <section aria-labelledby="aff-band-h" className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16 lg:px-8">
        <div>
          <h2 id="aff-band-h" className="font-display text-2xl font-bold md:text-3xl">
            Share Ascend. Earn {o.commission} of every order.
          </h2>
          <p className="mt-4 max-w-xl text-[16px] leading-relaxed text-text-secondary">{pitch(o)}</p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <a href={join} className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-[15px] font-semibold text-white hover:bg-primary-light">
              Become an affiliate <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <a href={guide} className="text-[15px] font-medium text-text-primary underline underline-offset-4 decoration-border-hover hover:decoration-text-primary">
              How it works
            </a>
          </div>
        </div>
        <AffiliateEarnings discountPct={o.discountPct} rateBps={o.rateBps} className="" />
      </div>
    </section>
  );
}

/** After a confirmed order: they just bought, so they know what they would be sharing. */
export function AffiliateOrderCard() {
  const o = useAffiliateOffer();
  if (!o) return null;
  return (
    <section aria-labelledby="aff-order-h" className="mt-10 rounded-xl border border-border bg-surface p-5 text-left sm:p-6">
      <h2 id="aff-order-h" className="font-display text-[20px] font-bold">Liked your order? Share Ascend.</h2>
      <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">{pitch(o)}</p>
      <AffiliateEarnings discountPct={o.discountPct} rateBps={o.rateBps} className="mt-5" />
      <a href={join} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-semibold text-white hover:bg-primary-light">
        Become an affiliate <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </section>
  );
}

/**
 * Account page, under their details. Someone already in gets their code and a
 * way to their dashboard instead of an invitation to join.
 */
export function AffiliateAccountCard() {
  const o = useAffiliateOffer();
  const [mine, setMine] = useState<{ code: string; status: string } | null>(null);
  useEffect(() => {
    let alive = true;
    getMyAffiliate()
      .then((r) => { if (alive && r.affiliate) setMine({ code: r.affiliate.code, status: r.affiliate.status }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!o && !mine) return null;

  if (mine && mine.status !== 'REJECTED') {
    return (
      <a href={join} className="group mt-4 block rounded-[10px] border border-[#0A0A0A]/10 bg-white p-5 hover:border-[#0A0A0A]/25">
        <p className="text-[13px] text-[#0A0A0A]/60">{mine.status === 'APPLIED' ? 'Your affiliate application' : 'Your affiliate code'}</p>
        <p className="mt-1 font-display text-xl font-semibold tracking-[0.04em]">{mine.code}</p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold">
          Open Ascend Affiliate <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden="true" />
        </p>
      </a>
    );
  }
  if (!o) return null;
  return (
    <div className="mt-4 rounded-[10px] border border-[#0A0A0A]/10 bg-white p-5">
      <p className="font-display text-lg font-bold">Earn with Ascend</p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[#0A0A0A]/60">
        Your friends get {o.discountPct}% off with your code, and you earn {o.commission} of every paid order. Free to join, with this account.
      </p>
      <a href={join} className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-[#0A0A0A] px-5 text-sm font-semibold text-white hover:bg-[#262626]">
        Become an affiliate <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  );
}
