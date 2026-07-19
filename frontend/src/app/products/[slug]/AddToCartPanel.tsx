'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, Check } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';
import { formatPrice, getEffectivePrice, getVariantDisplayName, isSaleActive } from '@/lib/utils';
import type { AddOnVariant } from '@/types';

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
}

export function AddToCartPanel({ variantId, code, name, size, price, imageUrl, stock, addOns, addOnReminder }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [inlineButtonVisible, setInlineButtonVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  // Required add-ons start selected and locked — the customer cannot
  // uncheck them (enforced again server-side at order creation).
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>(() =>
    (addOns ?? []).filter((a) => a.addOnRequired).map((a) => a.id)
  );
  const inlineButtonRef = useRef<HTMLDivElement>(null);
  const { addItem } = useCart();

  function toggleAddOn(id: string, required: boolean) {
    if (required) return;
    setSelectedAddOnIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  useEffect(() => {
    setMounted(true);
    const el = inlineButtonRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInlineButtonVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleAddToCart = () => {
    addItem({
      variantId,
      code,
      name,
      size,
      price,
      quantity,
      imageUrl,
    });
    for (const addOn of addOns ?? []) {
      if (!selectedAddOnIds.includes(addOn.id) || addOn.stock === 0) continue;
      addItem({
        variantId: addOn.id,
        code: addOn.code,
        name: getVariantDisplayName(addOn, addOn),
        size: addOn.size,
        price: getEffectivePrice(addOn),
        quantity: addOn.addOnQuantity,
        imageUrl: addOn.imageUrl,
      });
    }
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <>
      {addOns && addOns.length > 0 && (
        <div className="pt-4 space-y-2">
          <p className="text-sm font-medium text-text-secondary">Add-ons</p>
          <div className="space-y-1.5">
            {addOns.map((addOn) => {
              const outOfStock = addOn.stock === 0;
              const locked = addOn.addOnRequired;
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
                    {getVariantDisplayName(addOn, addOn)}
                    {addOn.addOnQuantity > 1 && <span className="text-text-muted">× {addOn.addOnQuantity}</span>}
                    {locked && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Required</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {outOfStock ? (
                      <span className="text-xs text-text-muted">Out of stock</span>
                    ) : (
                      <>
                        <span className="text-sm font-medium">{formatPrice(getEffectivePrice(addOn))}</span>
                        {isSaleActive(addOn) && (
                          <span className="text-xs text-text-muted line-through">{formatPrice(addOn.price)}</span>
                        )}
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {addOnReminder && (
        <p className="pt-3 text-sm text-text-secondary italic">{addOnReminder}</p>
      )}

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
            onClick={() => setQuantity((q) => Math.min(stock, q + 1))}
            disabled={quantity >= stock}
            className="px-3 py-2 min-w-11 min-h-11 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        <Button onClick={handleAddToCart} disabled={stock === 0 || quantity > stock} size="lg" className="flex-1">
          {added ? (
            <><Check className="w-4 h-4" /> Added</>
          ) : (
            <><ShoppingCart className="w-4 h-4" /> Add to Cart</>
          )}
        </Button>
      </div>

      {/* Mobile-only sticky CTA — keeps Add to Cart reachable once the inline
          button scrolls out of view, regardless of how tall the page runs.
          Rendered via portal to document.body: this page nests the panel
          inside Animate's transform-styled wrapper, which creates a new
          containing block and would otherwise break `position: fixed`
          (it'd anchor to that ancestor instead of the viewport). */}
      {mounted && !inlineButtonVisible && stock > 0 &&
        createPortal(
          <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface border-t border-border p-3 flex items-center gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
            <span className="font-display font-bold text-base shrink-0">{formatPrice(price)}</span>
            <Button onClick={handleAddToCart} size="lg" className="flex-1">
              {added ? (
                <><Check className="w-4 h-4" /> Added</>
              ) : (
                <><ShoppingCart className="w-4 h-4" /> Add to Cart</>
              )}
            </Button>
          </div>,
          document.body
        )}
    </>
  );
}
