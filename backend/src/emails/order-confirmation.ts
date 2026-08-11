import { renderLayout, renderOrderSummary, renderBadge, renderMetaLine, renderButton, renderSubject, escapeHtml, type EmailOrder } from './layout.js';
import { env } from '../config/env.js';

const DEFAULT_SUBJECT = 'Order {orderNumber} received — Ascend Peptides';
const DEFAULT_BADGE = 'ORDER CONFIRMED';
const DEFAULT_BUTTON_LABEL = 'COMPLETE PAYMENT';
const DEFAULT_WHATSAPP_INSTRUCTIONS =
  "Manual transfer via WhatsApp. Payment is completed through our WhatsApp chat — we'll confirm your order once it's received.";

export function renderOrderConfirmation(
  order: EmailOrder,
  // Reconstructed by the worker from paymentRef/paymentGateway when possible —
  // the bill URL itself is never persisted on the order.
  paymentUrl: string | undefined,
  // Admin-editable copy (see the "Email Content" panel on the admin Emails
  // page) plus receipt_footer_note, threaded through to renderLayout. All
  // values are free text now, not safe-by-construction hardcoded strings —
  // escapeHtml() anything interpolated into the HTML.
  settings: Record<string, string>
): { subject: string; html: string } {
  const buttonLabel = escapeHtml(settings.email_button_label || DEFAULT_BUTTON_LABEL);

  let paymentBlock: string;
  if (order.paymentMethod === 'WHATSAPP') {
    const instructions = escapeHtml(settings.email_whatsapp_instructions || DEFAULT_WHATSAPP_INSTRUCTIONS);
    paymentBlock = `
          <p style="margin:28px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            <strong style="color:#0A0A0A;">Payment:</strong> ${instructions}
          </p>`;
  } else if (paymentUrl) {
    paymentBlock = `
          <p style="margin:28px 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            <strong style="color:#0A0A0A;">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, use the button below.
          </p>
          ${renderButton(buttonLabel, paymentUrl)}`;
  } else {
    // The bill URL isn't persisted (see reconstructPaymentUrl in
    // email-worker.ts), so there's nothing to link back to — send the
    // customer to WhatsApp for a fresh link instead of the old dead-end copy
    // ("please do so via the secure payment page from checkout") with no
    // actual link attached.
    const whatsappHref = `https://wa.me/${env.WHATSAPP_NUMBER}?text=${encodeURIComponent(
      `Hi, I would like to complete payment for order #${order.orderNumber}`
    )}`;
    paymentBlock = `
          <p style="margin:28px 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#54565b;">
            <strong style="color:#0A0A0A;">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, message us on WhatsApp and we&#39;ll send you a fresh payment link.
          </p>
          ${renderButton('MESSAGE US ON WHATSAPP', whatsappHref)}`;
  }

  const badge = escapeHtml(settings.email_badge_confirmation || DEFAULT_BADGE);

  const html = renderLayout(
    `
          ${renderBadge(badge)}
          <h1 style="margin:16px 0 10px;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:#0A0A0A;">Thanks for your order, ${escapeHtml(order.customerName.split(' ')[0])}</h1>
${renderMetaLine(order)}
${renderOrderSummary(order)}
${paymentBlock}`,
    `Order ${order.orderNumber} received — here's your summary.`,
    settings
  );

  return { subject: renderSubject(settings.email_subject_confirmation || DEFAULT_SUBJECT, order.orderNumber), html };
}
