'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, Check } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { Button } from '@/components/ui/Button';
import { formatPrice, getFullProductName } from '@/lib/utils';

interface Props {
  productId: string;
  code: string;
  name: string;
  size: string | null;
  price: number;
  imageUrl: string | null;
  stock: number;
}

export function AddToCartPanel({ productId, code, name, size, price, imageUrl, stock }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [inlineButtonVisible, setInlineButtonVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  const inlineButtonRef = useRef<HTMLDivElement>(null);
  const { addItem } = useCart();

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
      productId,
      code,
      name: getFullProductName({ name, size }),
      size,
      price,
      quantity,
      imageUrl,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <>
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
            onClick={() => setQuantity(quantity + 1)}
            className="px-3 py-2 min-w-11 min-h-11 flex items-center justify-center text-text-secondary hover:text-text-primary cursor-pointer"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
        <Button onClick={handleAddToCart} disabled={stock === 0} size="lg" className="flex-1">
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
