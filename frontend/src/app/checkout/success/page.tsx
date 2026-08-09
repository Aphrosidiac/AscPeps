'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { CheckCircle } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';

export default function CheckoutSuccessPage() {
  const { clearCart, hydrated } = useCart();
  const cleared = useRef(false);

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
        <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Payment Successful!</h1>
        <p className="text-text-secondary mb-6">
          Your payment has been confirmed. Your order is now being processed — check your order status anytime on the Track Order page.
        </p>

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
