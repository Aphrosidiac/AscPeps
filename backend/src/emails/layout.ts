// Shared email chrome and building blocks.
//
// Tables and inline styles only: that is what Outlook's Word engine and the
// Gmail app (which strips <style> for non-Google accounts) both render. The
// <style> block below only adds refinements: webfonts and phone padding.
//
// Look: a slim ink header carrying the Rising lockup, a plain white body,
// sentence-case headings, one ink button, and a quiet footer under the card.
// The header is dark on purpose: clients that force-invert light mail leave a
// dark band alone, so the white logo stays readable everywhere.

import { env } from '../config/env.js';
import { groupOrderItems, groupedLineTotal, includesText } from '../utils/order-lines.js';

export const SITE_URL = 'https://ascendpeptides.my';

// Images load from here; links always point at SITE_URL. Overridable for local
// previews (EMAIL_ASSET_BASE_URL in config/env.ts).
const ASSETS = env.EMAIL_ASSET_BASE_URL?.replace(/\/$/, '') || SITE_URL;

// Bump when an email asset changes: some clients cache images by URL.
const ASSET_VERSION = 5;

// Brand palette (brand/README.md).
export const INK = '#0A0A0A';
export const TEXT = '#262626';
export const MUTED = '#6B6B6B'; // 5.3:1 on white
export const LINE = '#E5E5E5'; // Mist
export const PANEL = '#F5F5F5';
export const PAGE = '#F0F0F0';
export const ACCENT = '#22C55E'; // Signal Green: available / confirmed only

export const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const DISPLAY = "'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Subject from an admin-editable template: one line, {orderNumber} filled. */
export function renderSubject(template: string, orderNumber: string): string {
  return template.replace(/[\r\n]+/g, ' ').trim().replace('{orderNumber}', orderNumber);
}

/** Money is stored in sen. */
export function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function assetUrl(path: string): string {
  const abs = path.startsWith('http') ? path : `${ASSETS}${path.startsWith('/') ? '' : '/'}${path}`;
  return `${abs}?v=${ASSET_VERSION}`;
}

/** Stored product image -> its email-safe JPEG thumb (never .webp: old Outlook can't show it). */
export function emailThumbUrl(imageUrl?: string | null): string | null {
  return imageUrl ? assetUrl(imageUrl.replace(/\.[^./]+$/, '') + '.email.jpg') : null;
}

/** Stored product image -> the 640x512 campaign card JPEG (writeEmailCard in admin-upload.routes.ts). */
export function emailCardUrl(imageUrl?: string | null): string | null {
  return imageUrl ? assetUrl(imageUrl.replace(/\.[^./]+$/, '') + '.card.jpg') : null;
}

export const whatsappUrl = (text?: string) =>
  `https://wa.me/${env.WHATSAPP_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

// ---------------------------------------------------------------------------
// Order shape
// ---------------------------------------------------------------------------

export interface EmailOrderItem {
  id?: string;
  /** Set on an item that came included with another line; see order-lines.ts. */
  parentItemId?: string | null;
  quantity: number;
  unitPrice: number;
  /** Units bought beyond stock (utils/preorder.ts). */
  preorderQty?: number;
  /** Group Buy kit lines: vials per kit. */
  packSize?: number | null;
  variant: { size: string | null; imageUrl?: string | null; product: { name: string; addOnOnly?: boolean } };
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
  /** The confirmation is queued before payment, so this is usually UNPAID, but not always. */
  paymentStatus?: string;
  discountCode?: { code: string } | null;
  items: EmailOrderItem[];
  isPreorder?: boolean;
  /** The store's pre-order lead time ("10–14 days"), attached by the sender. */
  preorderLead?: string;
  groupBuy?: { number: number; title: string; shipEstimate: string | null } | null;
}

/** First word of the name; an all-caps name ("ZUL") is title-cased so the greeting doesn't shout. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] || name;
  const cased = first.length > 1 && first === first.toUpperCase() ? first[0] + first.slice(1).toLowerCase() : first;
  return escapeHtml(cased);
}

/** "Order #ASC-1042 · 11 November 2026" */
export function orderMeta(order: EmailOrder, extra?: string): string {
  return `Order #${escapeHtml(order.orderNumber)} &middot; ${formatDate(order.createdAt)}${extra ? ` &middot; ${extra}` : ''}`;
}

export function paymentMethodLabel(order: EmailOrder): string {
  if (order.paymentMethod === 'WHATSAPP') {
    return order.paymentGateway === 'manualpaygate' ? 'Bank transfer / DuitNow QR' : 'Manual transfer (WhatsApp)';
  }
  return `Online banking (${escapeHtml(order.paymentGateway || 'Billplz')})`;
}

// ---------------------------------------------------------------------------
// Building blocks. Each returns a self-contained chunk for the body cell.
// ---------------------------------------------------------------------------

export function paragraph(html: string, o: { size?: number; color?: string; mb?: number; mt?: number } = {}): string {
  return `
          <p style="margin:${o.mt ?? 0}px 0 ${o.mb ?? 16}px;font-family:${FONT};font-size:${o.size ?? 15}px;line-height:1.6;color:${o.color ?? TEXT};">${html}</p>`;
}

/** Small grey note, usually under a button. */
export function note(html: string, mt = 20): string {
  return `
          <p style="margin:${mt}px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${html}</p>`;
}

export function heading(text: string, mt = 32): string {
  return `
          <p style="margin:${mt}px 0 12px;font-family:${DISPLAY};font-size:16px;line-height:1.4;font-weight:600;color:${INK};">${text}</p>`;
}

export function spacer(h: number): string {
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="${h}" style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

export function divider(my = 28): string {
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${my}px 0;"><tr><td height="1" style="height:1px;font-size:0;line-height:0;background-color:${LINE};">&nbsp;</td></tr></table>`;
}

/** Ink button. Table cell carries the colour so Outlook draws it too. */
export function button(label: string, href: string, o: { mt?: number; secondary?: boolean } = {}): string {
  const cell = o.secondary
    ? `background-color:#ffffff;border:1px solid ${LINE};border-radius:8px;`
    : `background-color:${INK};border-radius:8px;`;
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:${o.mt ?? 8}px 0 0;">
            <tr>
              <td bgcolor="${o.secondary ? '#ffffff' : INK}" style="${cell}">
                <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:13px 22px;font-family:${FONT};font-size:15px;line-height:1.2;font-weight:600;color:${o.secondary ? INK : '#ffffff'};text-decoration:none;white-space:nowrap;border-radius:8px;">${label}</a>
              </td>
            </tr>
          </table>`;
}

/** Grey rounded box. */
export function panel(inner: string, o: { mt?: number; mb?: number; pad?: string } = {}): string {
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${o.mt ?? 0}px 0 ${o.mb ?? 24}px;">
            <tr>
              <td bgcolor="${PANEL}" style="background-color:${PANEL};border-radius:10px;padding:${o.pad ?? '18px 20px'};">${inner}
              </td>
            </tr>
          </table>`;
}

/** A panel with a bold lead-in: pre-order, group buy, reasons. */
export function notice(title: string, text: string, o: { mb?: number } = {}): string {
  return panel(
    `
                <p style="margin:0 0 4px;font-family:${FONT};font-size:14px;line-height:1.5;font-weight:600;color:${INK};">${title}</p>
                <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${TEXT};">${text}</p>`,
    { mb: o.mb }
  );
}

/** A code to copy: discount codes, affiliate codes. */
export function codeBox(label: string, code: string, foot?: string): string {
  return panel(
    `
                <p style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">${label}</p>
                <p style="margin:0;font-family:${MONO};font-size:24px;line-height:1.3;font-weight:700;letter-spacing:0.06em;color:${INK};">${escapeHtml(code)}</p>${
                  foot ? `\n                <p style="margin:8px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">${foot}</p>` : ''
                }`,
    { pad: '20px 22px' }
  );
}

/** Label / value rows. Values are trusted HTML; escape before passing. */
export function details(rows: [string, string][], o: { mb?: number } = {}): string {
  const cells = rows
    .map(
      ([k, v], i) => `
            <tr>
              <td valign="top" width="112" style="width:112px;padding:${i ? 12 : 0}px 16px 0 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${MUTED};">${k}</td>
              <td valign="top" style="padding:${i ? 12 : 0}px 0 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${INK};">${v}</td>
            </tr>`
    )
    .join('');
  return panel(
    `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}
                </table>`,
    { mb: o.mb }
  );
}

/** Plain list of links with a one-line description each. */
export function linkList(items: { label: string; blurb: string; href: string }[]): string {
  return items
    .map(
      (r, i) => `
          <p style="margin:${i ? 14 : 0}px 0 0;font-family:${FONT};font-size:15px;line-height:1.5;">
            <a href="${escapeHtml(r.href)}" target="_blank" style="color:${INK};font-weight:600;text-decoration:underline;text-underline-offset:2px;">${r.label}</a><br>
            <span style="font-size:14px;color:${MUTED};">${r.blurb}</span>
          </p>`
    )
    .join('');
}

export const link = (label: string, href: string) =>
  `<a href="${escapeHtml(href)}" target="_blank" style="color:${INK};text-decoration:underline;text-underline-offset:2px;">${label}</a>`;

// ---------------------------------------------------------------------------
// Order summary
// ---------------------------------------------------------------------------

// Line-art stand-ins for products with no photo, matched on the name: the
// categories don't separate a syringe from a swab.
const FALLBACK_ICONS: [RegExp, string][] = [
  [/syringe/i, 'syringe'],
  [/swab|wipe/i, 'swab'],
  [/water|solvent|bacteriostatic/i, 'droplet'],
];

function thumb(item: EmailOrderItem): string {
  const src = emailThumbUrl(item.variant.imageUrl);
  const icon = FALLBACK_ICONS.find(([re]) => re.test(item.variant.product.name))?.[1] ?? 'vial';
  // The image sits inside a grey tile, so a blocked or missing image still
  // leaves a tidy square.
  const inner = src
    ? `<img src="${escapeHtml(src)}" width="52" height="52" alt="" style="display:block;width:52px;height:52px;border-radius:8px;">`
    : `<img src="${assetUrl(`/images/email-icons/${icon}.png`)}" width="24" height="24" alt="" style="display:block;width:24px;height:24px;margin:14px auto;">`;
  return `<table role="presentation" width="52" cellpadding="0" cellspacing="0"><tr><td width="52" height="52" bgcolor="${PANEL}" style="width:52px;height:52px;background-color:${PANEL};border-radius:8px;font-size:0;line-height:0;">${inner}</td></tr></table>`;
}

const sumRow = (label: string, value: string, total = false) => `
            <tr>
              <td style="padding:${total ? '14px 0 0' : '3px 0'};${total ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:${total ? 16 : 14}px;line-height:1.5;${total ? `font-weight:600;color:${INK};` : `color:${MUTED};`}">${label}</td>
              <td align="right" style="padding:${total ? '14px 0 0' : '3px 0'};${total ? `border-top:1px solid ${LINE};` : ''}font-family:${FONT};font-size:${total ? 16 : 14}px;line-height:1.5;white-space:nowrap;${total ? `font-weight:600;color:${INK};` : `color:${TEXT};`}">${value}</td>
            </tr>`;

/** Items, totals, then where it ships and how it was paid. */
export function renderOrderSummary(order: EmailOrder, o: { title?: string } = {}): string {
  const { lines, looseIncludes } = groupOrderItems(order.items);
  const rows = lines
    .map(({ item, includes }, i) => {
      const qty =
        item.packSize && item.packSize > 1
          ? `${item.quantity / item.packSize} kit${item.quantity / item.packSize === 1 ? '' : 's'} &middot; ${item.quantity} vials`
          : `Qty ${item.quantity}`;
      const sub = [item.variant.size ? escapeHtml(item.variant.size) : '', qty].filter(Boolean).join(' &middot; ');
      const pre =
        !order.groupBuy && item.preorderQty && item.preorderQty > 0
          ? `<br><span style="font-size:13px;color:${INK};">Pre-order${item.preorderQty < item.quantity ? ` &middot; ${item.preorderQty} of ${item.quantity}` : ''}</span>`
          : '';
      const inc = includes.length
        ? `<br><span style="font-size:13px;color:${MUTED};">Includes ${escapeHtml(includesText(includes))}</span>`
        : '';
      const top = i ? `border-top:1px solid ${LINE};` : '';
      return `
            <tr>
              <td width="64" valign="top" style="width:64px;padding:14px 12px 14px 0;${top}">${thumb(item)}</td>
              <td valign="top" style="padding:14px 0;${top}font-family:${FONT};font-size:15px;line-height:1.45;color:${INK};">
                <span style="font-weight:500;">${escapeHtml(item.variant.product.name)}</span><br><span style="font-size:13px;color:${MUTED};">${sub}</span>${pre}${inc}
              </td>
              <td align="right" valign="top" style="padding:14px 0 14px 12px;${top}font-family:${FONT};font-size:15px;line-height:1.45;color:${INK};white-space:nowrap;">${formatRM(groupedLineTotal({ item, includes }))}</td>
            </tr>`;
    })
    .join('');
  const loose = looseIncludes.length
    ? `
            <tr>
              <td colspan="3" style="padding:12px 0;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">Included: ${escapeHtml(includesText(looseIncludes))}</td>
            </tr>`
    : '';

  const discountLabel = order.discountCode ? `Discount (${escapeHtml(order.discountCode.code)})` : 'Discount';
  const shipTo = `${escapeHtml(order.customerName)}<br>${escapeHtml(order.address)}<br>${escapeHtml(order.postcode)} ${escapeHtml(order.city)}, ${escapeHtml(order.state)}`;

  return `${renderShipNotice(order)}${heading(o.title ?? 'Order summary', 0)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">${rows}${loose}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 28px;">${sumRow('Subtotal', formatRM(order.subtotal))}${
            order.discountAmount > 0 ? sumRow(discountLabel, `&minus;${formatRM(order.discountAmount)}`) : ''
          }${sumRow('Shipping', order.shippingFee ? formatRM(order.shippingFee) : 'Free')}${sumRow('Total', formatRM(order.total), true)}
          </table>${details([
            ['Shipping to', shipTo],
            ['Payment', paymentMethodLabel(order)],
          ], { mb: 0 })}`;
}

/** Above the items when the order does not ship straight away. */
export function renderShipNotice(order: EmailOrder): string {
  if (order.groupBuy) {
    const est = order.groupBuy.shipEstimate ? ` Estimated: ${escapeHtml(order.groupBuy.shipEstimate)}.` : '';
    return notice(
      `Group Buy, Batch ${String(order.groupBuy.number).padStart(2, '0')}`,
      `This order ships with the batch once it closes and the stock arrives.${est} We&#39;ll email you at every step.`,
      { mb: 28 }
    );
  }
  if (order.isPreorder) {
    return notice(
      'Pre-order',
      `Part of this order ships in ${escapeHtml(order.preorderLead || '10–14 days')}, together with the rest of your items.`,
      { mb: 28 }
    );
  }
  return '';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const DEFAULT_DISCLAIMER = 'All products are for research and laboratory use only.';

export const UNSUBSCRIBE_REASON_SIGNUP = "You're receiving this because you signed up for Ascend MY updates.";

export interface LayoutOptions {
  /** Small line above the headline (campaign label). Plain text, escaped by the caller. */
  eyebrow?: string;
  /** Escaped HTML. */
  headline: string;
  /** Grey line under the headline: order number and date, a batch name. */
  meta?: string;
  body: string;
  /** The inbox preview line next to the subject. Plain text. */
  preheader: string;
  settings: Record<string, string>;
  /** Marketing mail only: transactional mail carries no unsubscribe. */
  unsubscribeUrl?: string;
  unsubscribeReason?: string;
}

export function renderLayout(o: LayoutOptions): string {
  const disclaimer = escapeHtml(o.settings.receipt_footer_note || DEFAULT_DISCLAIMER);
  const logo = assetUrl('/images/email/ascend-my-on-dark.png');
  const foot = `margin:0;font-family:${FONT};font-size:12px;line-height:1.7;color:${MUTED};`;
  const footLink = `color:${MUTED};text-decoration:underline;`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(o.preheader)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600&display=swap');
</style>
<style>
body, table, td, p, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
@media only screen and (max-width:620px) {
  .pad  { padding-left:24px !important; padding-right:24px !important; }
  .outer { padding:0 !important; }
  .card { border-radius:0 !important; }
  .h1   { font-size:24px !important; }
}
</style>
<!--[if mso]><style>* { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${PAGE};" bgcolor="${PAGE}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE};opacity:0;">${escapeHtml(o.preheader)}${'&#8199;&#847;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="background-color:${PAGE};">
  <tr>
    <td align="center" class="outer" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" bgcolor="#ffffff" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
        <tr>
          <td class="pad" bgcolor="${INK}" style="background-color:${INK};padding:22px 40px;">
            <a href="${SITE_URL}" target="_blank" style="text-decoration:none;"><img src="${logo}" width="140" height="20" alt="Ascend MY" style="display:block;width:140px;height:20px;border:0;font-family:${DISPLAY};font-size:18px;font-weight:600;color:#ffffff;"></a>
          </td>
        </tr>
        <tr>
          <td class="pad" style="padding:40px 40px 44px;">${
            o.eyebrow
              ? `
            <p style="margin:0 0 10px;font-family:${FONT};font-size:14px;line-height:1.4;font-weight:600;color:${MUTED};">${o.eyebrow}</p>`
              : ''
          }
            <h1 class="h1" style="margin:0;font-family:${DISPLAY};font-size:28px;line-height:1.25;font-weight:600;letter-spacing:-0.02em;color:${INK};">${o.headline}</h1>${
              o.meta
                ? `
            <p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};">${o.meta}</p>`
                : ''
            }
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="28" style="height:28px;font-size:0;line-height:0;">&nbsp;</td></tr></table>${o.body}
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
        <tr>
          <td class="pad" align="center" style="padding:24px 40px 8px;">
            <p style="${foot}">Questions? <a href="${whatsappUrl()}" target="_blank" style="${footLink}">Message us on WhatsApp</a> or reply to this email.</p>
            <p style="${foot}margin-top:12px;">${disclaimer}<br>Ascend MY &middot; <a href="${SITE_URL}" target="_blank" style="${footLink}">ascendpeptides.my</a></p>${
              o.unsubscribeUrl
                ? `
            <p style="${foot}margin-top:12px;">${escapeHtml(o.unsubscribeReason ?? UNSUBSCRIBE_REASON_SIGNUP)}<br><a href="${escapeHtml(o.unsubscribeUrl)}" target="_blank" style="${footLink}">Unsubscribe</a></p>`
                : ''
            }
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
