import { renderLayout, paragraph as para, button as btn, note, notice, codeBox, details, escapeHtml, formatRM, MONO, MUTED } from './layout.js';

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

const paragraph = (html: string, last = false) => para(html, { mb: last ? 0 : 20 });
const footnote = (html: string) => note(html, 24);
const codeBlock = (label: string, code: string, foot: string) => codeBox(label, code, foot);
const facts = (rows: [string, string][]) => details(rows);
const reasonBlock = (reason: string) => notice('Why', escapeHtml(reason));

// Malaysian time whatever the server runs in.
function when(d: Date, time = true): string {
  return d.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'long', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });
}

const list = (fields: string[]) => fields.map((f) => escapeHtml(f.toLowerCase())).join(', ').replace(/, ([^,]*)$/, ' and $1');

export function renderAffiliateEmail(
  mail: AffiliateMail,
  c: AffiliateMailContext,
  settings: Record<string, string>
): { subject: string; html: string } {
  const code = escapeHtml(c.code);
  const button = (label: string, path = '') => btn(label, c.portalUrl + path, { mt: 4 });
  let subject: string;
  let subhead: string;
  let preheader: string;
  let body: string;

  switch (mail.kind) {
    case 'applied':
      subject = 'We got your application — Ascend Affiliate';
      subhead = 'Your application is in.';
      preheader = `Your code ${c.code} is saved. We'll look at it shortly.`;
      body = `${paragraph(`Thanks for applying to Ascend Affiliate. We'll email you as soon as the team has looked at it.`)}
${codeBlock('Your code, saved', c.code, 'It starts working the moment we approve you.')}
${paragraph(mail.hasBank ? 'Your bank details came with the application, so payouts are ready to go once you start earning.' : "One thing you can do now: add your bank details in Settings, so your first payout isn't held up.")}
${button('Open Ascend Affiliate')}`;
      break;

    case 'approved':
      subject = "You're in — your Ascend Affiliate code is live";
      subhead = "You're approved.";
      preheader = `${c.code} is live: ${c.customerDiscountPct}% off for them, ${c.rate} for you.`;
      body = `${paragraph(`Welcome to Ascend Affiliate. Your code works at checkout from now on: whoever uses it gets <strong>${c.customerDiscountPct}% off</strong>, and you earn <strong>${c.rate}</strong> of every paid order.`)}
${codeBlock('Your code is live', c.code, `Or share the link: <a href="${escapeHtml(c.shareUrl)}" style="color:${MUTED};text-decoration:underline;">${escapeHtml(c.shareUrl.replace(/^https?:\/\//, ''))}</a>`)}
${paragraph('Every order and what you earned on it shows up on your dashboard, and the Guide there covers everything else: how commission is worked out, the hold on new commission, and how to ask for a payout.')}
${button('Open your dashboard')}`;
      break;

    case 'rejected':
      subject = 'Your Ascend Affiliate application';
      subhead = 'About your application.';
      preheader = "We can't take your application this time.";
      body = `${paragraph("Thanks for your interest in Ascend Affiliate. We've looked at your application and can't take it on this time, so your code won't be activated.")}
${paragraph('If you think we got something wrong, contact us and tell us more.', true)}`;
      break;

    case 'paused':
      subject = 'Your Ascend Affiliate code is paused';
      subhead = 'Your code is paused.';
      preheader = `${c.code} won't work at checkout for now.`;
      body = `${paragraph(`We've paused your affiliate code <strong style="font-family:${MONO};">${code}</strong>, so it won't work at checkout for now.`)}
${paragraph("Nothing you've earned is lost: your balance stays where it is, and any payout you asked for waits until the code is live again. If you're not sure why, contact us.")}
${button('Open Ascend Affiliate')}`;
      break;

    case 'reactivated':
      subject = 'Your Ascend Affiliate code is live again';
      subhead = 'Your code is live again.';
      preheader = `${c.code} works at checkout again.`;
      body = `${paragraph(`Good news: <strong style="font-family:${MONO};">${code}</strong> works at checkout again. Orders with it earn you ${c.rate} as before, and any payout that was waiting carries on.`)}
${button('Open your dashboard')}`;
      break;

    case 'payoutRequested':
      subject = `Payout of ${formatRM(mail.amount)} requested — Ascend Affiliate`;
      subhead = 'Your payout is on its way.';
      preheader = `${formatRM(mail.amount)} to ${mail.bankName} ····${mail.last4}.`;
      body = `${paragraph("We've got your payout request. We'll check it, transfer it, and email you when the money is sent.")}
${facts([
  ['Amount', formatRM(mail.amount)],
  ['To', `${escapeHtml(mail.bankName)} ····${escapeHtml(mail.last4)}`],
])}
${button('See your payouts', '/payouts')}
${footnote('If an order is refunded before the transfer, its commission comes off this payout.')}`;
      break;

    case 'payoutPaid':
      subject = `${formatRM(mail.amount)} paid to your bank — Ascend Affiliate`;
      subhead = 'Your payout is paid.';
      preheader = `${formatRM(mail.amount)} sent to ${mail.bankName} ····${mail.last4}.`;
      body = `${paragraph(`We've sent your payout.${mail.amount < mail.asked ? ` It's ${formatRM(mail.amount)} of the ${formatRM(mail.asked)} you asked for: orders refunded since then took their commission back.` : ''}`)}
${facts([
  ['Amount', formatRM(mail.amount)],
  ['To', `${escapeHtml(mail.bankName)} ····${escapeHtml(mail.last4)}`],
  ['Sent', when(mail.paidAt, false)],
  ...(mail.reference ? ([['Reference', escapeHtml(mail.reference)]] as [string, string][]) : []),
])}
${button('See your payouts', '/payouts')}`;
      break;

    case 'payoutCancelled':
      subject = 'Your payout request was cancelled — Ascend Affiliate';
      subhead = 'Your payout was cancelled.';
      preheader = mail.reason;
      body = `${paragraph(`Your payout request for <strong>${formatRM(mail.amount)}</strong> was cancelled, so nothing was sent.`)}
${reasonBlock(mail.reason)}
${paragraph('Whatever is still in your balance stays there, and you can ask for a payout again from your dashboard.')}
${button('Open your dashboard')}`;
      break;

    case 'changeApproved':
      subject = 'Your details are updated — Ascend Affiliate';
      subhead = 'Your details are updated.';
      preheader = `We approved the change to your ${mail.fields.map((f) => f.toLowerCase()).join(', ')}.`;
      body = `${paragraph(`We approved your change: your ${list(mail.fields)} ${mail.fields.length > 1 ? 'are' : 'is'} updated.${mail.fields.some((f) => /bank|account/i.test(f)) ? ' Payouts go to the new account from now on, including one that is already waiting.' : ''}`)}
${button('Open settings', '/settings')}
${footnote("Didn't ask for this? Contact us right away.")}`;
      break;

    case 'changeRejected':
      subject = "We couldn't make your change — Ascend Affiliate";
      subhead = 'About your change request.';
      preheader = mail.reason;
      body = `${paragraph(`We couldn't approve the change to your ${list(mail.fields)}, so your details stay as they were.`)}
${reasonBlock(mail.reason)}
${paragraph('You can send a new request from Settings at any time.')}
${button('Open settings', '/settings')}`;
      break;
  }

  return {
    subject,
    html: renderLayout({
      headline: subhead.replace(/\.$/, ''),
      body: `${paragraph(`Hi ${escapeHtml(c.name)},`)}${body}`,
      preheader,
      settings,
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
