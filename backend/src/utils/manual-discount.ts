import { z } from 'zod';

/**
 * A discount keyed by a person rather than redeemed by a code: "RM10 off",
 * "15% for the bulk order". One rule for everywhere it can be entered — the
 * admin order page, the assistant's create_order and set_order_discount — so
 * the same words always produce the same cents.
 *
 * A percentage is measured against the goods subtotal, before shipping and
 * before any other discount, exactly as a percentage discount CODE is
 * (admin-discounts.controller.ts). Measuring against the total would make
 * "10% off" depend on the shipping fee, which is not what anyone means by it.
 *
 * The amount is capped at what the order can absorb (goods + shipping), so a
 * mistyped figure can never drive the total negative.
 */
export const manualDiscountSchema = z
  .object({
    // Cents.
    amount: z.number().int().min(0).max(100_000_000).optional(),
    // Whole-order percentage, two decimals at most: 10, 12.5, 33.33.
    percent: z.number().min(0).max(100).multipleOf(0.01).optional(),
    note: z.string().trim().max(120).optional(),
  })
  .refine((d) => d.amount === undefined || d.percent === undefined, {
    message: 'Give the discount as an amount or a percentage, not both.',
  });

export type ManualDiscountInput = z.infer<typeof manualDiscountSchema>;

export function resolveManualDiscount(
  input: ManualDiscountInput,
  order: { subtotal: number; shippingFee: number }
): { amount: number; note: string | null } {
  let amount = input.amount ?? 0;
  if (input.percent !== undefined) {
    amount = Math.round((order.subtotal * input.percent) / 100);
  }
  amount = Math.min(amount, order.subtotal + order.shippingFee);

  // A percentage with no reason typed still records HOW it was worked out —
  // "15%" on its own is a more useful note than nothing, and the number is
  // otherwise lost the moment it becomes cents.
  const typed = input.note?.trim() || '';
  const note =
    typed ||
    (input.percent !== undefined && amount > 0 ? `${trimPercent(input.percent)}% off` : '');
  return { amount, note: amount > 0 && note ? note : null };
}

/**
 * The goods figure a discount is measured against. `subtotal` on the very
 * first orders was never stored (it is 0 while `total` is not), so it is
 * rebuilt from what was: the total plus whatever was already taken off, less
 * shipping. Every order since checkout started storing it returns it as is.
 */
export function goodsSubtotal(order: {
  subtotal: number; shippingFee: number; discountAmount: number; total: number;
}): number {
  if (order.subtotal > 0 || order.total === 0) return order.subtotal;
  return Math.max(order.total + order.discountAmount - order.shippingFee, 0);
}

function trimPercent(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * What an order's discount becomes when its GOODS change after the fact (a
 * line added, removed or requantified). The stored figure is cents, so the
 * rule that produced it has to be read back off the order:
 *
 * - a hand discount noted as "15% off" (the note resolveManualDiscount writes
 *   for a bare percentage) is a percentage, and follows the new goods total;
 * - a code discount with no hand note is the code's rule — percentage codes
 *   follow, fixed codes stay;
 * - anything else is a fixed sum somebody agreed to, and stays.
 *
 * Whatever comes out is capped at what the order can absorb, as always.
 */
export function carryDiscount(
  order: {
    discountAmount: number;
    discountNote: string | null;
    discountCode: { discountType: string; discountValue: number } | null;
  },
  next: { subtotal: number; shippingFee: number }
): number {
  let amount = order.discountAmount;
  const pct = order.discountNote?.match(/^(\d+(?:\.\d+)?)% off$/);
  if (pct) {
    amount = Math.round((next.subtotal * Number(pct[1])) / 100);
  } else if (order.discountCode && !order.discountNote) {
    amount =
      order.discountCode.discountType === 'PERCENTAGE'
        ? Math.round((next.subtotal * order.discountCode.discountValue) / 100)
        : Math.min(order.discountCode.discountValue, next.subtotal);
  }
  return Math.min(amount, next.subtotal + next.shippingFee);
}
