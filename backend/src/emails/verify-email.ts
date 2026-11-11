import { renderLayout, paragraph, button, note, escapeHtml } from './layout.js';

const SUBJECT = 'Confirm your email — Ascend MY';

/**
 * Account confirmation. Sent directly, not through EmailOutbox (that table
 * needs an order); a lost one is fixed by "resend confirmation".
 */
export function renderVerifyEmail(
  displayName: string,
  verifyUrl: string,
  settings: Record<string, string>,
  /** The sign-up bonus this confirmation unlocks, when there is one. */
  bonusPct: number | null = null
): { subject: string; html: string } {
  const bonus = bonusPct
    ? ` Confirming also unlocks your <strong>${bonusPct}% first-order code</strong>, which we&#39;ll email you straight away.`
    : '';

  return {
    subject: SUBJECT,
    html: renderLayout({
      headline: 'Confirm your email',
      body: `${paragraph(`Hi ${escapeHtml(displayName)},`)}${paragraph(
        `Confirm this address to finish setting up your Ascend MY account.${bonus}`,
        { mb: 8 }
      )}${button('Confirm email', verifyUrl)}${note(
        "This link expires in 24 hours. If you didn't create an Ascend MY account, you can ignore this email.",
        24
      )}`,
      preheader: 'Confirm your email to finish setting up your account. The link expires in 24 hours.',
      settings,
    }),
  };
}
