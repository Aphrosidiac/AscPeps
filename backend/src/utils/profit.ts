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
  /**
   * The processor's cut, already withheld from `total`. Optional only so older
   * call sites and tests can omit it; absent is treated as zero, which is the
   * truth for manual transfers and BTCPay.
   */
  gatewayFee?: number;
  /** Cents handed back to the customer. Reverses revenue by exactly this much. */
  refundedAmount?: number;
  /**
   * Whether the order's stock went back into inventory. Only consulted on a
   * refunded order — see the item-cost reversal below.
   */
  stockRestored?: boolean;
}

export interface OrderCosting {
  /** What we actually kept from the customer: total less anything refunded. */
  revenue: number;
  refunded: number;
  itemCost: number;
  extraCost: number;
  gatewayFee: number;
  /** itemCost + extraCost + gatewayFee. */
  cost: number;
  /** null when any line is still unpriced — never a partial figure. */
  profit: number | null;
  costed: boolean;
}

export function costOrder(order: CostableOrder): OrderCosting {
  const costed = order.items.length > 0 && order.items.every((i) => i.unitCost !== null);

  const refunded = order.refundedAmount ?? 0;
  const revenue = order.total - refunded;
  const gatewayFee = order.gatewayFee ?? 0;

  // Goods that came back are not a cost. The reversal is gated on there having
  // been a refund, not on `stockRestored` alone: that flag is also set when a
  // still-paid order is cancelled, and zeroing the goods cost while keeping the
  // full revenue would invent profit out of nothing.
  //
  // All-or-nothing rather than pro-rata because restoreOrderInventory is
  // all-or-nothing: it puts back every line or none of them.
  const goodsReturned = refunded > 0 && order.stockRestored === true;
  const itemCost = goodsReturned
    ? 0
    : order.items.reduce((sum, i) => sum + (i.unitCost ?? 0) * i.quantity, 0);

  // Courier, packaging and the processor's cut are never recovered by a refund.
  // A fully refunded order is therefore a real loss of exactly those, which is
  // the truth and used to be reported as nothing at all.
  const extraCost = order.extraCosts.reduce((sum, c) => sum + c.amount, 0);
  const cost = itemCost + extraCost + gatewayFee;

  return {
    revenue,
    refunded,
    itemCost,
    extraCost,
    gatewayFee,
    cost,
    profit: costed ? revenue - cost : null,
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
