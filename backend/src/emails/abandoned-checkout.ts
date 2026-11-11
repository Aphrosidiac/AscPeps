import {
  renderLayout,
  renderOrderSummary,
  orderMeta,
  firstName,
  paragraph,
  button,
  note,
  spacer,
  link,
  whatsappUrl,
  formatRM,
  type EmailOrder,
} from './layout.js';

const DEFAULT_SUBJECT = 'Your Ascend MY order {orderNumber} is still waiting for payment';

/**
 * One reminder for an order that was started but never paid, while its bill is
 * still open. Transactional (it's their own order, sent once), so no
 * unsubscribe; `abandoned_checkout_enabled` switches it off on its own.
 * States the real deadline and nothing more: no invented countdowns.
 */
export function renderAbandonedCheckout(
  order: EmailOrder & { orderNumber: string },
  paymentUrl: string | undefined,
  settings: Record<string, string>
): { subject: string; html: string } {
  const subject = (settings.abandoned_checkout_subject || DEFAULT_SUBJECT)
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .replace('{orderNumber}', order.orderNumber);

  const intro = `Hi ${firstName(order.customerName)}, your order came through but the payment didn&#39;t complete, so <strong>nothing has been charged</strong>. If the bank timed out or you were interrupted, you can pick it back up here.`;

  const action = paymentUrl
    ? `${button('Complete payment', paymentUrl)}${note("Your items are held until this payment link expires. After that the stock goes back on sale and you'd need to order again.", 16)}`
    : paragraph(
        `Reply to this email or ${link('message us on WhatsApp', whatsappUrl(`Hi, about order #${order.orderNumber}`))} and we&#39;ll send you a fresh payment link.`,
        { mb: 0 }
      );

  return {
    subject,
    html: renderLayout({
      headline: 'Your order is waiting for payment',
      meta: orderMeta(order),
      body: `${paragraph(intro, { mb: paymentUrl ? 12 : 16 })}${action}${spacer(32)}${renderOrderSummary(order)}`,
      preheader: `${formatRM(order.total)}. Your order is held until the payment link expires.`,
      settings,
    }),
  };
}
