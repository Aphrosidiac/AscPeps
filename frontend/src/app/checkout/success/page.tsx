'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Clock } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';

// useSearchParams needs a Suspense boundary above it or the static build of
// this route bails out to client rendering for the whole page.
export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutSuccessContent />
    </Suspense>
  );
}

function CheckoutSuccessContent() {
  const { clearCart, hydrated } = useCart();
  const cleared = useRef(false);
  const params = useSearchParams();
  // The hosted bank-transfer checkout lands here after the customer uploads
  // proof — nothing is confirmed yet, a person still has to check it. Same
  // page, different words: "confirmed" here would be a lie for a few hours.
  const sessionId = params.get('session_id');
  // A customer can come back to this URL hours later, after the proof was
  // approved — then "verifying" would be stale. Read the live session state
  // and let it override the query-string hint.
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId || !/^cs_[A-Za-z0-9]{24}$/.test(sessionId)) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/pay/sessions/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { status?: string } | null) => s?.status && setSessionStatus(s.status))
      .catch(() => {});
  }, [sessionId]);
  const manual = params.get('manual') === '1' && sessionStatus !== 'PAID';

  // Checkout hands the customer to the gateway without clearing the cart, so
  // that abandoning payment leaves it intact to retry. This is the point where
  // the payment actually went through, so this is where the cart empties.
  //
  // Must wait for `hydrated`. CartProvider loads localStorage in its own
  // effect, and child effects run before parent ones — clearing on mount is
  // immediately undone when the provider's LOAD lands a moment later, leaving
  // a paid-for cart sitting in the header.
  //
  // The ref + `hydrated`-only dep list are also deliberate: CartProvider builds
  // its context value inline, so `clearCart` has a fresh identity every render
  // and depending on it would re-run this effect after its own dispatch.
  useEffect(() => {
    if (!hydrated || cleared.current) return;
    cleared.current = true;
    clearCart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
      <Animate variant="scale" duration={0.5}>
        {manual ? (
          <Clock className="w-16 h-16 text-primary mx-auto mb-4" />
        ) : (
          <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
        )}
        <h1 className="font-display text-2xl font-bold mb-2">{manual ? 'Proof received — verifying' : 'Payment Successful!'}</h1>
        <p className="text-text-secondary mb-6">
          {manual
            ? 'We have your payment screenshot. A team member will check it against your order, usually within a few hours during business hours, and you will get a receipt by email once it is confirmed.'
            : 'Your payment has been confirmed. Your order is now being processed — check your order status anytime on the Track Order page.'}
        </p>
        {manual && sessionId && (
          <p className="text-xs text-text-muted mb-6">
            Need to upload a different screenshot? <Link href={`/pay/${sessionId}`} className="text-primary-light hover:underline">Reopen the payment page</Link>.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/products"><Button variant="primary">Continue Shopping</Button></Link>
          <Link href="/track"><Button variant="outline">Track Order</Button></Link>
        </div>

        <p className="text-xs text-text-muted mt-4">
          You can view and download your receipt from the <Link href="/track" className="text-primary-light hover:underline">Track Order</Link> page.
        </p>
      </Animate>
    </div>
  );
}
