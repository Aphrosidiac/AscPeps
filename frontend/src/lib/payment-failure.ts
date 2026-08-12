import type { Order } from '@/types';

/**
 * How a failed online order is described in admin.
 *
 * The point of this file is one distinction: a customer who selected a payment
 * method and was refused tried to hand us money and could not, while a customer
 * who never chose anything simply left. Both used to render as an identical red
 * "FAILED" badge, which is how a real RM220 bank decline sat unnoticed among
 * eight ordinary abandons. `chase: true` marks the ones a human should follow up.
 */
export interface PaymentFailureCopy {
  label: string;
  detail: string;
  /** A lost sale a human should follow up, rather than normal drop-off. */
  chase: boolean;
}

export function paymentFailureCopy(order: Pick<Order, 'paymentStatus' | 'paymentFailureReason' | 'paymentFailureChannel'>): PaymentFailureCopy | null {
  if (order.paymentStatus !== 'FAILED') return null;

  // "chose FPX B2C" when we know the channel, "chose a payment method" when we
  // don't — never "chose a payment method via FPX B2C", which is how the two
  // halves read when they're just concatenated.
  const chose = order.paymentFailureChannel
    ? `chose ${order.paymentFailureChannel}`
    : 'chose a payment method';

  switch (order.paymentFailureReason) {
    case 'DECLINED':
      return {
        label: 'Declined',
        detail: `The customer ${chose} and the payment was refused. No money moved. Worth following up — they were trying to buy.`,
        chase: true,
      };
    case 'ABANDONED_MID_PAYMENT':
      return {
        label: 'Dropped mid-payment',
        detail: `The customer ${chose} and was handed over to pay, but no result ever came back. Worth following up.`,
        chase: true,
      };
    case 'NO_ATTEMPT':
      return {
        label: 'Never attempted',
        detail: 'The customer reached the payment page and never chose a payment method. Ordinary checkout drop-off.',
        chase: false,
      };
    case 'NO_BILL':
      return {
        label: 'No bill created',
        detail: 'The order was placed but the payment gateway never issued a bill, so there was nothing for the customer to pay. This one is on us.',
        chase: true,
      };
    // UNKNOWN and null are the same thing to a reader — we could not find out.
    // Deliberately NOT worded as "never attempted": an unclassified order is
    // most likely one that failed before this was recorded, and quietly calling
    // it drop-off would hide exactly the sales this feature exists to surface.
    default:
      return {
        label: 'Reason unknown',
        detail: 'The gateway could not be asked why this payment failed, or the order failed before failure reasons were recorded.',
        chase: false,
      };
  }
}
