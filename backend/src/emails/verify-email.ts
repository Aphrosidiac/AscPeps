import { renderLayout, renderButton, escapeHtml } from './layout.js';

const SUBJECT = 'Confirm your email — ASCEND Peptides';

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
          <p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0A0A0A;">
            Hi ${name},
          </p>
          <p style="margin:0 0 24px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#54565b;">
            Confirm this address to finish setting up your ASCEND account. Once confirmed you'll be able to comment on Insights articles.
          </p>
${renderButton('CONFIRM EMAIL', verifyUrl)}
          <p style="margin:26px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#9a9a9e;">
            This link expires in 24 hours. If you didn't create an ASCEND account, you can ignore this email — nothing will happen.
          </p>`;

  return {
    subject: SUBJECT,
    html: renderLayout(body, 'Confirm your email to finish setting up your ASCEND account.', settings),
  };
}
