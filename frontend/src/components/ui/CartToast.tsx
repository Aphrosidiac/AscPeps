'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import type { ToastItem } from '@/lib/cart';

interface CartToastProps {
  item: ToastItem | null;
  onDone: () => void;
}

/**
 * Confirmation that something reached the cart.
 *
 * Two things here are deliberate and were previously the other way round.
 *
 * It sits at the BOTTOM on mobile, above the product page's sticky bar. It used
 * to be pinned top-right, which on a 390px screen put it on top of the site's
 * own logo and roughly 700px from the thumb that had just tapped Add to cart —
 * confirmation nowhere near the action it was confirming.
 *
 * And it leads with the product NAME. It used to lead with the SKU code in
 * bold with the name muted underneath, so the reassurance a customer got for
 * their RM135 vial was the word "ALS".
 */
export function CartToast({ item, onDone }: CartToastProps) {
  const [visible, setVisible] = useState(false);
  const [display, setDisplay] = useState<ToastItem | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!item) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (fadeRef.current) clearTimeout(fadeRef.current);

    setDisplay(item);
    setVisible(true);

    timerRef.current = setTimeout(() => {
      setVisible(false);
      fadeRef.current = setTimeout(onDone, 300);
    }, 3000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, [item, onDone]);

  if (!display) return null;

  return (
    <div
      className={`fixed z-50 transition-all duration-300 bottom-24 left-4 right-4 sm:bottom-6 sm:left-auto sm:right-6 sm:w-80 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'
      }`}
    >
      <div className="bg-surface border border-border rounded-xl shadow-lg p-3 flex items-center gap-3">
        <div className="w-9 h-9 bg-success/10 rounded-full flex items-center justify-center shrink-0">
          <Check className="w-4.5 h-4.5 text-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{display.name}</p>
          <p className="text-xs text-text-muted truncate">
            {display.code}
            {display.extras > 0 && ` · +${display.extras} item${display.extras === 1 ? '' : 's'}`}
          </p>
        </div>
        {/* A labelled link, not a bare icon. This is the only forward path the
            toast offers and it disappears in three seconds — it should not also
            need decoding. */}
        <Link
          href="/cart"
          className="shrink-0 px-3 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-light transition-colors whitespace-nowrap"
        >
          View cart
        </Link>
      </div>
    </div>
  );
}
