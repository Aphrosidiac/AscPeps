import {
  renderLayout,
  renderOrderSummary,
  renderSubject,
  orderMeta,
  firstName,
  paragraph,
  divider,
  link,
  formatDate,
  MUTED,
  type EmailOrder,
} from './layout.js';
import { affiliatePortalUrl } from '../utils/affiliate-url.js';

const DEFAULT_SUBJECT = 'Receipt for order {orderNumber}';

/** One quiet line under the receipt while Ascend Affiliate is open; nothing when it's off. */
export function affiliateLine(settings: Record<string, string>): string {
  if (settings.affiliate_enabled !== 'true') return '';
  const discount = Number(settings.affiliate_customer_discount_pct || 5);
  const commission = `${Number(settings.affiliate_default_rate_bps || 500) / 100}%`;
  return `${divider(32)}${paragraph(
    `<strong style="color:#0A0A0A;">Share Ascend.</strong> Give friends ${discount}% off with your own code and earn ${commission} of every paid order they make, paid to your bank. ${link('Become an affiliate', affiliatePortalUrl())}`,
    { size: 14, color: MUTED, mb: 0 }
  )}`;
}

export function renderPaymentReceipt(
  order: EmailOrder,
  /** When payment was confirmed (the order's PAID transition). */
  paidAt: Date | string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const html = renderLayout({
    headline: 'Payment received',
    meta: orderMeta(order, `paid ${formatDate(paidAt)}`),
    body: `${paragraph(
      `Hi ${firstName(order.customerName)}, thanks. We&#39;ve received your payment in full and we&#39;re packing your order now. Your receipt is attached as a PDF, and we&#39;ll email you again when it ships.`,
      { mb: 32 }
    )}${renderOrderSummary(order)}${affiliateLine(settings)}`,
    preheader: "Paid in full. We're packing your order, and your receipt is attached.",
    settings,
  });

  return { subject: renderSubject(settings.email_subject_receipt || DEFAULT_SUBJECT, order.orderNumber), html };
}
