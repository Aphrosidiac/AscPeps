'use client';

import { useEffect, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { forgetPendingPayment, readPendingPayment, sessionIdFromUrl, type PendingPayment } from '@/lib/pending-payment';

// Statuses in which the customer still has something to do on the page.
// PROOF_SUBMITTED means they already uploaded — nothing to come back for;
// PAID/EXPIRED/CANCELLED are terminal. REJECTED needs a re-upload, so it stays.
const RESUMABLE = new Set(['OPEN', 'REJECTED']);

/**
 * "You still have an order waiting for payment" — the route back to the
 * hosted bank-transfer page for a customer who lost it (switched to their
 * banking app, reloaded, closed the tab). The session id lives only in the
 * /pay/cs_… URL, so without this the only way back is the confirmation email.
 *
 * Shows only after the live session says it is still payable; a stale entry
 * is forgotten silently. Dismissal is per page-load on purpose: the whole
 * point is to keep surfacing until the order is paid or gone.
 */
export function PendingPaymentBar() {
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const p = readPendingPayment();
    if (!p) return;
    const id = sessionIdFromUrl(p.url);
    if (!id) {
      forgetPendingPayment();
      return;
    }
    let cancelled = false;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/pay/sessions/${id}`)
      .then((r) => (r.ok ? r.json() : r.status === 404 ? { status: 'GONE' } : null))
      .then((s: { status?: string } | null) => {
        if (cancelled || !s?.status) return; // network blip: say nothing rather than nag wrongly
        if (RESUMABLE.has(s.status)) setPending(p);
        else forgetPendingPayment();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!pending || dismissed) return null;

  return (
    <div className="bg-warning text-black text-sm relative" role="status">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 pr-10 flex items-center gap-2 flex-wrap">
        <Clock className="w-4 h-4 shrink-0" />
        <span className="font-medium">
          Order {pending.orderNumber} is still waiting for payment.
        </span>
        <a href={pending.url} className="font-semibold underline underline-offset-2 hover:no-underline">
          Continue to payment
        </a>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-black/10"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
