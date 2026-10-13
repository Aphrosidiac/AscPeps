import type { PrismaClient, Prisma } from '@prisma/client';
import {
  renderLayout,
  renderButton,
  escapeHtml,
  emailCardUrl,
  SITE_URL,
  UNSUBSCRIBE_REASON_SIGNUP,
  FONT,
  BODY,
  INK,
  MUTED,
  ACCENT,
  HERO_BG,
  HERO_META,
} from './layout.js';
import { getEffectivePrice, isSaleActive } from '../utils/product-pricing.js';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface CampaignContent {
  name: string;
  subject: string;
  preheader: string | null;
  headline?: string | null;
  subhead?: string | null;
  badge?: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  productIds?: string[];
}

/**
 * A featured product as it stands at send time. Nothing here is stored on the
 * campaign: a draft written on Monday and sent on Thursday must quote
 * Thursday's price and stock, not Monday's.
 */
export interface CampaignProduct {
  id: string;
  name: string;
  slug: string;
  /** Stored image path, or null when the product has no photograph. */
  imageUrl: string | null;
  sizes: string[];
  /** Lowest price a reader can actually buy at, sale applied. Sen. */
  price: number;
  /** That same variant's undiscounted price — differs only during a sale. */
  regularPrice: number;
  /** True when the sizes are not all one price, so the card says "from". */
  priceVaries: boolean;
  stock: number;
}

/** Why the recipient is on the list, for the line above the unsubscribe link. */
export const UNSUBSCRIBE_REASON_ORDER = "You're receiving this because you've ordered from Ascend MY.";

export function unsubscribeReasonFor(source: string): string {
  return source === 'ORDER' ? UNSUBSCRIBE_REASON_ORDER : UNSUBSCRIBE_REASON_SIGNUP;
}

/**
 * Read the featured products, in the order the admin picked them.
 *
 * Inactive products and products with no active variant are dropped rather
 * than shown: a card linking to a page that 404s, or to a product with nothing
 * to add to cart, is worse than one card fewer. The price quoted is the
 * cheapest variant that is IN STOCK — "from RM 135" where the RM 135 size is
 * sold out is the classic bait the reader resents — falling back to all sizes
 * only when every one is sold out.
 */
export async function loadCampaignProducts(prisma: PrismaLike, ids: string[] | undefined): Promise<CampaignProduct[]> {
  if (!ids?.length) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, active: true },
    include: {
      variants: { where: { active: true }, orderBy: { price: 'asc' } },
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  });

  const now = new Date();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: CampaignProduct[] = [];

  for (const id of ids) {
    const p = byId.get(id);
    if (!p || p.variants.length === 0) continue;

    const inStock = p.variants.filter((v) => v.stock > 0);
    const pool = inStock.length ? inStock : p.variants;
    const cheapest = pool.reduce((a, b) => (getEffectivePrice(b, now) < getEffectivePrice(a, now) ? b : a));
    const prices = new Set(pool.map((v) => getEffectivePrice(v, now)));

    out.push({
      id: p.id,
      name: p.name,
      slug: p.slug,
      // The photo of the size being quoted — its label names that size, and a
      // card reading "RM 170" over a 3mL vial that is sold out is a mismatch.
      imageUrl: cheapest.imageUrl ?? p.images[0]?.url ?? p.variants.find((v) => v.imageUrl)?.imageUrl ?? null,
      sizes: [...new Set(p.variants.map((v) => v.size).filter((s): s is string => Boolean(s)))],
      price: getEffectivePrice(cheapest, now),
      regularPrice: isSaleActive(cheapest, now) ? cheapest.price : getEffectivePrice(cheapest, now),
      priceVaries: prices.size > 1,
      stock: p.variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function campaignTag(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'campaign'
  );
}

/**
 * Tag links to our own site so a campaign's orders are attributable in
 * analytics. Links elsewhere, and links the admin already tagged by hand, are
 * left exactly as typed.
 */
function tagUrl(url: string, tag: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)ascendpeptides\.my$/.test(u.hostname) || u.searchParams.has('utm_source')) return url;
    u.searchParams.set('utm_source', 'newsletter');
    u.searchParams.set('utm_medium', 'email');
    u.searchParams.set('utm_campaign', tag);
    return u.toString();
  } catch {
    return url;
  }
}

const productUrl = (p: CampaignProduct, tag: string) => tagUrl(`${SITE_URL}/products/${p.slug}`, tag);

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** "RM 135", or "RM 137.50" — a whole-ringgit price with ".00" on it reads as
 *  a receipt, not a shop. */
function rm(sen: number): string {
  return sen % 100 === 0 ? `RM ${sen / 100}` : `RM ${(sen / 100).toFixed(2)}`;
}

function priceHtml(p: CampaignProduct, size: number): string {
  const from = p.priceVaries ? `<span class="muted" style="font-size:${size - 4}px;font-weight:400;color:${MUTED};">from </span>` : '';
  const was =
    p.regularPrice > p.price
      ? ` <span class="muted" style="font-size:${size - 3}px;font-weight:400;color:${MUTED};text-decoration:line-through;">${rm(p.regularPrice)}</span>`
      : '';
  return `${from}${rm(p.price)}${was}`;
}

/**
 * Stock status, worded from the real number. Green means available — the one
 * meaning the brand gives it — so a sold-out product gets no dot at all rather
 * than a red one shouting from a marketing email.
 */
function stockHtml(p: CampaignProduct): string {
  if (p.stock <= 0) {
    return `<span class="muted" style="color:${MUTED};">Sold out</span>`;
  }
  const label = p.stock <= 5 ? `Only ${p.stock} left` : 'In stock';
  return `<span style="color:${ACCENT};">&#9679;</span>&nbsp;<span class="ink" style="color:${INK};">${label}</span>`;
}

/**
 * Stand-in for a product with no photograph: the vial label, set in type on
 * the hero's black. Deliberately not a grey box with an icon — a featured
 * product (the newest one, often, which is exactly the one without a photo
 * yet) should still look like it was meant to be there.
 */
function labelTile(p: CampaignProduct, nameSize: number, padY: number): string {
  const size = p.sizes.length === 1 ? p.sizes[0] : p.sizes.length > 1 ? `${p.sizes.length} sizes` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td align="center" bgcolor="${HERO_BG}" style="background-color:${HERO_BG} !important;padding:${padY}px 16px;border-radius:inherit;">
                <p style="margin:0;font-family:${FONT};font-size:9px;font-weight:700;letter-spacing:0.14em;color:${HERO_META} !important;">FOR RESEARCH PURPOSES ONLY</p>
                <p style="margin:10px 0 0;font-family:${FONT};font-size:${nameSize}px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:#ffffff !important;">${escapeHtml(p.name)}</p>${
                  size
                    ? `\n                <p style="margin:8px 0 0;font-family:${FONT};font-size:12px;color:${HERO_META} !important;">${escapeHtml(size)}</p>`
                    : ''
                }
              </td>
            </tr></table>`;
}

function spotlight(p: CampaignProduct, tag: string): string {
  const href = escapeHtml(productUrl(p, tag));
  const card = emailCardUrl(p.imageUrl);
  const picture = card
    ? `<a href="${href}" style="display:block;"><img src="${escapeHtml(card)}" width="528" alt="${escapeHtml(p.name)}" style="display:block;width:100%;max-width:528px;height:auto;border-radius:14px 14px 0 0;"></a>`
    : `<a href="${href}" style="display:block;text-decoration:none;">${labelTile(p, 30, 64)}</a>`;
  const sizes = p.sizes.map(escapeHtml).join(' &middot; ');

  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f2f2f4" class="tile" style="margin:10px 0 0;background-color:#f2f2f4;border-radius:14px;">
            <tr><td style="font-size:0;line-height:0;border-radius:14px 14px 0 0;overflow:hidden;">${picture}</td></tr>
            <tr>
              <td style="padding:20px 24px 24px;">
                <p style="margin:0;font-family:${FONT};font-size:12px;font-weight:600;">${stockHtml(p)}</p>
                <p style="margin:6px 0 0;font-family:${FONT};font-size:23px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;"><a href="${href}" class="ink" style="color:${INK};text-decoration:none;">${escapeHtml(p.name)}</a></p>${
                  sizes
                    ? `\n                <p class="muted" style="margin:4px 0 0;font-family:${FONT};font-size:13px;color:${MUTED};">${sizes}</p>`
                    : ''
                }
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
                  <tr>
                    <td valign="middle" class="ink" style="font-family:${FONT};font-size:19px;font-weight:700;color:${INK};white-space:nowrap;">${priceHtml(p, 19)}</td>
                    <td valign="middle" align="right">${renderButton('SHOP NOW', productUrl(p, tag))}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>`;
}

/** The picture half of a grid card: the photo, or the label tile on black. */
function gridPicture(p: CampaignProduct, tag: string): string {
  const href = escapeHtml(productUrl(p, tag));
  const card = emailCardUrl(p.imageUrl);
  if (card) {
    return `<td width="48%" valign="top" bgcolor="#f2f2f4" class="tile" style="width:48%;background-color:#f2f2f4;border-radius:12px 12px 0 0;font-size:0;line-height:0;"><a href="${href}" style="display:block;"><img src="${escapeHtml(card)}" width="258" alt="${escapeHtml(p.name)}" style="display:block;width:100%;max-width:258px;height:auto;border-radius:12px 12px 0 0;"></a></td>`;
  }
  const size = p.sizes.length === 1 ? p.sizes[0] : p.sizes.length > 1 ? `${p.sizes.length} sizes` : '';
  return `<td width="48%" valign="middle" align="center" bgcolor="${HERO_BG}" style="width:48%;background-color:${HERO_BG} !important;border-radius:12px 12px 0 0;padding:18px 12px;">
                <a href="${href}" style="text-decoration:none;display:block;">
                  <span style="display:block;font-family:${FONT};font-size:8px;font-weight:700;letter-spacing:0.14em;color:${HERO_META} !important;">FOR RESEARCH PURPOSES ONLY</span>
                  <span style="display:block;margin-top:8px;font-family:${FONT};font-size:17px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:#ffffff !important;">${escapeHtml(p.name)}</span>${
                    size ? `
                  <span style="display:block;margin-top:6px;font-family:${FONT};font-size:11px;color:${HERO_META} !important;">${escapeHtml(size)}</span>` : ''
                  }
                </a>
              </td>`;
}

/** The text half of a grid card: name, price, stock. */
function gridDetails(p: CampaignProduct, tag: string): string {
  const href = escapeHtml(productUrl(p, tag));
  return `<td width="48%" valign="top" bgcolor="#f2f2f4" class="tile" style="width:48%;background-color:#f2f2f4;border-radius:0 0 12px 12px;padding:12px 14px 14px;font-family:${FONT};">
                <p style="margin:0;font-size:14px;line-height:1.3;font-weight:700;"><a href="${href}" class="ink" style="color:${INK};text-decoration:none;">${escapeHtml(p.name)}</a></p>
                <p class="ink" style="margin:5px 0 0;font-size:13px;font-weight:700;color:${INK};">${priceHtml(p, 13)}</p>
                <p style="margin:6px 0 0;font-size:11px;font-weight:600;">${stockHtml(p)}</p>
              </td>`;
}

// 48 + 4 + 48. A fixed-pixel gutter between two 50% halves is the one cell
// a browser is allowed to squeeze, and it squeezed it to nothing.
const EMPTY_HALF = '<td width="48%" style="width:48%;">&nbsp;</td>';
const GUTTER = '<td width="4%" style="width:4%;font-size:0;line-height:0;">&nbsp;</td>';

/**
 * Two-up grid as a plain fixed table, 50/50, that never stacks.
 *
 * The usual "hybrid" stacking columns lean on a media query, and the Gmail
 * app strips <style> entirely for non-Google accounts — there it would stay
 * two-up anyway, at whatever width it landed on. Designing the two-up for a
 * 320px phone (each card ~140px) is the version that holds everywhere,
 * Outlook's Word engine included.
 *
 * Each pair is two table rows — pictures, then details — rather than two
 * self-contained cards side by side. A table row is the one layout tool every
 * client honours for "make these the same height": a product with no photo
 * gets its label tile stretched to exactly the photo's height next to it, at
 * any width, with no fixed pixel heights to fall out of step on a phone.
 */
function grid(products: CampaignProduct[], tag: string): string {
  const rows: string[] = [];
  for (let i = 0; i < products.length; i += 2) {
    const [a, b] = [products[i], products[i + 1]];
    if (i > 0) rows.push(`
            <tr><td colspan="3" height="12" style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
    rows.push(`
            <tr>
              ${gridPicture(a, tag)}
              ${GUTTER}
              ${b ? gridPicture(b, tag) : EMPTY_HALF}
            </tr>
            <tr>
              ${gridDetails(a, tag)}
              ${GUTTER}
              ${b ? gridDetails(b, tag) : EMPTY_HALF}
            </tr>`);
  }
  return `
          <p class="eyebrow muted" style="margin:34px 0 14px;padding-bottom:12px;border-bottom:2px solid ${INK};font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">MORE PICKS</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}
          </table>`;
}

/**
 * Turn the admin's plain-text body into email-safe paragraphs.
 *
 * Escaped first, then split on blank lines — so an admin can write normally
 * (and paste an ampersand, a quote, or an angle bracket) with no way to inject
 * markup into a bulk send. Single newlines inside a paragraph become <br>,
 * matching how the storefront renders Insight.content with `whitespace-pre-
 * line`, so what an admin sees in the textarea is what arrives.
 */
function renderBody(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p class="body-text" style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BODY};">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`
    )
    .join('');
}

/**
 * Derive the inbox preview line when the admin left it blank. Better than
 * shipping an empty preheader, which makes clients fall back to whatever text
 * happens to start the body — usually a stray fragment mid-sentence.
 */
function derivePreheader(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat;
}

function renderText(
  campaign: CampaignContent,
  products: CampaignProduct[],
  tag: string,
  ctaUrl: string | null,
  unsubscribeUrl: string,
  reason: string,
  disclaimer: string
): string {
  const lines: string[] = [];
  lines.push(campaign.headline?.trim() || campaign.subject);
  if (campaign.subhead?.trim()) lines.push(campaign.subhead.trim());
  lines.push('', campaign.body.trim(), '');
  for (const p of products) {
    const stock = p.stock <= 0 ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock';
    lines.push(`${p.name}: ${p.priceVaries ? 'from ' : ''}${rm(p.price)} (${stock})`, productUrl(p, tag), '');
  }
  if (campaign.ctaLabel && ctaUrl) lines.push(`${campaign.ctaLabel}: ${ctaUrl}`, '');
  lines.push('--', disclaimer, reason, `Unsubscribe: ${unsubscribeUrl}`);
  return lines.join('\n');
}

export interface RenderCampaignOptions {
  unsubscribeUrl: string;
  settings: Record<string, string>;
  products?: CampaignProduct[];
  /** Line above the unsubscribe link; see unsubscribeReasonFor(). */
  reason?: string;
}

export function renderCampaign(
  campaign: CampaignContent,
  o: RenderCampaignOptions
): { subject: string; html: string; text: string } {
  const tag = campaignTag(campaign.name);
  const products = o.products ?? [];
  const reason = o.reason ?? UNSUBSCRIBE_REASON_SIGNUP;

  // A CTA needs both halves to render. A label with no URL is not a link, and
  // a URL with no label is a button nobody can read — either way the safe
  // outcome is no button, not a broken one in every inbox.
  const ctaUrl = campaign.ctaLabel && campaign.ctaUrl ? tagUrl(campaign.ctaUrl, tag) : null;
  const cta = ctaUrl
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:${products.length ? '22px' : '8px'} 0 0;">
            <tr><td align="${products.length ? 'center' : 'left'}">${renderButton(escapeHtml(campaign.ctaLabel!).toUpperCase(), ctaUrl)}</td></tr>
          </table>`
    : '';

  const [first, ...rest] = products;
  const body = `${renderBody(campaign.body)}${first ? spotlight(first, tag) : ''}${rest.length ? grid(rest, tag) : ''}${cta}`;

  const headline = campaign.headline?.trim() || campaign.subject;
  const disclaimer = o.settings.receipt_footer_note || 'All products are for research and laboratory use only.';

  return {
    subject: campaign.subject,
    html: renderLayout({
      hero: {
        badge: campaign.badge?.trim() ? { label: campaign.badge.trim().toUpperCase(), tone: 'success' } : undefined,
        headline: escapeHtml(headline),
        subhead: campaign.subhead?.trim() ? escapeHtml(campaign.subhead.trim()) : undefined,
      },
      body,
      preheader: campaign.preheader?.trim() || derivePreheader(campaign.body),
      settings: o.settings,
      unsubscribeUrl: o.unsubscribeUrl,
      unsubscribeReason: reason,
      // With products on show, the purity/testing/shipping strip is the
      // reassurance a buyer looks for next. A text-only broadcast keeps it
      // off — there it would read as a pitch bolted onto a note.
      trust: products.length > 0,
    }),
    text: renderText(campaign, products, tag, ctaUrl, o.unsubscribeUrl, reason, disclaimer),
  };
}
