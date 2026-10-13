import type { FastifyInstance } from 'fastify';
import type { CampaignAudience } from '@prisma/client';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { sendEmail, marketingFrom } from '../../utils/email.js';
import { unsubscribeUrl, listUnsubscribeHeaders, newUnsubscribeToken } from '../../utils/marketing.js';
import {
  renderCampaign,
  loadCampaignProducts,
  UNSUBSCRIBE_REASON_ORDER,
} from '../../emails/campaign.js';
import { UNSUBSCRIBE_REASON_SIGNUP } from '../../emails/layout.js';

const AUDIENCES = ['ALL', 'BUYERS', 'NON_BUYERS', 'CUSTOMERS'] as const;

// Optional text that the composer must be able to CLEAR, not just leave
// alone: "" and null both mean "empty" and are stored as null. A bare
// .optional() drops the key from a partial update, so a cleared field kept
// its old value forever.
const clearable = (max: number) =>
  z
    .string()
    .max(max)
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));

const campaignFields = z.object({
  name: z.string().min(1).max(120).trim(),
  subject: z.string().min(1).max(200).trim(),
  preheader: clearable(200),
  headline: clearable(120),
  subhead: clearable(120),
  badge: clearable(32),
  body: z.string().min(1).max(20000),
  ctaLabel: clearable(40),
  // A CTA that isn't an absolute http(s) URL is a broken button in every
  // inbox it reaches, and relative paths do not resolve inside an email.
  ctaUrl: z.union([z.string().url().max(500), z.literal(''), z.null()]).optional().transform((v) => (v === undefined ? undefined : v || null)),
  // One spotlight plus up to three pairs. Past that it is a catalogue, and
  // the email stops having a point.
  productIds: z.array(z.string().min(1).max(40)).max(7).optional(),
  audience: z.enum(AUDIENCES),
});

const campaignSchema = campaignFields.extend({ audience: z.enum(AUDIENCES).default('ALL') });

// Built from the fields WITHOUT the default: zod 4 applies a default even
// inside .partial(), so a PATCH that only cleared the badge used to reset
// the audience to ALL as a side effect.
const updateSchema = campaignFields.partial();

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every address on a paid order, lowercased — Subscriber.email is normalised
 *  on write, Order.email is not. */
async function paidBuyerEmails(fastify: FastifyInstance): Promise<string[]> {
  const paidOrders = await fastify.prisma.order.findMany({
    where: { paymentStatus: 'PAID', deletedAt: null, email: { not: null } },
    select: { email: true },
    distinct: ['email'],
  });
  return [
    ...new Set(
      paidOrders.map((o) => o.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e && EMAIL_SHAPE.test(e)))
    ),
  ];
}

/**
 * Resolve an audience to the people it reaches right now.
 *
 * `existing` are subscriber rows. `toAdd` is only ever non-empty for
 * CUSTOMERS: paid customers with no subscriber row at all. Anyone with a row
 * is already decided — subscribed, or unsubscribed and therefore never
 * mailed — so an address that ever opted out cannot come back in through the
 * customer list.
 *
 * "Buyer" is matched on the order's email rather than any account link,
 * because most orders here are placed without an account at all — a Member is
 * a commenting login, not a customer record.
 */
async function resolveAudience(
  fastify: FastifyInstance,
  audience: CampaignAudience
): Promise<{ existing: { id: string; email: string }[]; toAdd: string[] }> {
  const base = { status: 'SUBSCRIBED' as const };
  if (audience === 'ALL' || audience === 'CUSTOMERS') {
    const existing = await fastify.prisma.subscriber.findMany({ where: base, select: { id: true, email: true } });
    if (audience === 'ALL') return { existing, toAdd: [] };

    const buyers = await paidBuyerEmails(fastify);
    const known = await fastify.prisma.subscriber.findMany({
      where: { email: { in: buyers } },
      select: { email: true },
    });
    const knownSet = new Set(known.map((k) => k.email));
    return { existing, toAdd: buyers.filter((e) => !knownSet.has(e)) };
  }

  const buyerEmails = await paidBuyerEmails(fastify);
  const existing = await fastify.prisma.subscriber.findMany({
    where: {
      ...base,
      email: audience === 'BUYERS' ? { in: buyerEmails } : { notIn: buyerEmails },
    },
    select: { id: true, email: true },
  });
  return { existing, toAdd: [] };
}

export async function adminListCampaigns(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const [campaigns, total] = await Promise.all([
    fastify.prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { _count: { select: { recipients: true } } },
    }),
    fastify.prisma.campaign.count(),
  ]);

  return paginatedResponse(campaigns, total, page, limit);
}

/** One campaign plus the delivery tally the detail screen reports against. */
export async function adminGetCampaign(fastify: FastifyInstance, id: string) {
  const campaign = await fastify.prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw { statusCode: 404, message: 'Campaign not found' };

  const grouped = await fastify.prisma.campaignRecipient.groupBy({
    by: ['status'],
    where: { campaignId: id },
    _count: { _all: true },
  });

  return {
    ...campaign,
    delivery: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
  };
}

/** How many people a given audience currently reaches, for the composer. */
export async function adminAudienceCount(fastify: FastifyInstance, query: Record<string, string>) {
  const audience = z.enum(AUDIENCES).parse(query.audience ?? 'ALL');
  const { existing, toAdd } = await resolveAudience(fastify, audience);
  return { audience, count: existing.length + toAdd.length, fromOrders: toAdd.length };
}

export async function adminCreateCampaign(fastify: FastifyInstance, body: unknown) {
  const data = campaignSchema.parse(body);
  return fastify.prisma.campaign.create({ data });
}

export async function adminUpdateCampaign(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateSchema.parse(body);
  const existing = await fastify.prisma.campaign.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw { statusCode: 404, message: 'Campaign not found' };
  // Editing a campaign mid-send would mean two different emails going out
  // under one name, with no record of who got which.
  if (existing.status !== 'DRAFT') {
    throw { statusCode: 400, message: 'Only draft campaigns can be edited' };
  }
  return fastify.prisma.campaign.update({ where: { id }, data });
}

export async function adminDeleteCampaign(fastify: FastifyInstance, id: string) {
  const existing = await fastify.prisma.campaign.findUnique({ where: { id }, select: { status: true } });
  if (!existing) throw { statusCode: 404, message: 'Campaign not found' };
  // A sent campaign is a delivery record, not a document. Keeping it is what
  // lets "did we already mail everyone about this?" stay answerable.
  if (existing.status !== 'DRAFT') {
    throw { statusCode: 400, message: 'Only draft campaigns can be deleted' };
  }
  await fastify.prisma.campaign.delete({ where: { id } });
  return { ok: true };
}

const testSchema = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
});

/**
 * Send one copy to a nominated address without touching the campaign's state
 * or its recipient rows.
 *
 * Deliberately bypasses isMarketingEnabled() — the same call admin-emails
 * makes for its template tests. Checking a template before a bulk send is
 * exactly when the master switch is most likely to still be off, and refusing
 * then would push people into sending the real thing to find out how it looks.
 *
 * The unsubscribe link uses a throwaway token that matches no subscriber, so
 * clicking it in a test is a silent no-op rather than opting a real person out.
 */
export async function adminSendTestCampaign(fastify: FastifyInstance, id: string, body: unknown) {
  const { email } = testSchema.parse(body);
  const campaign = await fastify.prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw { statusCode: 404, message: 'Campaign not found' };

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  const throwawayToken = newUnsubscribeToken();
  const products = await loadCampaignProducts(fastify.prisma, campaign.productIds);
  const { subject, html, text } = renderCampaign(campaign, {
    unsubscribeUrl: unsubscribeUrl(throwawayToken),
    settings,
    products,
  });

  const { id: resendId } = await sendEmail({
    to: email,
    subject: `[TEST] ${subject}`,
    html,
    text,
    from: marketingFrom(),
    headers: listUnsubscribeHeaders(throwawayToken),
  });

  return { ok: true, resendId };
}

/**
 * Materialise the audience into recipient rows and hand the campaign to the
 * worker.
 *
 * The audience is snapshotted here, once, rather than resolved by the worker
 * per batch: a live query would keep picking up people who joined mid-send
 * (mailing them a campaign they never opted into) and would silently change
 * what "sent to 412 people" meant. The (campaignId, subscriberId) unique key
 * plus skipDuplicates makes a double-submit a no-op instead of a second copy
 * in everyone's inbox.
 */
export async function adminSendCampaign(fastify: FastifyInstance, id: string) {
  const campaign = await fastify.prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw { statusCode: 404, message: 'Campaign not found' };
  if (campaign.status !== 'DRAFT') {
    throw { statusCode: 400, message: 'This campaign has already been sent' };
  }

  const { existing, toAdd } = await resolveAudience(fastify, campaign.audience);
  if (existing.length + toAdd.length === 0) {
    throw { statusCode: 400, message: 'That audience currently has nobody in it' };
  }

  const recipients = await fastify.prisma.$transaction(async (tx) => {
    // Customers who never signed up get a subscriber row now, so they carry
    // an unsubscribe token like everyone else and an opt-out from this send
    // sticks for every later one. skipDuplicates covers someone signing up
    // in the seconds between resolving and here; their own row wins.
    let added: { id: string; email: string }[] = [];
    if (toAdd.length) {
      await tx.subscriber.createMany({
        data: toAdd.map((email) => ({ email, source: 'ORDER' as const, unsubscribeToken: newUnsubscribeToken() })),
        skipDuplicates: true,
      });
      added = await tx.subscriber.findMany({
        where: { email: { in: toAdd }, status: 'SUBSCRIBED' },
        select: { id: true, email: true },
      });
    }
    const recipients = [...existing, ...added];

    await tx.campaignRecipient.createMany({
      data: recipients.map((r) => ({ campaignId: id, subscriberId: r.id, toEmail: r.email })),
      skipDuplicates: true,
    });
    await tx.campaign.update({
      where: { id },
      data: { status: 'SENDING', recipientCount: recipients.length },
    });
    return recipients;
  });

  fastify.log.info({ campaignId: id, recipients: recipients.length }, 'campaign queued for sending');
  return { ok: true, recipientCount: recipients.length };
}

/**
 * The campaign rendered exactly as the worker would send it, for the
 * composer's live preview. `as=order` shows the footer a customer added from
 * an order sees instead of a subscriber's.
 */
export async function adminPreviewCampaign(fastify: FastifyInstance, id: string, query: Record<string, string>) {
  const campaign = await fastify.prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw { statusCode: 404, message: 'Campaign not found' };

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const products = await loadCampaignProducts(fastify.prisma, campaign.productIds);

  return renderCampaign(campaign, {
    unsubscribeUrl: unsubscribeUrl('preview'),
    settings,
    products,
    reason: query.as === 'order' ? UNSUBSCRIBE_REASON_ORDER : UNSUBSCRIBE_REASON_SIGNUP,
  });
}
