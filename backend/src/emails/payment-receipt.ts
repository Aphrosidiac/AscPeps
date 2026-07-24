import { renderLayout, renderOrderSummary, escapeHtml, formatDate, type EmailOrder } from './layout.js';

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

  const html = renderLayout(`
          <h1 style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:20px;color:#000000;">Payment received <span style="color:#22863a;">&#10003; PAID</span></h1>
          <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            Hi ${escapeHtml(order.customerName)}, we&#39;ve received your payment for order <strong style="color:#111111;">${escapeHtml(order.orderNumber)}</strong> on ${formatDate(paidAt)} via ${payMethod}.
          </p>
${renderOrderSummary(order)}
          <p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            Your official receipt is attached as a PDF. We&#39;ll notify you once your order ships.
          </p>`);

  return { subject: `Receipt for order ${order.orderNumber}`, html };
}
