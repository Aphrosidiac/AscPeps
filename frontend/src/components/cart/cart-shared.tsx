'use client';

/*
 * The cart's parts, shared by the slide-in cart (CartDrawer) and /cart, laid
 * out like our other stores' (Teliti, BuatBenda): one row per line with a
 * stepper and Remove (with Undo), what the line includes, then the subtotal
 * and the shipping it will cost before the customer reaches checkout.
 */
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import posthog from 'posthog-js';
import { getSettings } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { lineIdOf, lineMaxQuantity, lineUnitPrice } from '@/lib/cart-lines';
import { preorderLabel, preorderUnits, usePreorder } from '@/lib/preorder';
import { useRefCode } from '@/lib/ref-code';
import { parseEastMalaysiaMinOrder, resolveShippingFeeSen } from '@/lib/shipping-region';
import { cn, formatPrice } from '@/lib/utils';
import type { CartItem } from '@/types';

// ── Store settings (shipping fees), fetched once per visit ────────────────

let settingsOnce: Promise<Record<string, string>> | null = null;

function useStoreSettings(): Record<string, string> | null {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    settingsOnce ??= getSettings().catch(() => ({}));
    settingsOnce.then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

// ── One line ──────────────────────────────────────────────────────────────

export function CartLine({ item, index, onRemove }: {
  item: CartItem;
  /** Where it sits in the cart, so Undo puts it back there. */
  index: number;
  onRemove: (item: CartItem, index: number) => void;
}) {
  const { updateQuantity } = useCart();
  const { leadTime } = usePreorder();
  const max = lineMaxQuantity(item);
  const id = lineIdOf(item);
  const label = `${item.code} ${item.name}`;
  const free = (item.includes ?? []).filter((i) => i.price === 0);
  const paid = (item.includes ?? []).filter((i) => i.price > 0);
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-start gap-4 py-5 first:pt-0">
      <div className="relative flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
        {item.imageUrl ? (
          <Image src={item.imageUrl} alt={item.name} fill sizes="72px" className="object-cover" />
        ) : (
          <span className="w-full px-1 text-center text-[11px] font-bold leading-tight text-text-muted line-clamp-2 break-words">{item.code}</span>
        )}
      </div>

      <div className="min-w-0">
        <p className="text-[15px] font-semibold leading-snug">{item.code}</p>
        <p className="text-[13px] leading-snug text-text-secondary">{item.name}</p>
        {item.quantity > 1 && <p className="text-[13px] leading-snug text-text-muted">{formatPrice(lineUnitPrice(item))} each</p>}
        {/* What comes with it — part of this line, scaling with its quantity.
            One quiet sentence, not a box: the "free" is the value cue, the
            list is detail. A priced extra gets its own line with its price. */}
        {free.length > 0 && (
          <p className="mt-1 text-[13px] leading-snug text-text-secondary">
            <span className="font-medium text-success">Included free:</span>{' '}
            {free.map((inc) => `${inc.perUnit * item.quantity}× ${inc.name}`).join(', ')}
          </p>
        )}
        {paid.map((inc) => (
          <p key={inc.variantId} className="mt-0.5 text-[13px] leading-snug text-text-secondary">
            + {inc.perUnit * item.quantity}× {inc.name} · {formatPrice(inc.price * inc.perUnit * item.quantity)}
          </p>
        ))}
        {preorderUnits(item.quantity, item.stock, item.preorder) > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium text-text-primary">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {preorderLabel(item.quantity, item.stock)} · ships in {leadTime}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-4">
          <div role="group" aria-label={`Quantity of ${label}`} className="flex items-center rounded-lg border border-border-hover">
            <button
              type="button"
              onClick={() => updateQuantity(id, Math.max(1, item.quantity - 1))}
              disabled={item.quantity <= 1}
              aria-label={`One fewer ${label}`}
              className="flex h-9 w-9 items-center justify-center text-[17px] text-text-secondary hover:text-text-primary disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
            >
              −
            </button>
            <output aria-live="polite" className="min-w-8 text-center text-[14px] font-medium tabular-nums">{item.quantity}</output>
            <button
              type="button"
              onClick={() => updateQuantity(id, item.quantity + 1)}
              disabled={max != null && item.quantity >= max}
              aria-label={`One more ${label}`}
              className="flex h-9 w-9 items-center justify-center text-[17px] text-text-secondary hover:text-text-primary disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={() => onRemove(item, index)}
            className="py-2 text-[13px] text-text-secondary underline underline-offset-4 decoration-border-hover hover:text-text-primary hover:decoration-text-primary cursor-pointer"
          >
            Remove
          </button>
        </div>

      </div>

      <p className="text-[15px] font-semibold tabular-nums whitespace-nowrap">{formatPrice(lineUnitPrice(item) * item.quantity)}</p>
    </li>
  );
}

// ── Remove, with Undo ─────────────────────────────────────────────────────

/** Remove a line and offer "Removed X. Undo" for a few seconds. */
export function useRemoveWithUndo() {
  const { removeItem, restoreItem } = useCart();
  const [undo, setUndo] = useState<{ name: string; restore: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const remove = useCallback((item: CartItem, index: number) => {
    removeItem(lineIdOf(item));
    posthog.capture('remove_from_cart', { variant_id: item.variantId, product_code: item.code, quantity: item.quantity });
    setUndo({ name: item.code, restore: () => restoreItem(item, index) });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setUndo(null), 8000);
  }, [removeItem, restoreItem]);

  const bar = undo ? (
    <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-surface-elevated px-3 py-2.5 text-[14px] text-text-secondary">
      Removed {undo.name}.
      <button
        type="button"
        onClick={() => { undo.restore(); setUndo(null); clearTimeout(timer.current); }}
        className="font-semibold text-text-primary underline underline-offset-4 cursor-pointer"
      >
        Undo
      </button>
    </p>
  ) : null;

  return { remove, undoBar: bar };
}

// ── Totals ────────────────────────────────────────────────────────────────

/**
 * Subtotal and what shipping will cost, before the state is known: one fee,
 * or Peninsular and East Malaysia side by side when they differ. The total
 * only when there is one fee to add; checkout shows the rest once a state is
 * chosen. Same rules as checkout (lib/shipping-region.ts).
 */
export function CartTotals({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { items, total } = useCart();
  const { leadTime } = usePreorder();
  const settings = useStoreSettings();
  const refCode = useRefCode();

  const noShipping = items.length > 0 && items.every((i) => i.noShipping);
  const pen = settings ? (noShipping ? 0 : resolveShippingFeeSen(settings.shipping_fee, settings.east_malaysia_shipping_fee, false)) : null;
  const east = settings ? (noShipping ? 0 : resolveShippingFeeSen(settings.shipping_fee, settings.east_malaysia_shipping_fee, true)) : null;
  const eastMin = settings ? parseEastMalaysiaMinOrder(settings.east_malaysia_min_order) : 0;
  const fee = (sen: number) => (sen === 0 ? <span className="font-medium text-success">Free</span> : formatPrice(sen));
  const anyPreorder = items.some((i) => preorderUnits(i.quantity, i.stock, i.preorder) > 0);

  return (
    <div className="space-y-3">
      <dl className="space-y-1.5 tabular-nums">
        <div className={cn('flex justify-between gap-4 font-semibold', size === 'lg' ? 'text-[18px]' : 'text-[16px]')}>
          <dt>Subtotal</dt>
          <dd>{formatPrice(total)}</dd>
        </div>
        {pen === null || east === null ? (
          <div className="flex justify-between gap-4 text-[14px] text-text-secondary">
            <dt>Shipping</dt>
            <dd>…</dd>
          </div>
        ) : pen === east ? (
          <div className="flex justify-between gap-4 text-[14px] text-text-secondary">
            <dt>Shipping</dt>
            <dd>{fee(pen)}</dd>
          </div>
        ) : (
          <>
            <div className="flex justify-between gap-4 text-[14px] text-text-secondary">
              <dt>Shipping, Peninsular</dt>
              <dd>{fee(pen)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-[14px] text-text-secondary">
              <dt>Sabah, Sarawak, Labuan</dt>
              <dd>{fee(east)}</dd>
            </div>
          </>
        )}
        {pen !== null && pen === east && (
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2.5">
            <dt className="text-[15px] font-semibold">Total</dt>
            <dd className="flex items-baseline gap-1.5">
              <span className="text-[12px] text-text-muted">MYR</span>
              <span className={cn('font-display font-bold', size === 'lg' ? 'text-[24px]' : 'text-[20px]')}>{formatPrice(total + pen)}</span>
            </dd>
          </div>
        )}
      </dl>

      {eastMin > 0 && total < eastMin && (
        <p className="text-[13px] leading-relaxed text-text-muted">Sabah, Sarawak and Labuan need a minimum order of {formatPrice(eastMin)}.</p>
      )}
      {anyPreorder && (
        <p className="text-[13px] leading-relaxed text-text-secondary">Includes a pre-order, so your order ships together in {leadTime}, when the restock lands.</p>
      )}
      {/* The code from an affiliate's share link (lib/ref-code.ts): checkout offers it. */}
      {refCode && (
        <p className="text-[13px] leading-relaxed text-text-secondary">
          Code <span className="font-semibold text-text-primary">{refCode}</span> from your link is ready to apply at checkout.
        </p>
      )}
    </div>
  );
}
