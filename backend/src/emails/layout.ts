// Shared email chrome: table-based layout, inline CSS only (the lowest common
// denominator email clients actually render — no flexbox, no CSS gradients).
//
// The visual language is the site's OG image (public/images/og-image.png),
// carried over properly rather than gestured at: a near-black #0A0A0A hero
// field with the constellation motif behind it, the two-tone headline (white
// clause + muted clause, as in "Premium Research Peptides *in Malaysia*"), the
// rounded trust-badge row, and a single green accent used only for status.
//
// Three things here are load-bearing and easy to break:
//
//   1. The hero is dark in BOTH colour schemes. That is the point of it — a
//      dark panel has nothing for a force-inverting client (Gmail iOS, Outlook
//      2021) to invert, so the most brand-defining part of the email is the
//      part that cannot be mangled.
//   2. Outfit ships via @font-face for the clients that support it (Apple Mail,
//      iOS Mail, Gmail web on Chrome) and falls back to Helvetica/Arial
//      everywhere else. The MSO conditional below is not optional: Outlook's
//      Word engine, given a font-family it cannot resolve, falls back to Times
//      New Roman rather than to the next entry in the stack.
//   3. Product thumbnails point at `.email.jpg`, never the stored `.webp`.
//      WebP is missing from older Outlook desktop builds and renders as a
//      broken-image icon. See scripts/generate-email-thumbs.mjs.

export const SITE_URL = 'https://ascendpeptides.my';

// Bump this when any email asset changes. The early test sends referenced these
// exact URLs while the assets were still 404ing (pre-deploy) — some clients'
// image loaders cache that miss by URL rather than re-checking, so a fixed
// unversioned path can keep showing blank indefinitely even after the file is
// fixed server-side. A version query string forces every client to treat it as
// a URL it has never seen before.
const ASSET_VERSION = 3;

// One token per role. The "vibe-coded" tell is three near-identical greys and
// two near-identical borders sprinkled at random; pick one of each and stick to
// it. Values measured from og-image.png where they have an equivalent there.
export const INK = '#0A0A0A'; // headlines, strong values — not pure #000
export const BODY = '#54565b'; // paragraph text
export const MUTED = '#9a9a9e'; // labels, captions, footer
export const BORDER = '#ececec';
export const ACCENT = '#22C55E'; // matches --color-success in the site's globals.css
export const HERO_BG = '#0A0A0A'; // the OG image's field colour, exactly
export const HERO_SUB = '#8a8a90'; // the OG headline's second-clause grey
export const HERO_CHIP = '#1c1c1c'; // badge chip on the dark field

export const FONT = "'Outfit', Helvetica, Arial, sans-serif";
export const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Subject templates come from an admin-editable Setting — strip embedded
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

/**
 * Stored product image -> the email-safe JPEG sibling, absolute.
 *
 * Returns null when there is no image, so the caller renders the placeholder
 * tile rather than an <img> with an empty src (which some clients draw as a
 * broken icon and others as a 0x0 gap, neither of which lines the row up).
 */
export function emailThumbUrl(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  const jpg = imageUrl.replace(/\.[^./]+$/, '') + '.email.jpg';
  const abs = jpg.startsWith('http') ? jpg : `${SITE_URL}${jpg.startsWith('/') ? '' : '/'}${jpg}`;
  return `${abs}?v=${ASSET_VERSION}`;
}

// Order shape the templates render. `imageUrl` is optional because not every
// caller's Prisma include selects it yet, and because 12 of 69 variants have no
// image at all — both cases fall through to the placeholder tile.
export interface EmailOrderItem {
  quantity: number;
  unitPrice: number;
  variant: { size: string | null; imageUrl?: string | null; product: { name: string } };
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

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export interface HeroOptions {
  /** Small status chip above the headline — the OG image's badge motif, carrying
   *  real status instead of decoration. */
  badge?: { label: string; tone?: 'neutral' | 'success' };
  /** White clause. */
  headline: string;
  /** Muted second clause, the OG headline's two-tone device. Optional. */
  subhead?: string;
  /** Pre-rendered small line under the headline (see renderMetaLine). */
  meta?: string;
}

/**
 * The status chip. Built from nested tables (not <div>) so Outlook's Word engine
 * lays it out; border-radius simply degrades to a square corner there, which is
 * a fine trade. Colours are fixed rather than themed — it always sits on the
 * dark hero.
 */
export function renderBadge(label: string, tone: 'neutral' | 'success' = 'neutral'): string {
  const dotColor = tone === 'success' ? ACCENT : '#6b6b70';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-block;">
            <tr>
              <td bgcolor="${HERO_CHIP}" style="background-color:${HERO_CHIP} !important;border-radius:999px;padding:6px 13px 6px 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="7" style="width:7px;padding-right:7px;">
                      <table role="presentation" width="7" height="7" cellpadding="0" cellspacing="0"><tr><td width="7" height="7" bgcolor="${dotColor}" style="width:7px;height:7px;line-height:7px;font-size:0;background-color:${dotColor} !important;border-radius:50%;">&nbsp;</td></tr></table>
                    </td>
                    <td style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.06em;color:#ffffff !important;white-space:nowrap;">${escapeHtml(label)}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>`;
}

/** Order number + placed date, monospace on the number. Sits in the hero, so its
 *  colours are the hero's, not the body's. */
export function renderMetaLine(order: EmailOrder): string {
  return `Order <span style="font-family:${MONO};font-weight:600;color:#ffffff;">#${escapeHtml(order.orderNumber)}</span> &middot; placed ${formatDate(order.createdAt)}`;
}

function renderHero(hero: HeroOptions): string {
  const bg = `${SITE_URL}/images/email-constellation.png?v=${ASSET_VERSION}`;
  // `background=` attribute + inline background-image covers everything that
  // supports background images at all. Outlook Windows supports neither without
  // VML; it gets the flat HERO_BG, which is a clean degradation rather than a
  // broken one, so the VML is deliberately not worth its weight here.
  return `
        <tr>
          <td class="hero" background="${bg}" bgcolor="${HERO_BG}" style="background-color:${HERO_BG} !important;background-image:url('${bg}');background-position:top right;background-size:600px 210px;background-repeat:no-repeat;padding:26px 36px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td width="26" style="width:26px;padding-right:9px;"><img src="${SITE_URL}/images/pill-badge-dark.png?v=${ASSET_VERSION}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;"></td>
                <td style="font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#ffffff !important;">Ascend MY</td>
              </tr>
            </table>${hero.badge ? `\n            ${renderBadge(hero.badge.label, hero.badge.tone)}` : ''}
            <p style="margin:${hero.badge ? '14px' : '0'} 0 0;font-family:${FONT};font-size:29px;line-height:1.22;font-weight:700;letter-spacing:-0.025em;color:#ffffff !important;">
              ${hero.headline}${hero.subhead ? `<br><span style="color:${HERO_SUB} !important;">${hero.subhead}</span>` : ''}
            </p>${
              hero.meta
                ? `\n            <p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED} !important;">${hero.meta}</p>`
                : ''
            }
          </td>
        </tr>`;
}

// ---------------------------------------------------------------------------
// Order summary
// ---------------------------------------------------------------------------

const totalRow = (label: string, value: string, bold = false) => `
            <tr>
              <td class="${bold ? 'ink' : 'body-text'}" style="padding:4px 0;font-family:${FONT};font-size:13px;color:${bold ? INK : BODY};${bold ? 'font-weight:700;font-size:16px;padding-top:12px;' : ''}">${label}</td>
              <td align="right" class="${bold ? 'ink' : 'body-text'}" style="padding:4px 0;font-family:${FONT};font-size:13px;color:${bold ? INK : BODY};${bold ? 'font-weight:700;font-size:16px;padding-top:12px;' : ''}">${value}</td>
            </tr>`;

/**
 * 56px thumbnail, or a neutral tile of the same footprint so rows stay aligned
 * whether or not a variant has a photo.
 *
 * The <img> is nested inside that same tile rather than standing alone, because
 * "no photo" is not the only way this ends up empty: Outlook desktop blocks
 * remote images by default, plenty of readers never load them, and an
 * undeployed asset 404s. In all of those the browser draws its own broken-image
 * glyph on whatever sits behind it — which, on a bare <img>, was a hardcoded
 * light square sitting in an otherwise dark-mode email.
 *
 * Nesting it means every one of those cases degrades to exactly the placeholder
 * tile, in the right colour for the reader's theme. alt is deliberately empty:
 * the product name is already the next cell, and alt text inside a 56px box
 * just overflows into the row.
 */
/**
 * Which line-art glyph stands in for a product with no photograph.
 *
 * Matched on the product name rather than on its category, because the
 * categories do not carry this distinction: everything here is filed under
 * "Supplies", but a syringe, a foil swab and a bottle of bacteriostatic water
 * are three different objects and one shared icon for them would be noise.
 * Every peptide, whatever its category, ships as a vial — so that is the
 * default rather than a special case.
 *
 * This matters more than it looks: 53 of the last 80 order lines had no photo,
 * because accessories ride along on nearly every order.
 */
const FALLBACK_ICONS: [RegExp, string][] = [
  [/syringe/i, 'syringe'],
  [/swab|wipe/i, 'swab'],
  [/water|solvent|bacteriostatic/i, 'droplet'],
];

function fallbackIcon(productName: string): string {
  const hit = FALLBACK_ICONS.find(([re]) => re.test(productName));
  return `${SITE_URL}/images/email-icons/${hit ? hit[1] : 'vial'}.png?v=${ASSET_VERSION}`;
}

function renderThumb(item: EmailOrderItem): string {
  const src = emailThumbUrl(item.variant.imageUrl);
  const inner = src
    ? `<img src="${escapeHtml(src)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:8px;">`
    : // Drawn in a single midtone grey so ONE asset reads on the #f4f4f4 tile
      // and the #262626 dark one — no display:none image swapping, which
      // Outlook does not honour. With images off it simply vanishes and the
      // row falls back to the empty tile, which is the same place we were.
      `<img src="${fallbackIcon(item.variant.product.name)}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;margin:14px auto;">`;
  return `<table role="presentation" width="56" height="56" cellpadding="0" cellspacing="0"><tr><td width="56" height="56" bgcolor="#f4f4f4" class="thumb-empty" style="width:56px;height:56px;background-color:#f4f4f4;border-radius:8px;font-size:0;line-height:0;">${inner}</td></tr></table>`;
}

export function renderOrderSummary(order: EmailOrder): string {
  const itemRows = order.items
    .map((item) => {
      const size = item.variant.size ? `${escapeHtml(item.variant.size)} &middot; ` : '';
      return `
            <tr>
              <td width="70" class="border-b" style="width:70px;padding:14px 14px 14px 0;border-bottom:1px solid ${BORDER};">${renderThumb(item)}</td>
              <td class="border-b ink" style="padding:14px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:14px;color:${INK};">
                <span style="font-weight:600;">${escapeHtml(item.variant.product.name)}</span><br><span class="muted" style="font-size:12px;color:${MUTED};">${size}Qty ${item.quantity}</span>
              </td>
              <td align="right" class="border-b ink" style="padding:14px 0;border-bottom:1px solid ${BORDER};font-family:${FONT};font-size:14px;font-weight:600;color:${INK};">${formatRM(item.unitPrice * item.quantity)}</td>
            </tr>`;
    })
    .join('');

  const discountLabel = order.discountCode
    ? `Discount (${escapeHtml(order.discountCode.code)})`
    : 'Discount';

  return `
          <p class="eyebrow muted" style="margin:0 0 0;padding-bottom:12px;border-bottom:2px solid ${INK};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">YOUR ITEMS</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${totalRow('Subtotal', formatRM(order.subtotal))}${
            order.discountAmount > 0 ? totalRow(discountLabel, `-${formatRM(order.discountAmount)}`) : ''
          }${totalRow('Shipping', order.shippingFee ? formatRM(order.shippingFee) : 'Free')}${totalRow('Total', formatRM(order.total), true)}
          </table>
          <p class="eyebrow muted" style="margin:30px 0 7px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">SHIPPING TO</p>
          <p class="body-text" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.65;color:${BODY};">
            ${escapeHtml(order.customerName)}<br>
            ${escapeHtml(order.address)}<br>
            ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.postcode)}
          </p>`;
}

/** Bulletproof button: table + solid-bg <td> + anchor, not a styled <a> alone —
 *  the pattern that survives Outlook's Word rendering engine. */
export function renderButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td bgcolor="${INK}" class="btn" style="background-color:${INK};border-radius:9px;">
                <a href="${escapeHtml(href)}" class="btn-a" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.05em;color:#ffffff;text-decoration:none;border-radius:9px;">${label}</a>
              </td>
            </tr>
          </table>`;
}

// The OG image's trust-badge row, reused verbatim as a footer strip. Costs one
// table and no images, and it is the cheapest way to make a receipt feel like
// it came from this brand rather than from a mail platform.
const TRUST_BADGES = ['99%+ Purity', 'Third-Party Tested', 'Fast Shipping'];

function renderTrustStrip(): string {
  const cells = TRUST_BADGES.map(
    (label) => `<td style="padding:0 11px;">
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                        <td width="6" style="width:6px;padding-right:6px;"><table role="presentation" width="6" height="6" cellpadding="0" cellspacing="0"><tr><td width="6" height="6" bgcolor="${ACCENT}" style="width:6px;height:6px;line-height:6px;font-size:0;background-color:${ACCENT} !important;border-radius:50%;">&nbsp;</td></tr></table></td>
                        <td style="font-family:${FONT};font-size:11px;font-weight:700;color:#ffffff !important;white-space:nowrap;">${label}</td>
                      </tr></table>
                    </td>`
  ).join('');
  return `
        <tr>
          <td class="card" style="padding:32px 36px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${HERO_BG}" style="background-color:${HERO_BG} !important;border-radius:11px;">
              <tr>
                <td align="center" style="padding:15px 12px;">
                  <table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

const DEFAULT_DISCLAIMER = 'All products are for research and laboratory use only.';

// Hidden preview text: the line an inbox shows next to the subject. Without
// this, clients fall back to whatever text starts the body (often "View in
// browser" or raw whitespace).
function renderPreheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">
    ${escapeHtml(text)}${'&nbsp;&zwnj;'.repeat(60)}
  </div>`;
}

/**
 * The visible unsubscribe line. Marketing mail only — transactional mail must
 * NOT carry one, because an order confirmation is not something a customer can
 * opt out of and offering it there just invites people to unsubscribe from
 * their own receipts.
 *
 * Deliberately plain and underlined in the footer's own muted colour: an
 * unsubscribe link styled to hide is the thing that earns a spam complaint
 * instead of a quiet opt-out, and a complaint costs far more.
 */
function renderUnsubscribe(url: string): string {
  return `<p class="muted" style="margin:12px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">
              You're receiving this because you signed up for Ascend MY updates.<br>
              <a href="${escapeHtml(url)}" class="muted" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
            </p>`;
}

export interface LayoutOptions {
  hero: HeroOptions;
  body: string;
  preheader: string;
  settings: Record<string, string>;
  /** Marketing mail only. See renderUnsubscribe. */
  unsubscribeUrl?: string;
  /** The trust strip above the footer. On by default; off for mail where it
   *  would read as a sales pitch (the email verification mail, mainly). */
  trust?: boolean;
}

export function renderLayout(o: LayoutOptions): string {
  const disclaimer = escapeHtml(o.settings.receipt_footer_note || DEFAULT_DISCLAIMER);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');

/* Apple Mail, iOS Mail, Outlook.com. The hero is intentionally absent from
   every rule here: it is already dark and must stay exactly as it is.

   NOTE: nothing these rules target may carry !important on the matching
   inline style. An inline declaration marked important outranks a stylesheet
   declaration marked important — there is no selector that wins — so an inline
   background-color:#ffffff !important silently defeats the whole dark theme
   and leaves light-mode text on a light card. Backgrounds that are meant to
   stay fixed (the hero, the badges, the trust strip) keep their inline
   !important on purpose; the themeable ones rely on the bgcolor attribute for
   the Outlook fallback instead. */
@media (prefers-color-scheme: dark) {
  .page-bg    { background-color:#0a0a0a !important; }
  .card       { background-color:#141414 !important; }
  .card-outer { background-color:#141414 !important; border-color:#262626 !important; }
  .ink        { color:#f5f5f5 !important; }
  .body-text  { color:#b8b8bd !important; }
  .muted      { color:#8a8a90 !important; }
  .border-b   { border-bottom-color:#262626 !important; }
  .border-t   { border-top-color:#262626 !important; }
  .eyebrow    { border-bottom-color:#f5f5f5 !important; }
  .btn        { background-color:#f5f5f5 !important; }
  .btn-a      { color:#0A0A0A !important; }
  .code-box   { border-color:#f5f5f5 !important; }
  .thumb-empty{ background-color:#262626 !important; }
}
/* Outlook.com and Outlook for Android rewrite the document and prefix it with
   these attributes instead of honouring the media query above. */
[data-ogsc] .page-bg    { background-color:#0a0a0a !important; }
[data-ogsc] .card       { background-color:#141414 !important; }
[data-ogsc] .card-outer { background-color:#141414 !important; border-color:#262626 !important; }
[data-ogsc] .ink        { color:#f5f5f5 !important; }
[data-ogsc] .body-text  { color:#b8b8bd !important; }
[data-ogsc] .muted      { color:#8a8a90 !important; }
[data-ogsc] .border-b   { border-bottom-color:#262626 !important; }
[data-ogsc] .border-t   { border-top-color:#262626 !important; }
[data-ogsc] .btn        { background-color:#f5f5f5 !important; }
[data-ogsc] .btn-a      { color:#0A0A0A !important; }

@media only screen and (max-width:620px) {
  .pad   { padding-left:22px !important; padding-right:22px !important; }
  .h1    { font-size:25px !important; }
}
</style>
<!--[if mso]>
<style>
  /* Word cannot resolve Outfit and falls back to Times New Roman rather than to
     the next font in the stack, so it is told explicitly. */
  * { font-family: Helvetica, Arial, sans-serif !important; }
</style>
<![endif]-->
</head>
<body class="page-bg" style="margin:0;padding:0;background-color:#f4f4f4;" bgcolor="#f4f4f4">
${renderPreheader(o.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" class="page-bg" style="background-color:#f4f4f4;padding:28px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" class="card-outer" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${BORDER};">
${renderHero(o.hero)}
        <tr>
          <td class="card pad" bgcolor="#ffffff" style="background-color:#ffffff;padding:34px 36px 0;font-family:${FONT};font-size:14px;line-height:1.65;color:${INK};">
${o.body}
          </td>
        </tr>${o.trust === false ? '' : renderTrustStrip()}
        <tr>
          <td class="card pad" bgcolor="#ffffff" style="background-color:#ffffff;padding:28px 36px 32px;text-align:center;">
            <p class="muted" style="margin:0;font-family:${FONT};font-size:11px;line-height:1.7;color:${MUTED};">
              ${disclaimer}<br>
              <a href="${SITE_URL}" class="muted" style="color:${MUTED};text-decoration:underline;">ascendpeptides.my</a>
            </p>${o.unsubscribeUrl ? renderUnsubscribe(o.unsubscribeUrl) : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
