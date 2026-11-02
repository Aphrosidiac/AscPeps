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
  MUTED,
  BORDER,
  type EmailOrder,
} from './layout.js';
import { affiliatePortalUrl } from '../utils/affiliate-url.js';

const DEFAULT_SUBJECT = 'Receipt for order {orderNumber}';
const DEFAULT_BADGE = 'PAYMENT RECEIVED';

/**
 * One quiet line under the receipt while Ascend Affiliate is open: someone who
 * just paid is the likeliest to recommend it. Live numbers from the settings;
 * nothing at all while the programme is off.
 */
export function affiliateLine(settings: Record<string, string>): string {
  if (settings.affiliate_enabled !== 'true') return '';
  const discount = Number(settings.affiliate_customer_discount_pct || 5);
  const commission = `${Number(settings.affiliate_default_rate_bps || 500) / 100}%`;
  return `
          <p class="muted border-t" style="margin:30px 0 0;padding-top:20px;border-top:1px solid ${BORDER};font-family:${FONT};font-size:12px;line-height:1.65;color:${MUTED};">
            <strong class="ink" style="color:${INK};">Share Ascend.</strong> Give friends ${discount}% off with your own code and earn ${commission} of every paid order they make, paid to your bank.
            <a href="${escapeHtml(affiliatePortalUrl())}" class="ink" style="color:${INK};font-weight:600;text-decoration:underline;">Become an affiliate</a>
          </p>`;
}

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
      ? order.paymentGateway === 'manualpaygate'
        ? 'Bank Transfer / DuitNow'
        : 'Manual Transfer (WhatsApp)'
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
          </p>${affiliateLine(settings)}`,
    // Not a restatement of the subject: says what changed (paid), what we are
    // doing about it (packing), and what is attached.
    preheader: "Paid in full — we're packing it now. Your receipt is attached.",
    settings,
  });

  return { subject: renderSubject(settings.email_subject_receipt || DEFAULT_SUBJECT, order.orderNumber), html };
}
