import type { Order } from '@/types';

// What /track gets back from GET /orders/lookup: the order without the
// customer's details, plus what the pipeline needs to place it.
export interface TrackedOrder
  extends Pick<
    Order,
    | 'id'
    | 'orderNumber'
    | 'status'
    | 'paymentStatus'
    | 'paymentMethod'
    | 'subtotal'
    | 'shippingFee'
    | 'discountAmount'
    | 'refundedAmount'
    | 'total'
    | 'createdAt'
    | 'items'
  > {
  // When each step was reached. Null when not reached, or reached before the
  // stamps existed (Oct 2026) — the step then shows without a time.
  paidAt: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  region: 'klang-valley' | 'peninsular' | 'east';
  tracking: { number: string; courier: string | null; url: string | null } | null;
  delivery: {
    scheduledFor: string;
    durationMinutes: number;
    status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
    completedAt: string | null;
  } | null;
  // Hosted bank transfer only: the screenshot is in and a person is checking it.
  proofSubmitted: boolean;
  // Hosted bank transfer only, while unpaid: the way back to the payment page.
  paymentUrl?: string;
}

export type StepKey = 'placed' | 'paid' | 'packing' | 'shipped' | 'delivered';
export type StepState = 'done' | 'current' | 'upcoming' | 'stopped';

export interface Step {
  key: StepKey | 'cancelled';
  label: string;
  state: StepState;
  at: string | null;
}

// Each step has two names: what it is while it is happening, and what it is
// once it has happened. "Payment" waiting, "Paid" done.
const STEPS: { key: StepKey; active: string; done: string }[] = [
  { key: 'placed', active: 'Ordered', done: 'Ordered' },
  { key: 'paid', active: 'Payment', done: 'Paid' },
  { key: 'packing', active: 'Packing', done: 'Packed' },
  { key: 'shipped', active: 'On the way', done: 'Shipped' },
  { key: 'delivered', active: 'Delivered', done: 'Delivered' },
];

const isPaid = (o: TrackedOrder) => o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUNDED';
const handDelivered = (o: TrackedOrder) => o.delivery?.status === 'COMPLETED';

/**
 * How far the order has got: the index of the step in progress, or
 * STEPS.length once it has been delivered and nothing is left.
 *
 * Derived from status AND payment rather than read from status alone, because
 * the two move separately: a WhatsApp order can be CONFIRMED by the team while
 * the transfer is still outstanding, and that customer's next step is paying,
 * not waiting for a parcel. Exactly one step is ever "current".
 */
function reached(o: TrackedOrder): number {
  if (o.status === 'DELIVERED' || handDelivered(o)) return STEPS.length;
  if (o.status === 'SHIPPED') return 3;
  if (isPaid(o)) return 2;
  return 1;
}

function stampFor(o: TrackedOrder, key: StepKey): string | null {
  switch (key) {
    case 'placed':
      return o.createdAt;
    case 'paid':
      return o.paidAt;
    case 'packing':
      // Online payments confirm in the same moment they are paid.
      return o.confirmedAt ?? o.paidAt;
    case 'shipped':
      return o.shippedAt;
    case 'delivered':
      return o.deliveredAt ?? o.delivery?.completedAt ?? null;
  }
}

export function orderSteps(o: TrackedOrder): Step[] {
  if (o.status === 'CANCELLED') {
    // Show what did happen, then where it stopped. The steps it never reached
    // are left off: a greyed "Delivered" on a cancelled order reads as a promise.
    const upTo = isPaid(o) ? 2 : 1;
    return [
      ...STEPS.slice(0, upTo).map((s) => ({ key: s.key, label: s.done, state: 'done' as const, at: stampFor(o, s.key) })),
      { key: 'cancelled', label: 'Cancelled', state: 'stopped', at: o.cancelledAt },
    ];
  }
  const now = reached(o);
  return STEPS.map((s, i) => ({
    key: s.key,
    label: i < now ? s.done : s.active,
    state: i < now ? 'done' : i === now ? 'current' : 'upcoming',
    // Packing is the one step whose stamp is when it STARTED. Under "Packing"
    // that reads right ("since 9 Aug"); under "Packed" it would claim the
    // parcel was ready at the moment it was paid for, so it is dropped — the
    // Shipped time beside it says when it actually left.
    at: i > now || (s.key === 'packing' && i < now) ? null : stampFor(o, s.key),
  }));
}

export type Tone = 'progress' | 'action' | 'success' | 'stopped';

export interface Headline {
  title: string;
  detail: string;
  tone: Tone;
}

// The shipping page's delivery-time table, by the same three regions.
const ETA: Record<TrackedOrder['region'], string> = {
  'klang-valley': '1–2 business days',
  peninsular: '2–4 business days',
  east: '3–7 business days',
};

/** The one sentence a customer came to this page for. */
export function orderHeadline(o: TrackedOrder): Headline {
  if (o.status === 'CANCELLED') {
    if (o.paymentStatus === 'REFUNDED') {
      return { title: 'Cancelled and refunded', detail: `We've returned ${rm(o.refundedAmount || o.total)} to you.`, tone: 'stopped' };
    }
    if (o.paymentStatus === 'FAILED') {
      return { title: 'Payment didn’t go through', detail: 'This order was cancelled and nothing was charged. You’re welcome to order again.', tone: 'stopped' };
    }
    return { title: 'Order cancelled', detail: 'No payment was taken for this order. Message us if that’s unexpected.', tone: 'stopped' };
  }

  switch (reached(o)) {
    case 1:
      if (o.proofSubmitted) {
        return { title: 'Checking your transfer', detail: 'We have your payment screenshot and are matching it to our bank — usually within a few hours during business hours.', tone: 'progress' };
      }
      if (o.paymentUrl) {
        return { title: 'Waiting for your transfer', detail: 'Finish your bank transfer and upload the receipt. We start packing as soon as it’s confirmed.', tone: 'action' };
      }
      if (o.paymentMethod === 'WHATSAPP') {
        return { title: 'Waiting for payment', detail: 'Message us on WhatsApp for payment details. We start packing as soon as it’s confirmed.', tone: 'action' };
      }
      return { title: 'Waiting for payment', detail: 'Your online payment hasn’t come through yet. If you’ve just paid, this updates within a few minutes.', tone: 'action' };
    case 2:
      if (o.delivery?.status === 'SCHEDULED') {
        return { title: 'Delivery booked', detail: `We’re bringing it to you ${slot(o.delivery)}.`, tone: 'progress' };
      }
      return { title: 'Being packed', detail: 'Payment confirmed. Orders leave us within 1–2 business days, in plain, discreet packaging.', tone: 'progress' };
    case 3:
      if (o.delivery?.status === 'SCHEDULED') {
        return { title: 'Out for delivery', detail: `We’re bringing it to you ${slot(o.delivery)}.`, tone: 'progress' };
      }
      return {
        title: 'On the way',
        detail: `${o.shippedAt ? `Shipped ${when(o.shippedAt)}` : 'Shipped'}${o.tracking?.courier ? ` with ${o.tracking.courier}` : ''}. Usually arrives within ${ETA[o.region]}.`,
        tone: 'progress',
      };
    default: {
      const at = o.deliveredAt ?? o.delivery?.completedAt;
      return { title: 'Delivered', detail: at ? `Delivered ${when(at)}. Enjoy, and thank you for ordering.` : 'Your order has arrived. Thank you for ordering.', tone: 'success' };
    }
  }
}

// --------------------------------------------------------------- formatting
// Always Malaysia time: a customer abroad, or a phone set to UTC, should still
// read the time the parcel actually moved.

const TZ = 'Asia/Kuala_Lumpur';

function rm(sen: number) {
  return `RM${(sen / 100).toFixed(2)}`;
}

/** "3 Oct" — under a step. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', timeZone: TZ });
}

/** "2:14 pm" — under a step's date. */
export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).toLowerCase();
}

/** "on Sat, 4 Oct at 2:14 pm" — in a sentence. */
export function when(iso: string): string {
  const day = new Date(iso).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ });
  return `on ${day} at ${shortTime(iso)}`;
}

function slot(d: NonNullable<TrackedOrder['delivery']>): string {
  const start = d.scheduledFor;
  const end = new Date(new Date(start).getTime() + d.durationMinutes * 60_000).toISOString();
  const day = new Date(start).toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'short', timeZone: TZ });
  const [from, to] = [shortTime(start), shortTime(end)];
  // "2:00–3:00 pm", not "2:00 pm–3:00 pm", when both ends share the half of the day.
  const same = from.slice(-2) === to.slice(-2);
  return `on ${day}, ${same ? from.slice(0, -3) : from}–${to}`;
}
