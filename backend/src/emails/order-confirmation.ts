import { renderLayout, renderOrderSummary, renderBadge, renderMetaLine, renderButton, escapeHtml, type EmailOrder } from './layout.js';

export function renderOrderConfirmation(
  order: EmailOrder,
  // Reconstructed by the worker from paymentRef/paymentGateway when possible —
  // the bill URL itself is never persisted on the order.
  paymentUrl?: string
): { subject: string; html: string } {
  let paymentBlock: string;
  if (order.paymentMethod === 'WHATSAPP') {
    paymentBlock = `
          <p style="margin:28px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            <strong style="color:#0A0A0A;">Payment:</strong> Manual transfer via WhatsApp. Payment is completed through our WhatsApp chat — we&#39;ll confirm your order once it&#39;s received.
          </p>`;
  } else if (paymentUrl) {
    paymentBlock = `
          <p style="margin:28px 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            <strong style="color:#0A0A0A;">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, use the button below.
          </p>
          ${renderButton('COMPLETE PAYMENT', paymentUrl)}`;
  } else {
    paymentBlock = `
          <p style="margin:28px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            <strong style="color:#0A0A0A;">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, please do so via the secure payment page from checkout.
          </p>`;
  }

  const html = renderLayout(
    `
          ${renderBadge('ORDER CONFIRMED')}
          <h1 style="margin:16px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#0A0A0A;">Thanks for your order, ${escapeHtml(order.customerName.split(' ')[0])}</h1>
${renderMetaLine(order)}
${renderOrderSummary(order)}
${paymentBlock}`,
    `Order ${order.orderNumber} received — here's your summary.`
  );

  return { subject: `Order ${order.orderNumber} received — ASCEND Peptides`, html };
}
