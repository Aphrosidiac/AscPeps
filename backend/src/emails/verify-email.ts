import { renderLayout, renderButton, escapeHtml, FONT, BODY, MUTED } from './layout.js';

const SUBJECT = 'Confirm your email — Ascend Peptides';

/**
 * One-off account-confirmation email. Unlike the order mails this is NOT
 * queued through EmailOutbox: that table is keyed to an order (orderId is a
 * required FK), and a signup has no order. A failed send here is recoverable
 * by the member themselves via "resend confirmation", so the delivery
 * guarantee the outbox provides isn't needed.
 */
export function renderVerifyEmail(
  displayName: string,
  verifyUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const name = escapeHtml(displayName);

  const body = `
          <p class="body-text" style="margin:0 0 24px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            Confirm this address to finish setting up your Ascend MY account. Once confirmed you'll be able to comment on Insights articles.
          </p>
${renderButton('CONFIRM EMAIL', verifyUrl)}
          <p class="muted" style="margin:26px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            This link expires in 24 hours. If you didn't create an Ascend MY account, you can ignore this email — nothing will happen.
          </p>`;

  return {
    subject: SUBJECT,
    html: renderLayout({
      hero: { headline: `Hi ${name},`, subhead: 'confirm your email.' },
      body,
      preheader: 'Confirm your email to finish setting up your Ascend MY account.',
      settings,
      // Purity and shipping claims have no business on an account-confirmation
      // mail — nothing has been bought.
      trust: false,
    }),
  };
}
