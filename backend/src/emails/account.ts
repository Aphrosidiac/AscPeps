import { renderLayout, paragraph, button, note, codeBox, escapeHtml } from './layout.js';

/**
 * Account-security mails: forgot password, confirm a new address, the heads-up
 * to the old address, and the sign-up bonus code. Sent directly (no order, so
 * no EmailOutbox row); each one the member can ask for again.
 */

const hi = (name: string) => paragraph(`Hi ${escapeHtml(name)},`);

export function renderResetPasswordEmail(
  displayName: string,
  resetUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  return {
    subject: 'Reset your password — Ascend MY',
    html: renderLayout({
      headline: 'Reset your password',
      body: `${hi(displayName)}${paragraph('We got a request to reset the password on your Ascend MY account. Choose a new one with the button below.', { mb: 8 })}${button('Reset password', resetUrl)}${note(
        "This link expires in 1 hour and works once. If you didn't ask for it, ignore this email and your password stays as it is.",
        24
      )}`,
      preheader: 'Choose a new password. The link expires in 1 hour.',
      settings,
    }),
  };
}

export function renderConfirmNewEmail(
  displayName: string,
  newEmail: string,
  confirmUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  return {
    subject: 'Confirm your new email — Ascend MY',
    html: renderLayout({
      headline: 'Confirm your new email',
      body: `${hi(displayName)}${paragraph(
        `Confirm <strong>${escapeHtml(newEmail)}</strong> as the new email on your Ascend MY account. Until you do, your account keeps using the old one.`,
        { mb: 8 }
      )}${button('Confirm new email', confirmUrl)}${note(
        "This link expires in 24 hours. If you didn't ask for this change, ignore this email and nothing will happen.",
        24
      )}`,
      preheader: 'One click to switch your account to this address.',
      settings,
    }),
  };
}

export function renderEmailChangedNotice(
  displayName: string,
  newEmail: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  return {
    subject: 'Your account email changed — Ascend MY',
    html: renderLayout({
      headline: 'Your account email changed',
      body: `${hi(displayName)}${paragraph(
        `The email on your Ascend MY account is now <strong>${escapeHtml(newEmail)}</strong>. You&#39;ll sign in with it from now on.`,
        { mb: 0 }
      )}${note("Didn't make this change? Contact us right away so we can secure your account.", 24)}`,
      preheader: `Your account now uses ${newEmail}.`,
      settings,
    }),
  };
}

/** The sign-up bonus, sent the moment the email is confirmed and the code exists. */
export function renderSignupBonusEmail(
  displayName: string,
  code: string,
  percent: number,
  shopUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  return {
    subject: `Your ${percent}% first-order code — Ascend MY`,
    html: renderLayout({
      headline: `${percent}% off your first order`,
      body: `${hi(displayName)}${paragraph('Your email is confirmed, so here is the code we promised. Use it at checkout on your first order.', { mb: 20 })}${codeBox(
        `${percent}% off your first order`,
        code,
        'One use, at checkout with this email address.'
      )}${button('Start shopping', shopUrl, { mt: 0 })}${note(
        "Signed in at checkout, the code is offered to you there, so there's no need to copy it. It also shows on your account page until it's used.",
        24
      )}`,
      preheader: `${code}: ${percent}% off your first order.`,
      settings,
    }),
  };
}
