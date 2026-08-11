import {
  renderLayout,
  renderOrderSummary,
  renderMetaLine,
  renderSubject,
  escapeHtml,
  formatDate,
  FONT,
  BODY,
  INK,
  type EmailOrder,
} from './layout.js';

const DEFAULT_SUBJECT = 'Receipt for order {orderNumber}';
const DEFAULT_BADGE = 'PAYMENT RECEIVED';

export function renderPaymentReceipt(
  order: EmailOrder,
  // When the payment was confirmed — the worker passes the order's updatedAt
  // (set by the PAID transition), falling back to send time.
  paidAt: Date | string,
  // Admin-editable copy, threaded through to renderLayout — see
  // order-confirmation.ts for why every value here gets escapeHtml()'d.
  settings: Record<string, string>
): { subject: string; html: string } {
  const payMethod =
    order.paymentMethod === 'WHATSAPP'
      ? 'Manual Transfer (WhatsApp)'
      : `Online (${escapeHtml(order.paymentGateway || 'Billplz')})`;

  const html = renderLayout({
    hero: {
      // The one email in the set that earns the green dot: it is the only one
      // reporting a completed state rather than a pending one.
      badge: { label: settings.email_badge_receipt || DEFAULT_BADGE, tone: 'success' },
      headline: 'Payment confirmed.',
      subhead: "We're packing it now.",
      meta: renderMetaLine(order),
    },
    body: `
          <p class="body-text" style="margin:0 0 26px;font-family:${FONT};font-size:13px;line-height:1.65;color:${BODY};">
            Received on ${formatDate(paidAt)} via ${payMethod}.
          </p>
${renderOrderSummary(order)}
          <p class="body-text" style="margin:26px 0 0;font-family:${FONT};font-size:13px;line-height:1.65;color:${BODY};">
            <strong class="ink" style="color:${INK};">Your receipt is attached as a PDF.</strong> We&#39;ll let you know as soon as your order ships.
          </p>`,
    // Not a restatement of the subject: says what changed (paid), what we are
    // doing about it (packing), and what is attached.
    preheader: "Paid in full — we're packing it now. Your receipt is attached.",
    settings,
  });

  return { subject: renderSubject(settings.email_subject_receipt || DEFAULT_SUBJECT, order.orderNumber), html };
}
