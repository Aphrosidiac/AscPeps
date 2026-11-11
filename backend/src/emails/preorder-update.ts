import {
  renderLayout,
  renderOrderSummary,
  orderMeta,
  firstName,
  paragraph,
  button,
  spacer,
  escapeHtml,
  SITE_URL,
  type EmailOrder,
} from './layout.js';

export const DEFAULT_PREORDER_UPDATE_ETA = 'within the next week';

/**
 * A reassurance note to a paid pre-order that hasn't shipped yet. The ship
 * window comes from the `preorder_update_eta` setting (set by
 * scripts/send-preorder-update.ts --eta) so the next batch can say its own.
 */
export function renderPreorderUpdate(
  order: EmailOrder,
  settings: Record<string, string>
): { subject: string; html: string } {
  const eta = escapeHtml((settings.preorder_update_eta || DEFAULT_PREORDER_UPDATE_ETA).trim());
  const trackUrl = `${SITE_URL}/track?order=${encodeURIComponent(order.orderNumber)}`;

  const html = renderLayout({
    headline: 'Your pre-order is on track',
    meta: orderMeta(order),
    body: `${paragraph(`Hi ${firstName(order.customerName)},`)}${paragraph(
      `A quick update on your pre-order: everything is on schedule, and your order will ship <strong>${eta}</strong>.`
    )}${paragraph(
      'Your payment is confirmed, so there&#39;s nothing you need to do. Once it ships, the tracking number will show on your order page.',
      { mb: 8 }
    )}${button('Track your order', trackUrl)}${paragraph('Thank you for your patience.', { mt: 24, mb: 0 })}${spacer(32)}${renderOrderSummary(
      // The summary's own pre-order notice quotes the store's standard lead
      // time, which this email replaces with a firmer date.
      { ...order, isPreorder: false },
      { title: 'Your order' }
    )}`,
    preheader: `Everything is on schedule. Your order ships ${(settings.preorder_update_eta || DEFAULT_PREORDER_UPDATE_ETA).trim()}.`,
    settings,
  });

  return { subject: `Your pre-order ${order.orderNumber} is on track`, html };
}
