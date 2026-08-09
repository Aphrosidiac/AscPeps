import {
  renderLayout,
  renderButton,
  renderBadge,
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

const DEFAULT_SUBJECT = 'Your ASCEND order {orderNumber} is still waiting for payment';

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
          <p style="margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            The items above are held for you until this payment link expires. After that the stock goes back to general availability and you'd need to order again.
          </p>`
    : // No reconstructable link — the bill reference was never stored, or the
      // gateway changed. Sending them to the catalog is a dead end, so point
      // at the humans instead of pretending there's a button.
      `<p style="margin:4px 0 0;font-family:${FONT};font-size:14px;line-height:1.6;color:${BODY};">
            Reply to this email or message us on WhatsApp and we'll send you a fresh payment link.
          </p>`;

  const body = `
${renderBadge('AWAITING PAYMENT')}
          <p style="margin:20px 0 8px;font-family:${FONT};font-size:20px;font-weight:700;line-height:1.3;color:${INK};">
            You didn't finish checking out.
          </p>
${renderMetaLine(order)}
          <p style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:1.6;color:${BODY};">
            Hi ${escapeHtml(order.customerName)}, your order came through but the payment didn't complete. Nothing has been charged. If it was a bank timeout or you changed your mind mid-way, you can pick it back up below.
          </p>
${action}
          <p style="margin:32px 0 6px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;color:${MUTED};">WHAT YOU ORDERED</p>
${renderOrderSummary(order)}`;

  return {
    subject,
    html: renderLayout(
      body,
      `${formatRM(order.total)} — your order is held until the payment link expires.`,
      settings
    ),
  };
}
