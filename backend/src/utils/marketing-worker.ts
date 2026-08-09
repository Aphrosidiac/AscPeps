import type { FastifyInstance } from 'fastify';
import type { Subscriber, CampaignRecipient, Campaign } from '@prisma/client';
import { sendEmail, marketingFrom } from './email.js';
import { isMarketingEnabled, listUnsubscribeHeaders, unsubscribeUrl, newWelcomeCode } from './marketing.js';
import { renderWelcome, type WelcomeDiscount } from '../emails/welcome.js';
import { renderCampaign } from '../emails/campaign.js';

// Resend's account-level ceiling is 2 requests/second. Pacing at 550ms keeps
// a burst comfortably under it without needing a token bucket — going over
// returns 429s that would burn a delivery attempt each, and the retry/backoff
// below would then space those rows out by minutes for a purely self-inflicted
// reason.
const SEND_SPACING_MS = 550;

// Sized so a full batch (batch × spacing) finishes inside the scheduling
// interval in server.ts, leaving the overlap guard as a backstop rather than
// the normal case.
const WELCOME_BATCH = 20;
const CAMPAIGN_BATCH = 40;

// Same shape as email-worker.ts's ladder, one rung shorter: a welcome or a
// newsletter that has failed four times over ~40 minutes is failing for a
// reason more time won't fix.
const BACKOFF_MS = [1 * 60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000, 2 * 60 * 60 * 1000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function settingInt(settings: Record<string, string>, key: string, fallback: number): number {
  const raw = Number(settings[key]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/**
 * Get (or mint) this subscriber's single-use first-order code.
 *
 * Minted and linked BEFORE the send, and reused on every retry, so a send
 * that fails twice cannot leave two live codes attached to one address. Null
 * when welcome discounts are switched off — the welcome email handles that
 * case on its own.
 */
async function ensureWelcomeDiscount(
  fastify: FastifyInstance,
  subscriber: Subscriber,
  settings: Record<string, string>
): Promise<WelcomeDiscount | null> {
  const percent = settingInt(settings, 'welcome_discount_percent', 0);
  if (percent <= 0) return null;

  if (subscriber.welcomeDiscountCodeId) {
    const existing = await fastify.prisma.discountCode.findUnique({
      where: { id: subscriber.welcomeDiscountCodeId },
    });
    if (existing) {
      return {
        code: existing.code,
        percent: existing.discountValue,
        // A welcome code always has an expiry (set below), but the column is
        // nullable for hand-made codes — fall back rather than render "Invalid
        // Date" into a few thousand inboxes.
        expiresAt: existing.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        minOrderAmount: existing.minOrderAmount,
      };
    }
  }

  const days = settingInt(settings, 'welcome_discount_days', 30);
  const minOrder = settingInt(settings, 'welcome_discount_min_order', 0);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Retry the random code on the (vanishingly unlikely) collision with an
  // existing one rather than letting a P2002 fail the whole welcome.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await fastify.prisma.discountCode.create({
        data: {
          code: newWelcomeCode(),
          description: `Newsletter welcome — ${subscriber.email}`,
          discountType: 'PERCENTAGE',
          discountValue: percent,
          minOrderAmount: minOrder > 0 ? minOrder : null,
          // Single use is the whole point of minting one per person: a code
          // that leaks discounts exactly one order, not every order.
          maxUses: 1,
          expiresAt,
        },
      });
      await fastify.prisma.subscriber.update({
        where: { id: subscriber.id },
        data: { welcomeDiscountCodeId: created.id },
      });
      return {
        code: created.code,
        percent: created.discountValue,
        expiresAt,
        minOrderAmount: created.minOrderAmount,
      };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'P2002') throw err;
    }
  }
  throw new Error('could not mint a unique welcome discount code');
}

async function processWelcome(
  fastify: FastifyInstance,
  subscriber: Subscriber,
  settings: Record<string, string>
): Promise<void> {
  try {
    const discount = await ensureWelcomeDiscount(fastify, subscriber, settings);
    const url = unsubscribeUrl(subscriber.unsubscribeToken);
    const { subject, html } = renderWelcome(discount, url, settings);

    const { id: resendId } = await sendEmail({
      to: subscriber.email,
      subject,
      html,
      from: marketingFrom(),
      headers: listUnsubscribeHeaders(subscriber.unsubscribeToken),
    });

    await fastify.prisma.subscriber.update({
      where: { id: subscriber.id },
      data: { welcomeSentAt: new Date(), welcomeError: null },
    });
    fastify.log.info({ resendId }, 'welcome email sent');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fastify.prisma.subscriber.update({
      where: { id: subscriber.id },
      data: { welcomeAttempts: { increment: 1 }, welcomeError: message.slice(0, 500) },
    });
    fastify.log.warn({ err, subscriberId: subscriber.id }, 'welcome email send failed');
  }
}

let welcomeRunning = false;

/**
 * Send the welcome email to everyone who has joined the list and not had one.
 *
 * The queue is `welcomeSentAt IS NULL` on the subscriber row itself, so this
 * is exactly-once without a join table, and a signup that happened while
 * marketing mail was switched off is simply picked up whenever it comes back
 * on. Rows that have burned all their attempts drop out of the query and keep
 * `welcomeError` for the admin list to show.
 */
export async function processWelcomeEmails(fastify: FastifyInstance): Promise<void> {
  if (welcomeRunning || !(await isMarketingEnabled(fastify.prisma))) return;
  welcomeRunning = true;
  try {
    const due = await fastify.prisma.subscriber.findMany({
      where: {
        welcomeSentAt: null,
        status: 'SUBSCRIBED',
        welcomeAttempts: { lt: MAX_ATTEMPTS },
      },
      orderBy: { createdAt: 'asc' },
      take: WELCOME_BATCH,
    });
    if (due.length === 0) return;

    const settingsRows = await fastify.prisma.setting.findMany();
    const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

    for (const [index, subscriber] of due.entries()) {
      if (index > 0) await sleep(SEND_SPACING_MS);
      await processWelcome(fastify, subscriber, settings);
    }
  } finally {
    welcomeRunning = false;
  }
}

async function processCampaignRecipient(
  fastify: FastifyInstance,
  row: CampaignRecipient & { campaign: Campaign; subscriber: Subscriber },
  settings: Record<string, string>
): Promise<void> {
  // Someone who left the list between the send being queued and this row
  // coming up must not be mailed. Materialising recipients up front is what
  // makes the send resumable; re-checking status here is what stops that
  // snapshot from overriding a later opt-out.
  if (row.subscriber.status !== 'SUBSCRIBED') {
    await fastify.prisma.campaignRecipient.update({
      where: { id: row.id },
      data: { status: 'FAILED', lastError: 'unsubscribed before send' },
    });
    return;
  }

  try {
    const url = unsubscribeUrl(row.subscriber.unsubscribeToken);
    const { subject, html } = renderCampaign(row.campaign, url, settings);

    const { id: resendId } = await sendEmail({
      to: row.toEmail,
      subject,
      html,
      from: marketingFrom(),
      headers: listUnsubscribeHeaders(row.subscriber.unsubscribeToken),
    });

    await fastify.prisma.campaignRecipient.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: new Date(), resendId },
    });
  } catch (err) {
    const attempts = row.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    await fastify.prisma.campaignRecipient.update({
      where: { id: row.id },
      data: {
        attempts,
        lastError: message.slice(0, 500),
        ...(attempts >= MAX_ATTEMPTS
          ? { status: 'FAILED' }
          : { nextAttemptAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) }),
      },
    });
    fastify.log.warn({ err, recipientId: row.id, attempts }, 'campaign email send failed');
  }
}

let campaignRunning = false;

/** Drain due campaign recipient rows, then close out any finished campaign. */
export async function processCampaigns(fastify: FastifyInstance): Promise<void> {
  if (campaignRunning || !(await isMarketingEnabled(fastify.prisma))) return;
  campaignRunning = true;
  try {
    const rows = await fastify.prisma.campaignRecipient.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
        campaign: { status: 'SENDING' },
      },
      orderBy: { createdAt: 'asc' },
      take: CAMPAIGN_BATCH,
      include: { campaign: true, subscriber: true },
    });

    if (rows.length > 0) {
      const settingsRows = await fastify.prisma.setting.findMany();
      const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
      for (const [index, row] of rows.entries()) {
        if (index > 0) await sleep(SEND_SPACING_MS);
        await processCampaignRecipient(fastify, row, settings);
      }
    }

    // Flip SENDING -> SENT once nothing is left to attempt. Done as its own
    // pass rather than by counting inside the loop above, because rows that
    // went to FAILED, rows still waiting on a backoff, and rows from a batch
    // this tick never reached all have to be accounted for before a campaign
    // can honestly be called sent.
    const sending = await fastify.prisma.campaign.findMany({
      where: { status: 'SENDING' },
      select: { id: true },
    });
    for (const campaign of sending) {
      const pending = await fastify.prisma.campaignRecipient.count({
        where: { campaignId: campaign.id, status: 'PENDING' },
      });
      if (pending === 0) {
        await fastify.prisma.campaign.update({
          where: { id: campaign.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        fastify.log.info({ campaignId: campaign.id }, 'campaign finished sending');
      }
    }
  } finally {
    campaignRunning = false;
  }
}
