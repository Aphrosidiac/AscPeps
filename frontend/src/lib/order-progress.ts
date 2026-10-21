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
  items: { unitCost?: number | null; unitPrice?: number }[];
  profitShares?: { shareBps: number; partnerId?: string | null }[];
  /** In a share-out — the profit has actually gone to its people. */
  profitShared?: boolean;
}

export type OrderProgressState =
  /** Paid, delivered, costed and shared out. Nothing left to do. */
  | 'COMPLETE'
  /** Paid, delivered and costed — its profit is waiting to be shared out. */
  | 'TO_SHARE'
  /** Costed and split, but still waiting on payment or delivery. */
  | 'COSTED'
  /** Has line items with no unit cost — profit is unknown. */
  | 'NEEDS_COSTING'
  /** Costed, but nobody has said how the profit divides. */
  | 'NEEDS_SPLIT'
  /** Cancelled or deleted — there is nothing to cost or divide. */
  | 'NONE';

export type OrderCheckKey = 'paid' | 'delivered' | 'costed' | 'split' | 'shared';

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
    hint: 'Paid, delivered, costed, and its profit has been shared out.',
  },
  TO_SHARE: {
    label: 'To share',
    className: 'bg-purple-100 text-purple-800',
    hint: 'Finished — its profit is waiting on Ascend Money → Profit sharing.',
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
  // A free line (an included syringe or swab) does not need a cost — same rule as
  // the backend's costOrder.
  const unpricedCount = items.filter((i) => (i.unitCost === null || i.unitCost === undefined) && i.unitPrice !== 0).length;
  const costed = items.length > 0 && unpricedCount === 0;

  const paid = order.paymentStatus === 'PAID';
  const shares = order.profitShares;
  // The default split is put on an order when it is paid, so an unpaid order
  // with none is not missing anything yet.
  const splitRecorded =
    shares === undefined || (!paid && shares.length === 0)
      ? true
      : shares.length > 0 &&
        shares.reduce((sum, s) => sum + s.shareBps, 0) === 10_000 &&
        // A row typed before partners existed carries only a name — the
        // share-out cannot pay it, so the split is not really recorded.
        shares.every((s) => s.partnerId !== null);
  const shared = order.profitShared === true;
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
    {
      key: 'shared',
      label: 'Profit shared out',
      done: shared,
      todo: 'Not shared out yet',
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
          ? shared ? 'COMPLETE' : 'TO_SHARE'
          : 'COSTED';

  return {
    state,
    ...STYLES[state],
    checks,
    outstanding: checks.filter((c) => !c.done),
    unpricedCount,
  };
}
