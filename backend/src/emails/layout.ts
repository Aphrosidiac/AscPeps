// Shared email chrome: table-based layout, inline CSS only (the lowest common
// denominator email clients actually render — no flexbox, no CSS gradients,
// no custom fonts). Visual language is pulled from the site's OG image
// (public/images/og-image.png): near-black #0A0A0A rather than pure black,
// the icon+wordmark lockup, a single green accent (--color-success in the
// site's globals.css) used only for status, and a small rounded-full status
// badge in place of the OG image's trust-badge motif.

export const SITE_URL = 'https://ascendpeptides.my';

// Bump this when either logo asset changes. The early test sends referenced
// this exact URL while the asset was still 404ing (pre-deploy) — some
// clients' image loaders cache that miss by URL rather than re-checking, so
// a fixed unversioned path can keep showing blank indefinitely even after
// the file is fixed server-side. A version query string forces every client
// to treat it as a URL it's never seen before.
const ASSET_VERSION = 2;

// One token per role, used everywhere — the "vibe-coded" tell is usually 3
// near-identical grays and 2 near-identical border colors sprinkled at
// random. Pick one of each and stick to it.
export const INK = '#0A0A0A'; // headlines, strong values — not pure #000
export const BODY = '#54565b'; // paragraph text
export const MUTED = '#9a9a9e'; // labels, captions, footer
export const BORDER = '#ececec';
export const ACCENT = '#22C55E'; // matches --color-success in the site's globals.css

export const FONT = "Helvetica, Arial, sans-serif";
export const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Subject templates now come from an admin-editable Setting — strip embedded
// newlines defensively (header injection hygiene) before templating in the
// order number. No HTML-escaping here: this is a plain email header, not markup.
export function renderSubject(template: string, orderNumber: string): string {
  const clean = template.replace(/[\r\n]+/g, ' ').trim();
  return clean.replace('{orderNumber}', orderNumber);
}

// Same sen-to-RM formatting as receipt-pdf.ts — all money is stored in sen.
export function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Order shape both templates render — the worker's include (items with
// variant + parent product) satisfies this, as does the admin/receipt include.
export interface EmailOrderItem {
  quantity: number;
  unitPrice: number;
  variant: { size: string | null; product: { name: string } };
}

export interface EmailOrder {
  orderNumber: string;
  createdAt: Date | string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  paymentMethod: string;
  paymentGateway: string | null;
  discountCode?: { code: string } | null;
  items: EmailOrderItem[];
}

// A small rounded-full badge with a status dot — the email-safe descendant of
// the OG image's "99%+ Purity / Third-Party Tested" pill motif, repurposed
// here to carry real status instead of decoration. Built from nested tables
// (not <div>) so Outlook's Word engine lays it out correctly; the border-
// radius simply degrades to a square corner there, which is a fine trade.
export function renderBadge(label: string, tone: 'neutral' | 'success' = 'neutral'): string {
  const dotColor = tone === 'success' ? ACCENT : '#6b6b70';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;">
            <tr>
              <td bgcolor="${INK}" style="background-color:${INK} !important;border-radius:999px;padding:7px 14px 7px 11px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="7" style="width:7px;padding-right:7px;">
                      <table role="presentation" width="7" height="7" cellpadding="0" cellspacing="0"><tr><td width="7" height="7" bgcolor="${dotColor}" style="width:7px;height:7px;line-height:7px;font-size:0;background-color:${dotColor} !important;border-radius:50%;">&nbsp;</td></tr></table>
                    </td>
                    <td style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.02em;color:#ffffff !important;white-space:nowrap;">${label}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>`;
}

// Order number + placed-date meta line, monospace on the number — a small,
// safe detail that reads as "engineered" rather than a generic template.
export function renderMetaLine(order: EmailOrder): string {
  return `<p style="margin:0 0 20px;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">
            Order <span style="font-family:${MONO};font-weight:600;color:${INK};">#${escapeHtml(order.orderNumber)}</span> &middot; placed ${formatDate(order.createdAt)}
          </p>`;
}

const cellStyle = `padding:12px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:13px;color:${INK};`;
const totalRow = (label: string, value: string, bold = false) => `
            <tr>
              <td style="padding:4px 0;font-family:${FONT};font-size:13px;color:${bold ? INK : BODY};${bold ? `font-weight:700;font-size:15px;padding-top:10px;` : ''}">${label}</td>
              <td align="right" style="padding:4px 0;font-family:${FONT};font-size:13px;color:${bold ? INK : BODY};${bold ? `font-weight:700;font-size:15px;padding-top:10px;` : ''}">${value}</td>
            </tr>`;

// Item table + totals + shipping address — the block shared by the order
// confirmation and payment receipt.
export function renderOrderSummary(order: EmailOrder): string {
  const itemRows = order.items
    .map((item) => {
      const sizeLine = item.variant.size
        ? `<br><span style="font-family:${FONT};font-size:11px;color:${MUTED};">${escapeHtml(item.variant.size)}</span>`
        : '';
      return `
            <tr>
              <td style="${cellStyle}"><span style="font-weight:600;">${escapeHtml(item.variant.product.name)}</span>${sizeLine}</td>
              <td align="center" style="${cellStyle}">${item.quantity}</td>
              <td align="right" style="${cellStyle}">${formatRM(item.unitPrice * item.quantity)}</td>
            </tr>`;
    })
    .join('');

  const discountLabel = order.discountCode
    ? `Discount (${escapeHtml(order.discountCode.code)})`
    : 'Discount';

  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:0 0 10px;border-bottom:2px solid ${INK};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;color:${MUTED};">ITEM</td>
              <td align="center" style="padding:0 0 10px;border-bottom:2px solid ${INK};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;color:${MUTED};">QTY</td>
              <td align="right" style="padding:0 0 10px;border-bottom:2px solid ${INK};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;color:${MUTED};">AMOUNT</td>
            </tr>${itemRows}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">${totalRow('Subtotal', formatRM(order.subtotal))}${
            order.discountAmount > 0 ? totalRow(discountLabel, `-${formatRM(order.discountAmount)}`) : ''
          }${totalRow('Shipping', order.shippingFee ? formatRM(order.shippingFee) : 'Free')}${totalRow('Total', formatRM(order.total), true)}
          </table>
          <p style="margin:28px 0 6px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;color:${MUTED};">SHIPPING ADDRESS</p>
          <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BODY};">
            ${escapeHtml(order.customerName)}<br>
            ${escapeHtml(order.address)}<br>
            ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.postcode)}
          </p>`;
}

// Bulletproof button: table + solid-bg <td> + anchor, not a styled <a> alone —
// the pattern that survives Outlook's Word rendering engine.
export function renderButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td bgcolor="${INK}" style="background-color:${INK} !important;border-radius:8px;">
                <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.04em;color:#ffffff !important;text-decoration:none;border-radius:8px;">${label}</a>
              </td>
            </tr>
          </table>`;
}

// Same fallback as receipt-pdf.ts's footerNote — both read the same
// `receipt_footer_note` Setting so the email and the PDF can never drift.
const DEFAULT_DISCLAIMER = 'All products are for research and laboratory use only.';

// Hidden preview text: the line an inbox shows next to the subject. Without
// this, clients fall back to whatever text starts the body (often "View in
// browser" or raw whitespace) — a small detail most generated emails skip.
function renderPreheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">
    ${escapeHtml(text)}${'&nbsp;&zwnj;'.repeat(60)}
  </div>`;
}

/**
 * The visible unsubscribe line. Marketing mail only — transactional mail must
 * NOT carry one, because an order confirmation is not something a customer
 * can opt out of and offering it there just invites people to unsubscribe
 * from their own receipts.
 *
 * Deliberately plain text, underlined, in the footer's own muted colour: an
 * unsubscribe link that has been styled to hide is the thing that earns a
 * spam complaint instead of a quiet opt-out, and a complaint costs far more.
 */
function renderUnsubscribe(url: string): string {
  return `<p style="margin:12px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">
              You're receiving this because you signed up for ASCEND updates.<br>
              <a href="${escapeHtml(url)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
            </p>`;
}

export function renderLayout(
  bodyHtml: string,
  preheader: string,
  settings: Record<string, string>,
  unsubscribeUrl?: string
): string {
  const disclaimer = escapeHtml(settings.receipt_footer_note || DEFAULT_DISCLAIMER);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;" bgcolor="#f4f4f4">
${renderPreheader(preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="background-color:#f4f4f4;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;background-color:#ffffff !important;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
        <tr>
          <td bgcolor="${INK}" style="background-color:${INK} !important;padding:26px 36px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td width="34" style="padding-right:8px;"><img src="${SITE_URL}/images/pill-badge-dark.png?v=${ASSET_VERSION}" width="34" height="34" alt="" style="display:block;width:34px;height:34px;"></td>
                <td style="font-family:${FONT};font-size:19px;font-weight:700;letter-spacing:4px;color:#ffffff !important;">ASCEND</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff !important;padding:40px 36px;font-family:${FONT};font-size:14px;line-height:1.6;color:${INK};">
${bodyHtml}
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff !important;padding:26px 36px;border-top:1px solid ${BORDER};text-align:center;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 14px;">
              <tr>
                <td width="18" style="padding-right:6px;"><img src="${SITE_URL}/images/pill-badge-light.png?v=${ASSET_VERSION}" width="18" height="18" alt="" style="display:block;width:18px;height:18px;"></td>
                <td style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:2px;color:${MUTED};">ASCEND</td>
              </tr>
            </table>
            <p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">
              ${disclaimer}<br>
              <a href="${SITE_URL}" style="color:${MUTED};text-decoration:underline;">ascendpeptides.my</a>
            </p>${unsubscribeUrl ? renderUnsubscribe(unsubscribeUrl) : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
