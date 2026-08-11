import { renderLayout, renderButton, escapeHtml, FONT, BODY } from './layout.js';

export interface CampaignContent {
  subject: string;
  preheader: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
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
        `<p class="body-text" style="margin:0 0 18px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">${escapeHtml(para).replace(/\n/g, '<br>')}</p>`
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

export function renderCampaign(
  campaign: CampaignContent,
  unsubscribeUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  // A CTA needs both halves to render. A label with no URL is not a link, and
  // a URL with no label is a button nobody can read — either way the safe
  // outcome is a body-only email, not a broken button in a few thousand
  // inboxes.
  const cta =
    campaign.ctaLabel && campaign.ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
            <tr><td>${renderButton(escapeHtml(campaign.ctaLabel).toUpperCase(), campaign.ctaUrl)}</td></tr>
          </table>`
      : '';

  // The subject already carries the headline, and the hero now renders it — a
  // second copy as the first body paragraph read as a duplicated title.
  const body = `${renderBody(campaign.body)}${cta}`;

  return {
    subject: campaign.subject,
    html: renderLayout({
      hero: { headline: escapeHtml(campaign.subject) },
      body,
      preheader: campaign.preheader?.trim() || derivePreheader(campaign.body),
      settings,
      unsubscribeUrl,
      // A broadcast is the one place the trust strip would read as a sales
      // pitch bolted onto the end rather than reassurance about an order.
      trust: false,
    }),
  };
}
