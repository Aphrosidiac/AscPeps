import {
  renderLayout,
  renderButton,
  renderOrderSummary,
  renderMetaLine,
  escapeHtml,
  formatRM,
  type EmailOrder,
  FONT,
  INK,
  BODY,
  MUTED,
} from './layout.js';

const DEFAULT_SUBJECT = 'Your Ascend MY order {orderNumber} is still waiting for payment';

/**
 * One reminder for an order that was created but never paid, while its bill is
 * still open.
 *
 * Treated as transactional, not marketing: it concerns a specific order the
 * recipient started themselves, it goes out exactly once (enforced by the
 * outbox's (orderId, type) unique key), and it carries no unsubscribe link for
 * the same reason an order confirmation doesn't — this is not a list anyone
 * joined. The switch that governs it is `abandoned_checkout_enabled`, so it
 * can still be turned off on its own without touching receipts.
 *
 * Tone follows the rest of the mail here: state the position, give the link,
 * don't manufacture urgency. The genuine deadline (stock is released when the
 * bill lapses) is real and worth saying plainly — inventing a countdown on top
 * of it is what makes these emails feel like spam.
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

  const action = paymentUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0;">
            <tr><td>${renderButton('COMPLETE PAYMENT', paymentUrl)}</td></tr>
          </table>
          <p class="muted" style="margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            The items above are held for you until this payment link expires. After that the stock goes back to general availability and you'd need to order again.
          </p>`
    : // No reconstructable link — the bill reference was never stored, or the
      // gateway changed. Sending them to the catalog is a dead end, so point
      // at the humans instead of pretending there's a button.
      `<p class="body-text" style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${BODY};">
            Reply to this email or message us on WhatsApp and we'll send you a fresh payment link.
          </p>`;

  const body = `
          <p class="body-text" style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            Hi ${escapeHtml(order.customerName.split(' ')[0])}, your order came through but the payment didn't complete. <strong class="ink" style="color:${INK};">Nothing has been charged.</strong> If it was a bank timeout or you changed your mind mid-way, you can pick it back up below.
          </p>
${action}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="height:32px;line-height:32px;font-size:0;">&nbsp;</td></tr></table>
${renderOrderSummary(order)}`;

  return {
    subject,
    html: renderLayout({
      hero: {
        badge: { label: 'AWAITING PAYMENT' },
        headline: "You didn't finish",
        subhead: 'checking out.',
        meta: renderMetaLine(order),
      },
      body,
      preheader: `${formatRM(order.total)} — your order is held until the payment link expires.`,
      settings,
    }),
  };
}
