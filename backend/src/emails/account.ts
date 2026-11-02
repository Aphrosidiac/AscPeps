import { renderLayout, renderButton, escapeHtml, FONT, MONO, INK, BODY, MUTED } from './layout.js';

/**
 * Account-security mails: forgot password, confirm a new address, and the
 * heads-up to the old address when it changes. Sent directly like the verify
 * mail (no order, so no EmailOutbox row), and every one is recoverable by the
 * member asking again.
 */

function paragraph(html: string, last = false): string {
  return `
          <p class="body-text" style="margin:0 0 ${last ? 0 : 24}px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BODY};">
            ${html}
          </p>`;
}

function footnote(html: string): string {
  return `
          <p class="muted" style="margin:26px 0 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
            ${html}
          </p>`;
}

export function renderResetPasswordEmail(
  displayName: string,
  resetUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const body = `${paragraph('Someone asked to reset the password on your Ascend MY account. Choose a new one with the button below.')}
${renderButton('RESET PASSWORD', resetUrl)}
${footnote("This link expires in 1 hour and works once. If you didn't ask for it, ignore this email — your password stays as it is.")}`;

  return {
    subject: 'Reset your password — Ascend MY',
    html: renderLayout({
      hero: { headline: `Hi ${escapeHtml(displayName)},`, subhead: 'reset your password.' },
      body,
      preheader: 'Choose a new password — the link expires in 1 hour.',
      settings,
      trust: false,
    }),
  };
}

export function renderConfirmNewEmail(
  displayName: string,
  newEmail: string,
  confirmUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const body = `${paragraph(`Confirm <strong>${escapeHtml(newEmail)}</strong> as the new email on your Ascend MY account. Until you do, your account keeps using the old one.`)}
${renderButton('CONFIRM NEW EMAIL', confirmUrl)}
${footnote("This link expires in 24 hours. If you didn't ask for this change, ignore this email — nothing will happen.")}`;

  return {
    subject: 'Confirm your new email — Ascend MY',
    html: renderLayout({
      hero: { headline: `Hi ${escapeHtml(displayName)},`, subhead: 'confirm your new email.' },
      body,
      preheader: 'One click to switch your account to this address.',
      settings,
      trust: false,
    }),
  };
}

export function renderEmailChangedNotice(
  displayName: string,
  newEmail: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const body = `${paragraph(`The email on your Ascend MY account is now <strong>${escapeHtml(newEmail)}</strong>. You'll sign in with it from now on.`)}
${footnote("Didn't make this change? Contact us right away so we can secure your account.")}`;

  return {
    subject: 'Your account email changed — Ascend MY',
    html: renderLayout({
      hero: { headline: `Hi ${escapeHtml(displayName)},`, subhead: 'your email changed.' },
      body,
      preheader: `Your account now uses ${newEmail}.`,
      settings,
      trust: false,
    }),
  };
}

/**
 * The sign-up bonus, sent the moment the email is confirmed and the code is
 * minted: the popup promised it, so it should not wait for them to find their
 * account page. Same dashed box as the welcome code.
 */
export function renderSignupBonusEmail(
  displayName: string,
  code: string,
  percent: number,
  shopUrl: string,
  settings: Record<string, string>
): { subject: string; html: string } {
  const body = `${paragraph(`Your email is confirmed, so here is the one-time code we promised. Use it at checkout on your first order.`)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
            <tr>
              <td align="center" class="code-box" style="padding:22px 16px;border:1px dashed ${INK};border-radius:10px;">
                <p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">${percent}% OFF YOUR FIRST ORDER</p>
                <p class="ink" style="margin:0;font-family:${MONO};font-size:26px;font-weight:700;letter-spacing:3px;color:${INK};">${escapeHtml(code)}</p>
                <p class="muted" style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">One use, at checkout with this email address.</p>
              </td>
            </tr>
          </table>
${renderButton('START SHOPPING', shopUrl)}
${footnote('Signed in at checkout, the code is offered to you there — no need to copy it. It also shows on your account page until it is used.')}`;

  return {
    subject: `Your ${percent}% first-order code — Ascend MY`,
    html: renderLayout({
      hero: { headline: `Hi ${escapeHtml(displayName)},`, subhead: `${percent}% off your first order.` },
      body,
      preheader: `${code} — ${percent}% off your first order.`,
      settings,
      trust: false,
    }),
  };
}
