import type { PrismaClient, Prisma } from '@prisma/client';
import {
  renderLayout,
  button,
  heading,
  escapeHtml,
  emailCardUrl,
  SITE_URL,
  UNSUBSCRIBE_REASON_SIGNUP,
  FONT,
  DISPLAY,
  TEXT,
  INK,
  MUTED,
  PANEL,
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

/** "RM 135", or "RM 137.50". */
function rm(sen: number): string {
  return sen % 100 === 0 ? `RM ${sen / 100}` : `RM ${(sen / 100).toFixed(2)}`;
}

function priceHtml(p: CampaignProduct): string {
  const from = p.priceVaries ? `<span style="font-weight:400;color:${MUTED};">From </span>` : '';
  const was = p.regularPrice > p.price ? ` <span style="font-weight:400;color:${MUTED};text-decoration:line-through;">${rm(p.regularPrice)}</span>` : '';
  return `${from}${rm(p.price)}${was}`;
}

/** Worded from the real stock number; plain text, no traffic-light dots. */
function stockText(p: CampaignProduct): string {
  return p.stock <= 0 ? 'Sold out' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock';
}

const sizeText = (p: CampaignProduct) => (p.sizes.length === 1 ? p.sizes[0] : p.sizes.length > 1 ? `${p.sizes.length} sizes` : '');

/** Stand-in for a product with no photograph: its name set in type on ink. */
function labelTile(p: CampaignProduct, nameSize: number, padY: number, radius: string): string {
  const size = sizeText(p);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td align="center" valign="middle" bgcolor="${INK}" style="background-color:${INK};padding:${padY}px 16px;border-radius:${radius};">
                <p style="margin:0;font-family:${DISPLAY};font-size:${nameSize}px;line-height:1.15;font-weight:600;letter-spacing:-0.02em;color:#ffffff;">${escapeHtml(p.name)}</p>${
                  size ? `\n                <p style="margin:8px 0 0;font-family:${FONT};font-size:13px;color:#A3A3A3;">${escapeHtml(size)}</p>` : ''
                }
              </td>
            </tr></table>`;
}

function spotlight(p: CampaignProduct, tag: string): string {
  const href = escapeHtml(productUrl(p, tag));
  const card = emailCardUrl(p.imageUrl);
  const picture = card
    ? `<a href="${href}" target="_blank" style="display:block;"><img src="${escapeHtml(card)}" width="520" alt="${escapeHtml(p.name)}" style="display:block;width:100%;max-width:520px;height:auto;border-radius:10px;background-color:${PANEL};"></a>`
    : `<a href="${href}" target="_blank" style="display:block;text-decoration:none;">${labelTile(p, 30, 72, '10px')}</a>`;
  const sub = [p.sizes.map(escapeHtml).join(' &middot; '), stockText(p)].filter(Boolean).join(' &middot; ');

  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;">
            <tr><td style="font-size:0;line-height:0;">${picture}</td></tr>
            <tr>
              <td style="padding:16px 0 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="top" style="font-family:${FONT};">
                      <p style="margin:0;font-family:${DISPLAY};font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;"><a href="${href}" target="_blank" style="color:${INK};text-decoration:none;">${escapeHtml(p.name)}</a></p>
                      <p style="margin:4px 0 0;font-size:14px;line-height:1.5;color:${MUTED};">${sub}</p>
                      <p style="margin:6px 0 0;font-size:16px;line-height:1.5;font-weight:600;color:${INK};">${priceHtml(p)}</p>
                    </td>
                    <td valign="bottom" align="right" width="1" style="padding-left:12px;">${button('Shop now', productUrl(p, tag), { mt: 0 })}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>`;
}

/** The picture half of a grid card: the photo, or the label tile. */
function gridPicture(p: CampaignProduct, tag: string): string {
  const href = escapeHtml(productUrl(p, tag));
  const card = emailCardUrl(p.imageUrl);
  if (card) {
    return `<td width="48%" valign="top" style="width:48%;font-size:0;line-height:0;"><a href="${href}" target="_blank" style="display:block;"><img src="${escapeHtml(card)}" width="250" alt="${escapeHtml(p.name)}" style="display:block;width:100%;max-width:250px;height:auto;border-radius:10px;background-color:${PANEL};"></a></td>`;
  }
  const size = sizeText(p);
  return `<td width="48%" valign="middle" align="center" bgcolor="${INK}" style="width:48%;background-color:${INK};border-radius:10px;padding:18px 12px;">
                <a href="${href}" target="_blank" style="text-decoration:none;display:block;">
                  <span style="display:block;font-family:${DISPLAY};font-size:17px;line-height:1.15;font-weight:600;letter-spacing:-0.02em;color:#ffffff;">${escapeHtml(p.name)}</span>${
                    size ? `
                  <span style="display:block;margin-top:6px;font-family:${FONT};font-size:12px;color:#A3A3A3;">${escapeHtml(size)}</span>` : ''
                  }
                </a>
              </td>`;
}

/** The text half of a grid card: name, price, stock. */
function gridDetails(p: CampaignProduct, tag: string): string {
  const href = escapeHtml(productUrl(p, tag));
  return `<td width="48%" valign="top" style="width:48%;padding:10px 0 0;font-family:${FONT};">
                <p style="margin:0;font-size:15px;line-height:1.35;font-weight:600;"><a href="${href}" target="_blank" style="color:${INK};text-decoration:none;">${escapeHtml(p.name)}</a></p>
                <p style="margin:3px 0 0;font-size:14px;line-height:1.4;color:${INK};">${priceHtml(p)}</p>
                <p style="margin:2px 0 0;font-size:13px;line-height:1.4;color:${MUTED};">${stockText(p)}</p>
              </td>`;
}

const EMPTY_HALF = '<td width="48%" style="width:48%;">&nbsp;</td>';
const GUTTER = '<td width="4%" style="width:4%;font-size:0;line-height:0;">&nbsp;</td>';

/**
 * Two-up grid that never stacks (the Gmail app drops media queries for
 * non-Google accounts, so it has to hold at 320px anyway). Each pair is two
 * rows, pictures then details, so a label tile stretches to its neighbour's
 * photo height.
 */
function grid(products: CampaignProduct[], tag: string): string {
  const rows: string[] = [];
  for (let i = 0; i < products.length; i += 2) {
    const [a, b] = [products[i], products[i + 1]];
    if (i > 0) rows.push(`
            <tr><td colspan="3" height="24" style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
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
  return `${heading('More picks', 40)}
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
        `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`
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
  const cta = ctaUrl ? button(escapeHtml(campaign.ctaLabel!), ctaUrl, { mt: products.length ? 32 : 8 }) : '';

  const [first, ...rest] = products;
  const body = `${renderBody(campaign.body)}${first ? spotlight(first, tag) : ''}${rest.length ? grid(rest, tag) : ''}${cta}`;

  const headline = campaign.headline?.trim() || campaign.subject;
  const disclaimer = o.settings.receipt_footer_note || 'All products are for research and laboratory use only.';

  return {
    subject: campaign.subject,
    html: renderLayout({
      eyebrow: campaign.badge?.trim() ? escapeHtml(campaign.badge.trim()) : undefined,
      headline: escapeHtml(headline),
      body: `${campaign.subhead?.trim() ? `
          <p style="margin:-12px 0 24px;font-family:${FONT};font-size:17px;line-height:1.5;color:${MUTED};">${escapeHtml(campaign.subhead.trim())}</p>` : ''}${body}`,
      preheader: campaign.preheader?.trim() || derivePreheader(campaign.body),
      settings: o.settings,
      unsubscribeUrl: o.unsubscribeUrl,
      unsubscribeReason: reason,
    }),
    text: renderText(campaign, products, tag, ctaUrl, o.unsubscribeUrl, reason, disclaimer),
  };
}
