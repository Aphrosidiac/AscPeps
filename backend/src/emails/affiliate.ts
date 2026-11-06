import { renderLayout, renderButton, escapeHtml, formatRM, FONT, MONO, INK, BODY, MUTED, BORDER } from './layout.js';

/**
 * Ascend Affiliate mails: where their application stands, their payouts, and
 * the answer to a change of details. Sent directly like the account mails (no
 * order, so no EmailOutbox row) by utils/affiliate-mail.ts; every one restates
 * something the portal already shows, so a lost one costs nothing.
 */

export type AffiliateMail =
  | { kind: 'applied'; hasBank: boolean }
  | { kind: 'approved' }
  | { kind: 'rejected' }
  | { kind: 'paused' }
  | { kind: 'reactivated' }
  | { kind: 'payoutRequested'; amount: number; bankName: string; last4: string }
  | { kind: 'payoutPaid'; amount: number; asked: number; bankName: string; last4: string; reference: string | null; paidAt: Date }
  | { kind: 'payoutCancelled'; amount: number; reason: string }
  | { kind: 'changeApproved'; fields: string[] }
  | { kind: 'changeRejected'; fields: string[]; reason: string };

export interface AffiliateMailContext {
  name: string;
  code: string;
  /** "5%" — their commission. */
  rate: string;
  /** What the code takes off for the customer, in whole percent. */
  customerDiscountPct: number;
  /** The affiliate portal, and the store link with their code. */
  portalUrl: string;
  shareUrl: string;
}

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

// The code is what they retype into every post, so it gets the same dashed
// box as the welcome code: plain selectable text, nothing a client can strip.
function codeBlock(label: string, code: string, note: string): string {
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
            <tr>
              <td align="center" class="code-box" style="padding:22px 16px;border:1px dashed ${INK};border-radius:10px;">
                <p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">${label}</p>
                <p class="ink" style="margin:0;font-family:${MONO};font-size:26px;font-weight:700;letter-spacing:3px;color:${INK};">${escapeHtml(code)}</p>
                <p class="muted" style="margin:10px 0 0;font-family:${FONT};font-size:11px;line-height:1.6;color:${MUTED};">${note}</p>
              </td>
            </tr>
          </table>`;
}

// Label / value rows for a payout: the receipt part of the mail.
function facts(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([k, v], i) => `
            <tr>
              <td class="muted${i < rows.length - 1 ? ' border-b' : ''}" style="padding:11px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${BORDER};` : ''}font-family:${FONT};font-size:13px;color:${MUTED};">${k}</td>
              <td align="right" class="ink${i < rows.length - 1 ? ' border-b' : ''}" style="padding:11px 0;${i < rows.length - 1 ? `border-bottom:1px solid ${BORDER};` : ''}font-family:${FONT};font-size:13px;font-weight:600;color:${INK};">${v}</td>
            </tr>`
    )
    .join('');
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">${cells}
          </table>`;
}

// Malaysian time whatever the server runs in.
function when(d: Date, time = true): string {
  return d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'long', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });
}

// The team's reason in their words, set apart so it reads as theirs.
function reasonBlock(reason: string): string {
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr>
              <td class="code-box" style="padding:2px 0 2px 16px;border-left:3px solid ${INK};">
                <p class="muted" style="margin:0 0 4px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.09em;color:${MUTED};">WHY</p>
                <p class="ink" style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${INK};">${escapeHtml(reason)}</p>
              </td>
            </tr>
          </table>`;
}

const list = (fields: string[]) => fields.map((f) => escapeHtml(f.toLowerCase())).join(', ').replace(/, ([^,]*)$/, ' and $1');

export function renderAffiliateEmail(
  mail: AffiliateMail,
  c: AffiliateMailContext,
  settings: Record<string, string>
): { subject: string; html: string } {
  const code = escapeHtml(c.code);
  const button = (label: string, path = '') => renderButton(label, c.portalUrl + path);
  let subject: string;
  let subhead: string;
  let preheader: string;
  let body: string;

  switch (mail.kind) {
    case 'applied':
      subject = 'We got your application — Ascend Affiliate';
      subhead = 'your application is in.';
      preheader = `Your code ${c.code} is saved. We'll look at it shortly.`;
      body = `${paragraph(`Thanks for applying to Ascend Affiliate. We'll email you as soon as the team has looked at it.`)}
${codeBlock('YOUR CODE, SAVED', c.code, 'It starts working the moment we approve you.')}
${paragraph(mail.hasBank ? 'Your bank details came with the application, so payouts are ready to go once you start earning.' : "One thing you can do now: add your bank details in Settings, so your first payout isn't held up.")}
${button('OPEN ASCEND AFFILIATE')}`;
      break;

    case 'approved':
      subject = "You're in — your Ascend Affiliate code is live";
      subhead = "you're approved.";
      preheader = `${c.code} is live: ${c.customerDiscountPct}% off for them, ${c.rate} for you.`;
      body = `${paragraph(`Welcome to Ascend Affiliate. Your code works at checkout from now on: whoever uses it gets <strong>${c.customerDiscountPct}% off</strong>, and you earn <strong>${c.rate}</strong> of every paid order.`)}
${codeBlock('YOUR CODE IS LIVE', c.code, `Or share the link: <a href="${escapeHtml(c.shareUrl)}" class="muted" style="color:${MUTED};">${escapeHtml(c.shareUrl.replace(/^https?:\/\//, ''))}</a>`)}
${paragraph('Every order and what you earned on it shows up on your dashboard, and the Guide there covers everything else: how commission is worked out, the hold on new commission, and how to ask for a payout.')}
${button('OPEN YOUR DASHBOARD')}`;
      break;

    case 'rejected':
      subject = 'Your Ascend Affiliate application';
      subhead = 'about your application.';
      preheader = "We can't take your application this time.";
      body = `${paragraph("Thanks for your interest in Ascend Affiliate. We've looked at your application and can't take it on this time, so your code won't be activated.")}
${paragraph('If you think we got something wrong, contact us and tell us more.', true)}`;
      break;

    case 'paused':
      subject = 'Your Ascend Affiliate code is paused';
      subhead = 'your code is paused.';
      preheader = `${c.code} won't work at checkout for now.`;
      body = `${paragraph(`We've paused your affiliate code <strong style="font-family:${MONO};">${code}</strong>, so it won't work at checkout for now.`)}
${paragraph("Nothing you've earned is lost: your balance stays where it is, and any payout you asked for waits until the code is live again. If you're not sure why, contact us.")}
${button('OPEN ASCEND AFFILIATE')}`;
      break;

    case 'reactivated':
      subject = 'Your Ascend Affiliate code is live again';
      subhead = 'your code is live again.';
      preheader = `${c.code} works at checkout again.`;
      body = `${paragraph(`Good news: <strong style="font-family:${MONO};">${code}</strong> works at checkout again. Orders with it earn you ${c.rate} as before, and any payout that was waiting carries on.`)}
${button('OPEN YOUR DASHBOARD')}`;
      break;

    case 'payoutRequested':
      subject = `Payout of ${formatRM(mail.amount)} requested — Ascend Affiliate`;
      subhead = 'your payout is on its way.';
      preheader = `${formatRM(mail.amount)} to ${mail.bankName} ····${mail.last4}.`;
      body = `${paragraph("We've got your payout request. We'll check it, transfer it, and email you when the money is sent.")}
${facts([
  ['Amount', formatRM(mail.amount)],
  ['To', `${escapeHtml(mail.bankName)} ····${escapeHtml(mail.last4)}`],
])}
${button('SEE YOUR PAYOUTS', '/payouts')}
${footnote('If an order is refunded before the transfer, its commission comes off this payout.')}`;
      break;

    case 'payoutPaid':
      subject = `${formatRM(mail.amount)} paid to your bank — Ascend Affiliate`;
      subhead = 'your payout is paid.';
      preheader = `${formatRM(mail.amount)} sent to ${mail.bankName} ····${mail.last4}.`;
      body = `${paragraph(`We've sent your payout.${mail.amount < mail.asked ? ` It's ${formatRM(mail.amount)} of the ${formatRM(mail.asked)} you asked for: orders refunded since then took their commission back.` : ''}`)}
${facts([
  ['Amount', formatRM(mail.amount)],
  ['To', `${escapeHtml(mail.bankName)} ····${escapeHtml(mail.last4)}`],
  ['Sent', when(mail.paidAt, false)],
  ...(mail.reference ? ([['Reference', escapeHtml(mail.reference)]] as [string, string][]) : []),
])}
${button('SEE YOUR PAYOUTS', '/payouts')}`;
      break;

    case 'payoutCancelled':
      subject = 'Your payout request was cancelled — Ascend Affiliate';
      subhead = 'your payout was cancelled.';
      preheader = mail.reason;
      body = `${paragraph(`Your payout request for <strong>${formatRM(mail.amount)}</strong> was cancelled, so nothing was sent.`)}
${reasonBlock(mail.reason)}
${paragraph('Whatever is still in your balance stays there, and you can ask for a payout again from your dashboard.')}
${button('OPEN YOUR DASHBOARD')}`;
      break;

    case 'changeApproved':
      subject = 'Your details are updated — Ascend Affiliate';
      subhead = 'your details are updated.';
      preheader = `We approved the change to your ${mail.fields.map((f) => f.toLowerCase()).join(', ')}.`;
      body = `${paragraph(`We approved your change: your ${list(mail.fields)} ${mail.fields.length > 1 ? 'are' : 'is'} updated.${mail.fields.some((f) => /bank|account/i.test(f)) ? ' Payouts go to the new account from now on, including one that is already waiting.' : ''}`)}
${button('OPEN SETTINGS', '/settings')}
${footnote("Didn't ask for this? Contact us right away.")}`;
      break;

    case 'changeRejected':
      subject = "We couldn't make your change — Ascend Affiliate";
      subhead = 'about your change request.';
      preheader = mail.reason;
      body = `${paragraph(`We couldn't approve the change to your ${list(mail.fields)}, so your details stay as they were.`)}
${reasonBlock(mail.reason)}
${paragraph('You can send a new request from Settings at any time.')}
${button('OPEN SETTINGS', '/settings')}`;
      break;
  }

  return {
    subject,
    html: renderLayout({
      hero: { headline: `Hi ${escapeHtml(c.name)},`, subhead },
      body,
      preheader,
      settings,
      trust: false,
    }),
  };
}

/** One of each, for scripts/preview-emails.ts and the affiliate tests. */
export function affiliateMailSamples(now = new Date()): [string, AffiliateMail][] {
  const day = 86_400_000;
  const bank = { bankName: 'Maybank', last4: '4821' };
  return [
    ['applied', { kind: 'applied', hasBank: true }],
    ['applied-no-bank', { kind: 'applied', hasBank: false }],
    ['approved', { kind: 'approved' }],
    ['rejected', { kind: 'rejected' }],
    ['paused', { kind: 'paused' }],
    ['reactivated', { kind: 'reactivated' }],
    ['payout-requested', { kind: 'payoutRequested', amount: 18_450, ...bank }],
    ['payout-paid', { kind: 'payoutPaid', amount: 18_450, asked: 18_450, ...bank, reference: 'M2U 20261103-88412', paidAt: now }],
    ['payout-paid-part', { kind: 'payoutPaid', amount: 15_200, asked: 18_450, ...bank, reference: null, paidAt: now }],
    ['payout-cancelled', { kind: 'payoutCancelled', amount: 18_450, reason: 'The account name does not match the bank account. Update it in Settings and ask again.' }],
    ['change-approved', { kind: 'changeApproved', fields: ['Bank', 'Account no.'] }],
    ['change-rejected', { kind: 'changeRejected', fields: ['Name'], reason: 'The name has to match your bank account.' }],
  ];
}
