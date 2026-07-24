import { renderLayout, renderOrderSummary, escapeHtml, type EmailOrder } from './layout.js';

export function renderOrderConfirmation(
  order: EmailOrder,
  // Reconstructed by the worker from paymentRef/paymentGateway when possible —
  // the bill URL itself is never persisted on the order.
  paymentUrl?: string
): { subject: string; html: string } {
  let paymentBlock: string;
  if (order.paymentMethod === 'WHATSAPP') {
    paymentBlock = `
          <p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            <strong style="color:#111111;">Payment:</strong> Manual transfer via WhatsApp. Payment is completed through our WhatsApp chat — we&#39;ll confirm your order once it&#39;s received.
          </p>`;
  } else if (paymentUrl) {
    paymentBlock = `
          <p style="margin:24px 0 12px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            <strong style="color:#111111;">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, use the button below.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background-color:#000000;">
                <a href="${escapeHtml(paymentUrl)}" style="display:inline-block;padding:12px 28px;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;letter-spacing:1px;color:#ffffff;text-decoration:none;">COMPLETE PAYMENT</a>
              </td>
            </tr>
          </table>`;
  } else {
    paymentBlock = `
          <p style="margin:24px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            <strong style="color:#111111;">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, please do so via the secure payment page from checkout.
          </p>`;
  }

  const html = renderLayout(`
          <h1 style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:20px;color:#000000;">Order received</h1>
          <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            Hi ${escapeHtml(order.customerName)}, thank you for your order <strong style="color:#111111;">${escapeHtml(order.orderNumber)}</strong>. Here&#39;s a summary:
          </p>
${renderOrderSummary(order)}
${paymentBlock}`);

  return { subject: `Order ${order.orderNumber} received — ASCEND Peptides`, html };
}
