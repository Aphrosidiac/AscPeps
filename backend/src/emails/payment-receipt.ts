import { renderLayout, renderOrderSummary, renderBadge, renderMetaLine, escapeHtml, formatDate, type EmailOrder } from './layout.js';

export function renderPaymentReceipt(
  order: EmailOrder,
  // When the payment was confirmed — the worker passes the order's updatedAt
  // (set by the PAID transition), falling back to send time.
  paidAt: Date | string
): { subject: string; html: string } {
  const payMethod =
    order.paymentMethod === 'WHATSAPP'
      ? 'Manual Transfer (WhatsApp)'
      : `Online (${escapeHtml(order.paymentGateway || 'Billplz')})`;

  const html = renderLayout(
    `
          ${renderBadge('PAYMENT RECEIVED', 'success')}
          <h1 style="margin:16px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#0A0A0A;">Your payment is confirmed</h1>
${renderMetaLine(order)}
          <p style="margin:-8px 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            Received on ${formatDate(paidAt)} via ${payMethod}.
          </p>
${renderOrderSummary(order)}
          <p style="margin:28px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            Your official receipt is attached as a PDF. We&#39;ll notify you once your order ships.
          </p>`,
    `Receipt for order ${order.orderNumber} — payment confirmed.`
  );

  return { subject: `Receipt for order ${order.orderNumber}`, html };
}
