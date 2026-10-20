import type { CartInclude, CartItem } from '@/types';

/** A line's identity: the product size plus what it includes. */
export function lineKey(variantId: string, includes: CartInclude[] = []): string {
  return `${variantId}|${includes.map((i) => i.variantId).sort().join(',')}`;
}

export function lineIdOf(item: CartItem): string {
  return item.lineId ?? item.variantId;
}

/** One unit of the line: the product plus any priced includes that come with it. */
export function lineUnitPrice(item: CartItem): number {
  return item.price + (item.includes ?? []).reduce((s, i) => s + i.price * i.perUnit, 0);
}

/**
 * The most of this line the cart allows: the product's own stock, and for a
 * PRICED include, how many units its stock covers. A free include that runs
 * short never limits the line — the server ships what is left of it.
 */
export function lineMaxQuantity(item: CartItem): number | undefined {
  const limits: number[] = [];
  if (item.stock != null) limits.push(item.stock);
  for (const inc of item.includes ?? []) {
    if (inc.price > 0 && inc.stock != null && inc.perUnit > 0) limits.push(Math.floor(inc.stock / inc.perUnit));
  }
  return limits.length ? Math.min(...limits) : undefined;
}

/** "1× Bac Water 3mL · 6× Alcohol Swab" for a line of `quantity`. */
export function includesSummary(item: CartItem, quantity = item.quantity): string {
  return (item.includes ?? []).map((i) => `${i.perUnit * quantity}× ${i.name}`).join(' · ');
}
