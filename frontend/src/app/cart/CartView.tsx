'use client';

import Link from 'next/link';
import posthog from 'posthog-js';
import { useCart } from '@/lib/cart';
import { lineIdOf } from '@/lib/cart-lines';
import { Button } from '@/components/ui/Button';
import { CartLine, CartTotals, useRemoveWithUndo } from '@/components/cart/cart-shared';

export function CartView({ suggestions }: { suggestions: React.ReactNode }) {
  const { items, hydrated, itemCount, total } = useCart();
  const { remove, undoBar } = useRemoveWithUndo();

  // The cart lives in this browser and loads after the first paint: until it
  // has, say nothing rather than flash "empty".
  if (!hydrated) return <div className="min-h-[60vh]" />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <h1 className="mb-8 font-display text-3xl font-bold">Your cart</h1>

      {items.length === 0 ? (
        <div className="space-y-8">
          <div className="space-y-3">
            <p className="text-[16px] text-text-secondary">
              Your cart is empty. Choose a product below, or{' '}
              <Link href="/products" className="font-medium text-text-primary underline underline-offset-4">see all products</Link>.
            </p>
            {undoBar}
          </div>
          {suggestions && (
            <section aria-labelledby="cart-suggest-h" className="space-y-4">
              <h2 id="cart-suggest-h" className="text-[19px] font-semibold">Featured products</h2>
              {suggestions}
            </section>
          )}
        </div>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
          <div>
            <ul className="divide-y divide-border border-y border-border pt-5">
              {items.map((item, index) => (
                <CartLine key={lineIdOf(item)} item={item} index={index} onRemove={remove} />
              ))}
            </ul>
            {undoBar}
          </div>

          <aside aria-labelledby="cart-summary-h" className="grid gap-4 rounded-xl border border-border bg-surface p-6 lg:sticky lg:top-24">
            <h2 id="cart-summary-h" className="text-[19px] font-semibold">Summary</h2>
            <CartTotals size="lg" />
            <Link href="/checkout" onClick={() => posthog.capture('checkout_started', { item_count: itemCount, total_cents: total, from: 'cart' })}>
              <Button size="lg" className="min-h-[52px] w-full">Checkout</Button>
            </Link>
            <Link href="/products" className="text-center text-[14px] text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-text-primary">
              Keep browsing
            </Link>
          </aside>
        </div>
      )}
    </div>
  );
}
