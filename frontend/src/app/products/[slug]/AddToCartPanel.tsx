'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Check, ArrowRight, Clock } from 'lucide-react';
import posthog from 'posthog-js';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';
import { formatPrice, getEffectivePrice, getVariantDisplayName, isSaleActive } from '@/lib/utils';
import type { AddOnVariant, CartInclude, CartItem } from '@/types';
import { STORE_MAX_PER_ITEM, preorderUnits, usePreorder } from '@/lib/preorder';
import { useIsClient } from '@/hooks/useIsClient';

interface Props {
  variantId: string;
  code: string;
  name: string;
  size: string | null;
  price: number;
  imageUrl: string | null;
  stock: number;
  addOns?: AddOnVariant[];
  addOnReminder?: string | null;
  noShipping?: boolean;
  /** The size may be bought beyond its stock (pre-order). */
  preorder?: boolean;
}

export function AddToCartPanel({ variantId, code, name, size, price, imageUrl, stock, addOns, addOnReminder, noShipping, preorder = false }: Props) {
  const { leadTime } = usePreorder();
  // A pre-orderable size is held to the per-item cap, not its stock.
  const maxQty = preorder ? STORE_MAX_PER_ITEM : stock;
  const isPreorderOnly = preorder && stock <= 0;
  const [quantity, setQuantity] = useState(1);
  // Cleared whenever the selection changes: at that point the sticky bar is
  // about a different purchase and must go back to offering Add to Cart.
  const [addedFor, setAddedFor] = useState<string | null>(null);
  const [inlineButtonVisible, setInlineButtonVisible] = useState(true);
  const mounted = useIsClient();
  // Required add-ons start selected and locked — the customer cannot
  // uncheck them (enforced again server-side at order creation).
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>(() =>
    (addOns ?? []).filter((a) => a.addOnRequired).map((a) => a.id)
  );
  const inlineButtonRef = useRef<HTMLDivElement>(null);
  const { addItems, itemCount, items } = useCart();
  const router = useRouter();

  function toggleAddOn(id: string, required: boolean) {
    if (required) return;
    setSelectedAddOnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  useEffect(() => {
    const el = inlineButtonRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInlineButtonVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // "Added" belongs to the exact selection that was added; changing the size,
  // quantity or add-ons makes it a different purchase again.
  const selection = `${variantId}|${quantity}|${selectedAddOnIds.join(',')}`;
  const added = addedFor === selection;

  const buildLines = (): CartItem[] => {
    // INCLUDED add-ons (syringes, swabs, vials) ride inside the product's line,
    // per unit; a sold-out free one is left off (the server ships what is left).
    // SUGGESTED ones (another product) become lines of their own.
    const chosen = (addOns ?? []).filter((a) => selectedAddOnIds.includes(a.id) && a.stock > 0);
    const includes: CartInclude[] = chosen.filter((a) => a.addOnIncluded).map((a) => ({
      variantId: a.id,
      code: a.code,
      name: getVariantDisplayName(a, a),
      perUnit: a.addOnQuantity,
      price: getEffectivePrice(a),
      required: a.addOnRequired,
      stock: a.stock,
    }));
    const lines: CartItem[] = [{
      variantId,
      code,
      name,
      size,
      price,
      quantity,
      stock,
      imageUrl,
      noShipping,
      includes,
      preorder,
    }];
    for (const addOn of chosen) {
      if (addOn.addOnIncluded) continue;
      lines.push({
        variantId: addOn.id,
        code: addOn.code,
        name: getVariantDisplayName(addOn, addOn),
        size: addOn.size,
        price: getEffectivePrice(addOn),
        quantity: addOn.addOnQuantity,
        stock: addOn.stock,
        imageUrl: addOn.imageUrl,
      });
    }
    return lines;
  };

  const trackAdd = (via: 'add_to_cart' | 'buy_now') =>
    posthog.capture('add_to_cart', {
      via,
      variant_id: variantId,
      product_code: code,
      variant_size: size,
      quantity,
      price_cents: price,
      add_on_count: selectedAddOnIds.length,
      preorder_units: preorderUnits(quantity, stock, preorder),
    });

  const handleAddToCart = () => {
    // One call, so the confirmation names the product rather than whichever
    // add-on happened to be added last.
    addItems(buildLines());
    trackAdd('add_to_cart');
    // Deliberately NOT reset on a timer. "Added" used to revert after two
    // seconds and the toast expired half a second later, so a few seconds after
    // tapping there was no trace anything had happened and no way forward — the
    // page looked exactly as it had before. It now stays as the next step until
    // the customer changes what they are buying.
    setAddedFor(selection);
  };

  // Buy now = this selection into the cart, then straight to checkout. It
  // stays in the cart, so backing out of checkout finds it there. Already in
  // the cart (Add to Cart just now, or a Buy now they backed out of)? Then it
  // is not added again: checkout shows it, and Edit cart changes it.
  const handleBuyNow = () => {
    if (!added && !items.some((i) => i.variantId === variantId)) {
      addItems(buildLines(), { quiet: true });
      trackAdd('buy_now');
      setAddedFor(selection);
    }
    router.push('/checkout');
  };
  const canBuy = maxQty > 0 && quantity <= maxQty;

  return (
    <>
      {addOnReminder && (
        <p className="pt-4 text-sm text-text-secondary italic">{addOnReminder}</p>
      )}

      {[
        { title: quantity > 1 ? `Included with your ${quantity} units` : 'Included', list: (addOns ?? []).filter((a) => a.addOnIncluded) },
        { title: 'Add to your order', list: (addOns ?? []).filter((a) => !a.addOnIncluded) },
      ].filter((g) => g.list.length > 0).map((group, gi) => (
        <div key={group.title} className={`${gi === 0 && !addOnReminder ? 'pt-4' : 'pt-3'} space-y-2`}>
          <p className="text-sm font-medium text-text-secondary">{group.title}</p>
          <div className="space-y-1.5">
            {group.list.map((addOn) => {
              const outOfStock = addOn.stock === 0;
              const locked = addOn.addOnRequired;
              // An included add-on comes per unit of the product, so its count
              // follows the quantity picked below.
              const count = addOn.addOnIncluded ? addOn.addOnQuantity * quantity : addOn.addOnQuantity;
              const unitPrice = getEffectivePrice(addOn);
              return (
                <label
                  key={addOn.id}
                  htmlFor={`addon-${addOn.id}`}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-surface ${
                    outOfStock ? 'opacity-50 cursor-not-allowed' : locked ? 'cursor-default' : 'hover:bg-surface-elevated/50 cursor-pointer'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      id={`addon-${addOn.id}`}
                      checked={selectedAddOnIds.includes(addOn.id)}
                      onChange={() => toggleAddOn(addOn.id, locked)}
                      disabled={outOfStock || locked}
                      className="rounded accent-primary"
                    />
                    <span className="font-display font-semibold text-text-primary">{addOn.code}</span> {getVariantDisplayName(addOn, addOn)}
                    {count > 1 && <span className="text-text-muted whitespace-nowrap">× {count}</span>}
                    {locked && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Required</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {outOfStock ? (
                      <span className="text-xs text-text-muted">Out of stock</span>
                    ) : unitPrice === 0 && addOn.addOnIncluded ? (
                      <span className="text-sm font-medium text-success">Free</span>
                    ) : (
                      <>
                        <span className="text-sm font-medium">{formatPrice(addOn.addOnIncluded ? unitPrice * count : unitPrice)}</span>
                        {isSaleActive(addOn) && (
                          <span className="text-xs text-text-muted line-through">{formatPrice(addOn.addOnIncluded ? addOn.price * count : addOn.price)}</span>
                        )}
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <div ref={inlineButtonRef} className="flex items-center gap-4 pt-4">
        <div className="flex items-center border border-border rounded-lg">
          <button
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
            className="px-3 py-2 min-w-11 min-h-11 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer"
            aria-label="Decrease quantity"
          >
            -
          </button>
          <span className="px-4 py-2 font-medium min-w-[3rem] text-center">{quantity}</span>
          <button
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
            disabled={quantity >= maxQty}
            className="px-3 py-2 min-w-11 min-h-11 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
{added ? (
          <Link href="/cart" className="flex-1">
            <Button size="lg" className="w-full whitespace-nowrap">
              <Check className="w-4 h-4" /> View cart ({itemCount}) <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        ) : (
          <Button onClick={handleAddToCart} disabled={!canBuy} size="lg" className="flex-1">
            {isPreorderOnly ? <><Clock className="w-4 h-4" /> Pre-order</> : <><ShoppingCart className="w-4 h-4" /> Add to Cart</>}
          </Button>
        )}
      </div>
      <Button onClick={handleBuyNow} disabled={!canBuy} variant="outline" size="lg" className="mt-3 w-full border-text-primary">
        {isPreorderOnly ? 'Pre-order now' : 'Buy now'}
      </Button>
      <PreorderNote quantity={quantity} stock={stock} preorder={preorder} leadTime={leadTime} />

      {/* Mobile-only sticky CTA — keeps Add to Cart reachable once the inline
          button scrolls out of view, regardless of how tall the page runs.
          Rendered via portal to document.body: this page nests the panel
          inside Animate's transform-styled wrapper, which creates a new
          containing block and would otherwise break `position: fixed`
          (it'd anchor to that ancestor instead of the viewport). */}
      {mounted && !inlineButtonVisible && maxQty > 0 &&
        createPortal(
          <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border p-3 flex items-center gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
            {/* text-lg, not text-base: the button is flex-1 and takes ~72% of
                the bar, so at 16px the price read as a caption next to it
                rather than as the number the customer is deciding on. */}
            <span className="font-display font-bold text-lg shrink-0">{formatPrice(price)}</span>
{added ? (
              <Link href="/cart" className="flex-1">
                <Button size="lg" className="w-full whitespace-nowrap">
                  <Check className="w-4 h-4" /> View cart ({itemCount}) <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            ) : (
              <Button onClick={handleAddToCart} size="lg" className="flex-1 px-3 whitespace-nowrap">
                {isPreorderOnly ? <><Clock className="w-4 h-4" /> Pre-order</> : <><ShoppingCart className="w-4 h-4" /> Add</>}
              </Button>
            )}
            <Button onClick={handleBuyNow} variant="outline" size="lg" className="flex-1 px-3 whitespace-nowrap border-text-primary">
              Buy now
            </Button>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Says plainly what a pre-order means for THIS quantity: all of it ships on
 * the restock, or only the units past what is on the shelf.
 */
function PreorderNote({ quantity, stock, preorder, leadTime }: { quantity: number; stock: number; preorder: boolean; leadTime: string }) {
  const units = preorderUnits(quantity, stock, preorder);
  if (units === 0) return null;
  const inStock = Math.max(stock, 0);
  return (
    <div className="mt-3 flex gap-2.5 rounded-lg border border-border bg-surface-elevated/60 px-3 py-2.5 text-sm">
      <Clock className="w-4 h-4 mt-0.5 shrink-0 text-text-secondary" aria-hidden="true" />
      <p className="text-text-secondary">
        {inStock === 0 ? (
          <><span className="font-semibold text-text-primary">Pre-order.</span> Sold out right now — this ships in {leadTime}, when the restock lands.</>
        ) : (
          <><span className="font-semibold text-text-primary">{inStock} in stock, {units} on pre-order.</span> Your order ships together in {leadTime}, when the restock lands.</>
        )}
      </p>
    </div>
  );
}
