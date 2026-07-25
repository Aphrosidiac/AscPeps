import { renderLayout, renderOrderSummary, renderBadge, renderMetaLine, renderSubject, escapeHtml, formatDate, type EmailOrder } from './layout.js';

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

  const badge = escapeHtml(settings.email_badge_receipt || DEFAULT_BADGE);

  const html = renderLayout(
    `
          ${renderBadge(badge, 'success')}
          <h1 style="margin:16px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#0A0A0A;">Your payment is confirmed</h1>
${renderMetaLine(order)}
          <p style="margin:-8px 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            Received on ${formatDate(paidAt)} via ${payMethod}.
          </p>
${renderOrderSummary(order)}
          <p style="margin:28px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            Your official receipt is attached as a PDF. We&#39;ll notify you once your order ships.
          </p>`,
    `Receipt for order ${order.orderNumber} — payment confirmed.`,
    settings
  );

  return { subject: renderSubject(settings.email_subject_receipt || DEFAULT_SUBJECT, order.orderNumber), html };
}
