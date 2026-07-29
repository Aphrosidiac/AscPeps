/**
 * Order profitability. Kept in one place because both the analytics endpoint
 * and (eventually) any reporting/export path have to agree on what "profit"
 * means for an order — two callers disagreeing about the bottom line is the
 * kind of bug nobody notices until someone is paid the wrong amount.
 *
 * Deliberately mirrors `profitSummary`/`allocate` in
 * frontend/src/app/admin/orders/[id]/OrderDetail.tsx. There is no shared
 * package between the two apps (see the same note on product-pricing.ts), so
 * these must be changed together.
 */

export interface CostableOrder {
  total: number;
  items: { quantity: number; unitCost: number | null }[];
  extraCosts: { amount: number }[];
}

export interface OrderCosting {
  itemCost: number;
  extraCost: number;
  /** null when any line is still unpriced — never a partial figure. */
  profit: number | null;
  costed: boolean;
}

export function costOrder(order: CostableOrder): OrderCosting {
  const costed = order.items.length > 0 && order.items.every((i) => i.unitCost !== null);
  const itemCost = order.items.reduce((sum, i) => sum + (i.unitCost ?? 0) * i.quantity, 0);
  const extraCost = order.extraCosts.reduce((sum, c) => sum + c.amount, 0);

  return {
    itemCost,
    extraCost,
    profit: costed ? order.total - itemCost - extraCost : null,
    costed,
  };
}

/**
 * Splits `profit` (integer cents, may be negative) across `bps` using the
 * largest-remainder method, so the parts always sum back to exactly `profit`.
 */
export function allocate(profit: number, bps: number[]): number[] {
  if (bps.length === 0) return [];
  const exact = bps.map((b) => (profit * b) / 10_000);
  const base = exact.map((v) => Math.trunc(v));
  let leftover = profit - base.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: Math.abs(v - base[i]) }))
    .sort((a, b) => b.frac - a.frac);

  const step = leftover >= 0 ? 1 : -1;
  for (let k = 0; leftover !== 0 && k < order.length * 2; k++) {
    base[order[k % order.length].i] += step;
    leftover -= step;
  }
  return base;
}
