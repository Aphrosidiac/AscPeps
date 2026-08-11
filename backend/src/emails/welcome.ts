import { renderLayout, renderButton, escapeHtml, formatDate, SITE_URL, FONT, MONO, INK, BODY, MUTED, BORDER } from './layout.js';

const SUBJECT_WITH_CODE = 'Welcome to Ascend MY — your reference links and first-order code';
const SUBJECT_PLAIN = 'Welcome to Ascend MY — your reference links';

export interface WelcomeDiscount {
  code: string;
  percent: number;
  expiresAt: Date;
  minOrderAmount: number | null;
}

// The three things a new researcher actually needs, in the order they need
// them. Deliberately not a product pitch: the popup promised a reference, so
// the email opens with the reference. The shop link is the CTA at the end.
const RESOURCES: { label: string; blurb: string; path: string }[] = [
  {
    label: 'Reconstitution calculator',
    blurb: 'Work out BAC water volume and units per dose for any vial size.',
    path: '/calculator',
  },
  {
    label: 'Peptide guide',
    blurb: 'Storage, handling and half-life reference for every compound we carry.',
    path: '/guide',
  },
  {
    label: 'Certificates of analysis',
    blurb: 'Third-party HPLC and MS results, published per batch.',
    path: '/coa',
  },
];

function renderResources(): string {
  return RESOURCES.map(
    (r) => `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
            <tr>
              <td class="border-b" style="padding:0 0 14px;border-bottom:1px solid ${BORDER};">
                <a href="${SITE_URL}${r.path}" class="ink" style="font-family:${FONT};font-size:14px;font-weight:600;color:${INK} !important;text-decoration:none;">${r.label} &rarr;</a>
                <p class="body-text" style="margin:4px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${BODY};">${r.blurb}</p>
              </td>
            </tr>
          </table>`
  ).join('');
}

// Dashed box + oversized monospace code. The code is the one thing in this
// email that gets retyped, so it is the one thing given its own container,
// letter-spacing and selectable plain text — no image, no button, nothing a
// mail client can strip and leave the reader with nothing to copy.
function renderCodeBlock(d: WelcomeDiscount): string {
  const minLine =
    d.minOrderAmount && d.minOrderAmount > 0
      ? `<br>On orders over RM ${(d.minOrderAmount / 100).toFixed(2)}.`
      : '';
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;">
            <tr>
              <td align="center" class="code-box" style="padding:22px 16px;border:1px dashed ${INK};border-radius:10px;">
                <p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">${d.percent}% OFF YOUR FIRST ORDER</p>
                <p class="ink" style="margin:0;font-family:${MONO};font-size:26px;font-weight:700;letter-spacing:3px;color:${INK};">${escapeHtml(d.code)}</p>
                <p class="muted" style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">
                  Single use, tied to this address. Valid until ${formatDate(d.expiresAt)}.${minLine}
                </p>
              </td>
            </tr>
          </table>`;
}

/**
 * The one email everybody on the list is guaranteed to get, so it carries the
 * whole promise the signup form made: the reference links first, the
 * first-order code second.
 *
 * `discount` is optional because welcome discounts are switchable off
 * (welcome_discount_percent = 0). When it's absent the email still stands on
 * its own — the resources ARE the value — rather than reading like a coupon
 * mail with the coupon missing.
 */
export function renderWelcome(
  discount: WelcomeDiscount | null,
  unsubscribeUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const body = `
          <p class="body-text" style="margin:0 0 26px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            You'll hear from us when a compound is back in stock, when new batch COAs are published, and when we put out something worth reading. Not often, and never without something in it.
          </p>
          <p class="eyebrow muted" style="margin:0 0 14px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">START HERE</p>
${renderResources()}${discount ? renderCodeBlock(discount) : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;">
            <tr><td>${renderButton('BROWSE THE CATALOG', `${SITE_URL}/products`)}</td></tr>
          </table>
          <p class="muted" style="margin:26px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            All products are supplied strictly for laboratory and research use.
          </p>`;

  return {
    subject: discount ? SUBJECT_WITH_CODE : SUBJECT_PLAIN,
    html: renderLayout({
      hero: {
        headline: "You're on the list.",
        subhead: discount ? 'Here’s where to start.' : 'Here’s the reference material.',
      },
      body,
      preheader: discount
        ? `Your reconstitution reference, batch COAs, and ${discount.percent}% off your first order.`
        : 'Your reconstitution reference, the peptide guide, and batch COAs.',
      settings,
      unsubscribeUrl,
    }),
  };
}
