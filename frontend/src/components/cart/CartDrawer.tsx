'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import posthog from 'posthog-js';
import { useCart } from '@/lib/cart';
import { lineIdOf } from '@/lib/cart-lines';
import { Button } from '@/components/ui/Button';
import { CartLine, CartTotals, useRemoveWithUndo } from './cart-shared';

/**
 * The slide-in cart, as on our other stores: opened by Add to Cart (the line
 * just added on top) and by the header's cart icon, over whatever page the
 * customer is on — so they can check the total and either go to checkout or
 * carry on browsing without losing their place. A modal <dialog>: focus stays
 * inside, Escape and the backdrop close it.
 */
export function CartDrawer() {
  const { drawer, closeCart, items, itemCount, total } = useCart();
  const { remove, undoBar } = useRemoveWithUndo();
  const ref = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (drawer.open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-panel]')?.focus();
    } else if (!drawer.open && d.open) {
      d.close();
    }
  }, [drawer.open]);

  // Leaving the page (Back, or a link) takes the cart with it.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (ref.current?.open) closeCart();
  }, [pathname, closeCart]);

  // The line just added first, so it is in view without scrolling.
  const ordered = items.map((item, index) => ({ item, index }));
  if (drawer.added) ordered.sort((a, b) => Number(lineIdOf(b.item) === drawer.added) - Number(lineIdOf(a.item) === drawer.added));
  const justAdded = !!drawer.added && items.some((i) => lineIdOf(i) === drawer.added);

  return (
    <dialog
      ref={ref}
      aria-labelledby="cart-drawer-title"
      className="cart-drawer"
      onClose={closeCart}
      onClick={(e) => { if (e.target === e.currentTarget) closeCart(); }}
    >
      {/* Built only while open: nothing of it on pages that never open it. */}
      {drawer.open && (
      <div data-panel tabIndex={-1} className="flex h-full flex-col outline-none">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="cart-drawer-title" className="text-[17px] font-semibold">
            Your cart{itemCount > 0 && <span className="font-normal text-text-muted"> · {itemCount}</span>}
          </h2>
          <button type="button" onClick={closeCart} aria-label="Close cart" className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-text-primary hover:bg-surface-elevated cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>

        {justAdded && (
          <p className="flex items-center gap-2 bg-surface-elevated px-5 py-2.5 text-[14px] font-medium">
            <Check className="h-4 w-4 text-success" aria-hidden="true" /> Added to your cart
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {items.length > 0 ? (
            <ul className="divide-y divide-border">
              {ordered.map(({ item, index }) => (
                <CartLine key={lineIdOf(item)} item={item} index={index} onRemove={remove} />
              ))}
            </ul>
          ) : (
            <div className="grid justify-items-start gap-4 text-[15px] text-text-secondary">
              <p>Your cart is empty.</p>
              <Button variant="outline" onClick={closeCart}>Keep browsing</Button>
            </div>
          )}
          {undoBar}
        </div>

        {items.length > 0 && (
          <div className="grid gap-3 border-t border-border bg-surface-elevated px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <CartTotals />
            <Link href="/checkout" onClick={() => { posthog.capture('checkout_started', { item_count: itemCount, total_cents: total, from: 'drawer' }); closeCart(); }}>
              <Button size="lg" className="mt-1 min-h-[52px] w-full">Checkout</Button>
            </Link>
            <div className="flex items-center justify-between text-[14px]">
              <button type="button" onClick={closeCart} className="py-1 text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-text-primary cursor-pointer">
                Keep browsing
              </button>
              <Link href="/cart" onClick={closeCart} className="py-1 text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-text-primary">
                View cart
              </Link>
            </div>
          </div>
        )}
      </div>
      )}
    </dialog>
  );
}
