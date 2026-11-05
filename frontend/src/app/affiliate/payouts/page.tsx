'use client';

import { useEffect, useState } from 'react';
import { ENTRY_LABEL, getMyEntries, getMyPayouts, type Entry, type Payout } from '@/lib/affiliate-api';
import { GuideLink, PageHead, PAYOUT_TONE, rm, useAff, when } from '../aff-ui';
import { PayoutButton } from '../PayoutButton';

const PAYOUT_LABEL = { REQUESTED: 'On its way', PAID: 'Paid', CANCELLED: 'Cancelled' } as const;

export default function AffiliatePayouts() {
  const { data } = useAff();
  const b = data.balance!;
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  // Re-read whenever the balance moves (a new request, a payout marked paid).
  useEffect(() => {
    getMyPayouts().then((r) => setPayouts(r.payouts), () => setPayouts([]));
    getMyEntries().then((r) => setEntries(r.entries), () => setEntries([]));
  }, [b.balance, b.requested]);

  return (
    <>
      <PageHead
        title="Payouts"
        sub={data.programme.holdDays ? `Paid to your bank at least ${data.programme.holdDays} ${data.programme.holdDays === 1 ? 'day' : 'days'} after you ask` : 'Paid to your bank once you ask'}
        actions={<GuideLink section="payouts">How payouts work</GuideLink>}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="panel p-6 sm:p-8">
          <p className="st-label">Available to ask for</p>
          <p className="st-big mt-2 fg">{rm(b.available)}</p>
          <div className="mt-6">
            <PayoutButton />
          </div>
          <h2 className="st-h fg mt-10">Your payouts</h2>
          {payouts === null ? (
            <div className="mt-4 h-24 rounded-[18px]" style={{ background: 'var(--st-field)', opacity: 0.6 }} />
          ) : payouts.length === 0 ? (
            <p className="mt-3 text-[14px] fg-2">None yet.</p>
          ) : (
            <ul className="mt-3">
              {payouts.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-4 border-t py-3.5 first:border-t-0" style={{ borderColor: 'var(--st-hair)' }}>
                  <div className="min-w-0">
                    <span className={`pill ${PAYOUT_TONE[p.status]}`}>{PAYOUT_LABEL[p.status]}</span>
                    <p className="mt-1.5 text-[12px] leading-[17px] fg-3">
                      {p.status === 'PAID' && p.paidAt
                        ? `Paid ${when(p.paidAt)}${p.reference ? ` · ref ${p.reference}` : ''}`
                        : p.status === 'CANCELLED'
                          ? p.cancelReason || 'Cancelled'
                          : `Asked ${when(p.createdAt)} · paid from ${when(p.availableAt, true)}`}
                    </p>
                    {p.status === 'PAID' && p.paidAmount != null && p.paidAmount < p.amount ? (
                      <p className="text-[12px] leading-[17px] fg-3">You asked for {rm(p.amount)}; a refund since then came off it.</p>
                    ) : null}
                  </div>
                  <p className="shrink-0 whitespace-nowrap text-[15px] font-medium fg tnum">{rm(p.paidAmount ?? p.amount)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-6 sm:p-8">
          <h2 className="st-h fg">Every change to your balance</h2>
          <p className="st-sub mt-1">Newest first</p>
          {entries === null ? (
            <div className="mt-4 h-40 rounded-[18px]" style={{ background: 'var(--st-field)', opacity: 0.6 }} />
          ) : entries.length === 0 ? (
            <p className="mt-4 text-[14px] fg-2">Nothing yet.</p>
          ) : (
            <ul className="mt-3">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 border-t py-3 first:border-t-0" style={{ borderColor: 'var(--st-hair)' }}>
                  <div className="min-w-0">
                    <p className="text-[14px] fg">
                      {ENTRY_LABEL[e.kind]}
                      {e.orderNumber ? <span className="fg-3 tnum"> · {e.orderNumber}</span> : null}
                    </p>
                    <p className="text-[12px] fg-3">
                      {when(e.at)}
                      {e.note && e.kind !== 'PAYOUT' ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                  <p className="text-[14px] font-medium tnum" style={{ color: e.amount < 0 ? 'var(--st-fg-2)' : 'var(--st-ok)' }}>
                    {e.amount > 0 ? '+' : ''}
                    {rm(e.amount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
