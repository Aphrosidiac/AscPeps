'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiError, requestMyPayout } from '@/lib/affiliate-api';
import { Notice, Sheet, rm, useAff, useAffHref, when } from './aff-ui';

/** Ask for everything available; one payout on its way at a time. */
export function PayoutButton() {
  const { data, reload } = useAff();
  const a = data.affiliate!;
  const b = data.balance!;
  const href = useAffHref();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hold = data.programme.holdDays;

  if (data.openPayout) {
    return (
      <div className="rounded-[18px] px-4 py-3" style={{ background: 'var(--st-warn-soft)', color: 'var(--st-warn)' }}>
        <p className="text-[14px] font-medium">{rm(data.openPayout.amount)} payout on its way</p>
        <p className="mt-0.5 text-[13px] leading-[19px]">Asked {when(data.openPayout.createdAt, true)} · paid from {when(data.openPayout.availableAt, true)}</p>
      </div>
    );
  }
  if (!a.bankName || !a.bankAccountNumber) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href={href('/settings')} className="btn btn-ink">Add bank details</Link>
        <p className="text-[13px] fg-2">So we know where to pay you.</p>
      </div>
    );
  }
  if (a.status !== 'ACTIVE') return <p className="text-[13px] fg-2">Payouts are paused while your code is paused.</p>;

  const last4 = a.bankAccountNumber.slice(-4);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ink" disabled={b.available <= 0} onClick={() => (setError(''), setOpen(true))}>
          {b.available > 0 ? `Ask for a payout · ${rm(b.available)}` : 'Ask for a payout'}
        </button>
        {b.available <= 0 ? <p className="text-[13px] fg-2">You can ask once you have a balance.</p> : null}
      </div>
      {open ? (
        <Sheet title="Ask for a payout" onClose={() => !busy && setOpen(false)}>
          <p className="st-big fg">{rm(b.available)}</p>
          <p className="mt-3 text-[14px] leading-[21px] fg-2">
            To {a.bankName} ••••{last4} ({a.bankAccountName}). We pay {hold === 0 ? 'once we have checked it' : `at least ${hold} ${hold === 1 ? 'day' : 'days'} after you ask`}, so any
            refund lands first — if one does, it comes off this amount.
          </p>
          {error ? (
            <div className="mt-4">
              <Notice tone="bad">{error}</Notice>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button
              type="button"
              className="btn btn-ink"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await requestMyPayout();
                  await reload();
                  setOpen(false);
                } catch (err) {
                  setError(apiError(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Sending…' : 'Ask for it'}
            </button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
