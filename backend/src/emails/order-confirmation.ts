import {
  renderLayout,
  renderOrderSummary,
  renderMetaLine,
  renderButton,
  renderSubject,
  escapeHtml,
  SITE_URL,
  FONT,
  INK,
  BODY,
  MUTED,
  BORDER,
  type EmailOrder,
} from './layout.js';
import { env } from '../config/env.js';

const DEFAULT_SUBJECT = 'Order {orderNumber} received — Ascend Peptides';
const DEFAULT_BADGE = 'ORDER CONFIRMED';
const DEFAULT_BUTTON_LABEL = 'COMPLETE PAYMENT';
const DEFAULT_WHATSAPP_INSTRUCTIONS =
  "Manual transfer via WhatsApp. Payment is completed through our WhatsApp chat — we'll confirm your order once it's received.";

/**
 * Post-purchase content, not product cross-sell.
 *
 * Order confirmations are the highest-engagement mail a store sends, and the
 * standard play is a "you might also like" product row. On a regulated
 * research-chemical catalogue that is a different risk profile from selling
 * homeware — recommending compounds to someone who has just bought one is
 * exactly the framing the product copy is written to avoid. Reference material
 * earns the same click without making a recommendation.
 */
const NEXT_STEPS: { label: string; blurb: string; path: string }[] = [
  {
    label: 'Reconstitution calculator',
    blurb: 'Work out BAC water volume and units per dose before your vial arrives.',
    path: '/calculator',
  },
  {
    label: 'Handling & storage guide',
    blurb: 'How to store, reconstitute and handle lyophilised material properly.',
    path: '/guide',
  },
];

function renderNextSteps(): string {
  const rows = NEXT_STEPS.map(
    (r) => `
            <tr>
              <td class="border-b" style="padding:0 0 13px;border-bottom:1px solid ${BORDER};">
                <a href="${SITE_URL}${r.path}" class="ink" style="font-family:${FONT};font-size:14px;font-weight:600;color:${INK} !important;text-decoration:none;">${r.label} &rarr;</a>
                <p class="body-text" style="margin:3px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BODY};">${r.blurb}</p>
              </td>
            </tr>
            <tr><td style="height:13px;line-height:13px;font-size:0;">&nbsp;</td></tr>`
  ).join('');
  return `
          <p class="eyebrow muted" style="margin:32px 0 14px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">WHILE YOU WAIT</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
          </table>`;
}

export function renderOrderConfirmation(
  order: EmailOrder,
  // Reconstructed by the worker from paymentRef/paymentGateway when possible —
  // the bill URL itself is never persisted on the order.
  paymentUrl: string | undefined,
  // Admin-editable copy (see the "Email Content" panel on the admin Emails
  // page) plus receipt_footer_note, threaded through to renderLayout. All
  // values are free text, not safe-by-construction hardcoded strings —
  // escapeHtml() anything interpolated into the HTML.
  settings: Record<string, string>
): { subject: string; html: string } {
  const buttonLabel = escapeHtml(settings.email_button_label || DEFAULT_BUTTON_LABEL);

  let paymentBlock: string;
  if (order.paymentMethod === 'WHATSAPP') {
    const instructions = escapeHtml(settings.email_whatsapp_instructions || DEFAULT_WHATSAPP_INSTRUCTIONS);
    paymentBlock = `
          <p class="body-text" style="margin:26px 0 0;font-family:${FONT};font-size:13px;line-height:1.65;color:${BODY};">
            <strong class="ink" style="color:${INK};">Payment:</strong> ${instructions}
          </p>`;
  } else if (paymentUrl) {
    paymentBlock = `
          <p class="body-text" style="margin:26px 0 14px;font-family:${FONT};font-size:13px;line-height:1.65;color:${BODY};">
            <strong class="ink" style="color:${INK};">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, use the button below.
          </p>
          ${renderButton(buttonLabel, paymentUrl)}`;
  } else {
    // The bill URL isn't persisted (see reconstructPaymentUrl in
    // email-worker.ts), so there's nothing to link back to — send the customer
    // to WhatsApp for a fresh link instead of the old dead-end copy ("please do
    // so via the secure payment page from checkout") with no actual link.
    const whatsappHref = `https://wa.me/${env.WHATSAPP_NUMBER}?text=${encodeURIComponent(
      `Hi, I would like to complete payment for order #${order.orderNumber}`
    )}`;
    paymentBlock = `
          <p class="body-text" style="margin:26px 0 14px;font-family:${FONT};font-size:13px;line-height:1.65;color:${BODY};">
            <strong class="ink" style="color:${INK};">Payment:</strong> Online (${escapeHtml(order.paymentGateway || 'Billplz')}). If you haven&#39;t completed payment yet, message us on WhatsApp and we&#39;ll send you a fresh payment link.
          </p>
          ${renderButton('MESSAGE US ON WHATSAPP', whatsappHref)}`;
  }

  const firstName = escapeHtml(order.customerName.split(' ')[0]);

  const html = renderLayout({
    hero: {
      badge: { label: settings.email_badge_confirmation || DEFAULT_BADGE },
      headline: `Thanks, ${firstName}.`,
      subhead: 'Your order is in.',
      meta: renderMetaLine(order),
    },
    body: `${renderOrderSummary(order)}${paymentBlock}${renderNextSteps()}`,
    preheader: `Order ${order.orderNumber} received — here's your summary.`,
    settings,
  });

  return { subject: renderSubject(settings.email_subject_confirmation || DEFAULT_SUBJECT, order.orderNumber), html };
}
