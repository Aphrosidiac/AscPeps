'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getMyAffiliateOrders, STATE_LABEL, type AffiliateOrder } from '@/lib/affiliate-api';
import { CopyButton, PageHead, STATE_TONE, rm, useAff, useAffHref, useStoreOrigin, when } from './aff-ui';
import { PayoutButton } from './PayoutButton';

export default function AffiliateOverview() {
  const { data } = useAff();
  const a = data.affiliate!;
  const b = data.balance!;
  const href = useAffHref();
  const store = useStoreOrigin();
  const link = `${store.replace(/\/$/, '')}/?ref=${a.code}`;
  const [recent, setRecent] = useState<AffiliateOrder[] | null>(null);

  useEffect(() => {
    getMyAffiliateOrders(1).then((r) => setRecent(r.data.slice(0, 5)), () => setRecent([]));
  }, [b.balance, b.awaitingPaymentOrders]);

  return (
    <>
      <PageHead
        title={`Hi, ${a.fullName.split(' ')[0]}`}
        sub={a.status === 'PAUSED' ? 'Your code is paused — it does nothing at checkout until we switch it back on.' : `Your code gives ${a.customerDiscountPct}% off · you earn ${a.commission}`}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Balance and the one action that matters. */}
        <section className="panel p-6 sm:p-8" aria-labelledby="bal-h">
          <p id="bal-h" className="st-label">Your balance</p>
          <p className="st-big mt-2 fg" style={b.balance < 0 ? { color: 'var(--st-bad)' } : undefined}>{rm(b.balance)}</p>
          {b.balance < 0 ? (
            <p className="mt-2 text-[13px] leading-[19px] fg-2">An order was refunded after its commission was paid to you. New commission pays this off first.</p>
          ) : null}
          <div className="mt-6">
            <PayoutButton />
          </div>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="tint tint-mint">
              <p className="st-label fg-2">Earned</p>
              <p className="st-fig mt-1 fg">{rm(b.earned - b.reversed)}</p>
            </div>
            <div className="tint tint-butter">
              <p className="st-label fg-2">Waiting for payment</p>
              <p className="st-fig mt-1 fg">{rm(b.awaitingPayment)}</p>
              <p className="mt-1 text-[12px] fg-2">{b.awaitingPaymentOrders} {b.awaitingPaymentOrders === 1 ? 'order' : 'orders'}</p>
            </div>
            <div className="tint tint-sky">
              <p className="st-label fg-2">Paid to you</p>
              <p className="st-fig mt-1 fg">{rm(b.paidOut)}</p>
            </div>
          </div>
        </section>

        {/* The code: what they actually share. */}
        <section className="panel flex flex-col p-6 sm:p-8" aria-labelledby="code-h">
          <p id="code-h" className="st-label">Your code</p>
          <p className="mt-2 text-[34px] leading-10 font-medium tracking-[0.04em] fg">{a.code}</p>
          <p className="mt-1 text-[13px] leading-[19px] fg-2">{a.customerDiscountPct}% off for anyone who uses it at checkout.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <CopyButton text={a.code} label="Copy code" className="btn btn-ink btn-sm" />
            <CopyButton text={link} label="Copy link" />
          </div>
          <div className="mt-6 rounded-[18px] px-4 py-3" style={{ background: 'var(--st-field)' }}>
            <p className="st-label">Your link</p>
            <p className="mt-1 break-all text-[13px] leading-[19px] fg">{link}</p>
            <p className="mt-1 text-[12px] leading-4 fg-3">Opens the store with your code already filled in at checkout.</p>
          </div>
          <p className="mt-auto pt-6 text-[12px] leading-[17px] fg-3">{data.paidOrdersThisMonth ?? 0} paid {data.paidOrdersThisMonth === 1 ? 'order' : 'orders'} with your code this month.</p>
        </section>
      </div>

      <section className="panel mt-5 p-6 sm:p-8" aria-labelledby="recent-h">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="recent-h" className="st-h fg">Latest orders</h2>
            <p className="st-sub mt-1">Orders made with your code</p>
          </div>
          <Link href={href('/orders')} className="btn-ring" aria-label="All orders">
            <ArrowUpRight className="h-[18px] w-[18px]" aria-hidden />
          </Link>
        </div>
        {recent === null ? (
          <div className="mt-6 h-24 rounded-[18px]" style={{ background: 'var(--st-field)', opacity: 0.6 }} />
        ) : recent.length === 0 ? (
          <p className="mt-6 text-[14px] fg-2">No orders yet. Share your code and they&apos;ll show up here.</p>
        ) : (
          <ul className="mt-4">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-4 border-t py-3.5 first:border-t-0" style={{ borderColor: 'var(--st-hair)' }}>
                <div className="min-w-0">
                  <p className="text-[14px] font-medium fg tnum">{o.orderNumber}</p>
                  <p className="text-[12px] fg-3">{when(o.placedAt)}</p>
                </div>
                <span className={`pill ${STATE_TONE[o.state]} hidden sm:inline-flex`}>{STATE_LABEL[o.state]}</span>
                <p className="w-28 text-right text-[14px] font-medium fg tnum">{rm(o.commission)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
