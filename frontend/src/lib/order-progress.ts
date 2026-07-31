/**
 * What still has to happen before an order is finished with.
 *
 * One definition, used by both the orders list badge and the Order Complete
 * tab's checklist. They answer the same question and would quietly disagree if
 * each computed it — the list would call something done that the detail page
 * still had a red cross against.
 *
 * "Finished" deliberately is not `status === DELIVERED`. An order that arrived
 * but was never costed has no profit attached to it, so it is invisible in
 * everyone's balance — which is exactly the state that needs chasing and
 * exactly the state the badge exists to surface.
 */
import type { Order } from '@/types';

/**
 * The minimum an order has to carry to be judged. Structural rather than the
 * full `Order` because list rows deliberately fetch only `shareBps` from the
 * split — mirrors `CostableOrder` on the backend.
 */
export interface ProgressableOrder {
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  deletedAt: string | null;
  items: { unitCost?: number | null }[];
  profitShares?: { shareBps: number }[];
}

export type OrderProgressState =
  /** Paid, delivered, costed, split recorded. Nothing left to do. */
  | 'COMPLETE'
  /** Costed and split, but still waiting on payment or delivery. */
  | 'COSTED'
  /** Has line items with no unit cost — profit is unknown. */
  | 'NEEDS_COSTING'
  /** Costed, but nobody has said how the profit divides. */
  | 'NEEDS_SPLIT'
  /** Cancelled or deleted — there is nothing to cost or divide. */
  | 'NONE';

export type OrderCheckKey = 'paid' | 'delivered' | 'costed' | 'split';

export interface OrderCheck {
  key: OrderCheckKey;
  label: string;
  done: boolean;
  /** Shown when it isn't done — says what is actually missing. */
  todo: string;
}

export interface OrderProgress {
  state: OrderProgressState;
  /** Badge text. Empty for NONE, which renders no badge. */
  label: string;
  /** Tailwind classes for the badge, matching the admin's other status pills. */
  className: string;
  /** Longer explanation, used as the badge's tooltip. */
  hint: string;
  checks: OrderCheck[];
  outstanding: OrderCheck[];
  unpricedCount: number;
}

const STYLES: Record<OrderProgressState, { label: string; className: string; hint: string }> = {
  COMPLETE: {
    label: 'Complete',
    className: 'bg-green-100 text-green-800',
    hint: 'Paid, delivered, costed, and the split is recorded.',
  },
  COSTED: {
    label: 'Costed',
    className: 'bg-blue-100 text-blue-800',
    hint: 'Costed and split — waiting on payment or delivery.',
  },
  NEEDS_COSTING: {
    label: 'Needs costing',
    className: 'bg-amber-100 text-amber-800',
    hint: 'Some lines have no unit cost, so this order’s profit is in nobody’s balance.',
  },
  NEEDS_SPLIT: {
    label: 'Needs split',
    className: 'bg-amber-100 text-amber-800',
    hint: 'Costed, but no profit split is recorded — nobody is credited for it.',
  },
  NONE: { label: '', className: '', hint: '' },
};

/**
 * `profitShares` is only on the single-order response and on list rows since
 * the badge was added; an older cached payload without it must not be read as
 * "no split recorded", so undefined is treated as unknown and leaves the split
 * check passing rather than inventing work.
 */
export function orderProgress(order: ProgressableOrder): OrderProgress {
  const items = order.items ?? [];
  const unpricedCount = items.filter((i) => i.unitCost === null || i.unitCost === undefined).length;
  const costed = items.length > 0 && unpricedCount === 0;

  const shares = order.profitShares;
  const splitRecorded =
    shares === undefined
      ? true
      : shares.length > 0 && shares.reduce((sum, s) => sum + s.shareBps, 0) === 10_000;

  const paid = order.paymentStatus === 'PAID';
  const delivered = order.status === 'DELIVERED';

  const checks: OrderCheck[] = [
    { key: 'paid', label: 'Payment received', done: paid, todo: `Payment is ${order.paymentStatus.toLowerCase()}` },
    { key: 'delivered', label: 'Delivered to customer', done: delivered, todo: `Order is ${order.status.toLowerCase()}` },
    {
      key: 'costed',
      label: 'All items costed',
      done: costed,
      todo: items.length === 0 ? 'No items on this order' : `${unpricedCount} item${unpricedCount === 1 ? '' : 's'} still unpriced`,
    },
    {
      key: 'split',
      label: 'Profit split recorded',
      done: splitRecorded,
      todo: !shares?.length ? 'No split saved' : 'Split does not total 100%',
    },
  ];

  // A cancelled or deleted order is not work in progress — badging it "needs
  // costing" would put permanent chores in the list that nobody should do.
  const inactive = order.status === 'CANCELLED' || order.deletedAt !== null;

  const state: OrderProgressState = inactive
    ? 'NONE'
    : !costed
      ? 'NEEDS_COSTING'
      : !splitRecorded
        ? 'NEEDS_SPLIT'
        : paid && delivered
          ? 'COMPLETE'
          : 'COSTED';

  return {
    state,
    ...STYLES[state],
    checks,
    outstanding: checks.filter((c) => !c.done),
    unpricedCount,
  };
}
