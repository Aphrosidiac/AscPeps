import type { FastifyInstance } from 'fastify';
import type { CampaignAudience } from '@prisma/client';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { sendEmail, marketingFrom } from '../../utils/email.js';
import { unsubscribeUrl, listUnsubscribeHeaders, newUnsubscribeToken } from '../../utils/marketing.js';
import { renderCampaign } from '../../emails/campaign.js';

const campaignSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  subject: z.string().min(1).max(200).trim(),
  preheader: z.string().max(200).trim().optional(),
  body: z.string().min(1).max(20000),
  ctaLabel: z.string().max(40).trim().optional(),
  // A CTA that isn't an absolute http(s) URL is a broken button in every
  // inbox it reaches, and relative paths do not resolve inside an email.
  ctaUrl: z.string().url().max(500).optional(),
  audience: z.enum(['ALL', 'BUYERS', 'NON_BUYERS']).default('ALL'),
});

const updateSchema = campaignSchema.partial();

/**
 * Resolve an audience to subscriber rows.
 *
 * "Buyer" is matched on the order's email rather than any account link,
 * because most orders here are placed without an account at all — a Member is
 * a commenting login, not a customer record. Order emails are lowercased for
 * the comparison since only Subscriber.email is normalised on write.
 */
async function resolveAudience(fastify: FastifyInstance, audience: CampaignAudience) {
  const base = { status: 'SUBSCRIBED' as const };
  if (audience === 'ALL') {
    return fastify.prisma.subscriber.findMany({
      where: base,
      select: { id: true, email: true },
    });
  }

  const paidOrders = await fastify.prisma.order.findMany({
    where: { paymentStatus: 'PAID', deletedAt: null, email: { not: null } },
    select: { email: true },
    distinct: ['email'],
  });
  const buyerEmails = paidOrders
    .map((o) => o.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  return fastify.prisma.subscriber.findMany({
    where: {
      ...base,
      email: audience === 'BUYERS' ? { in: buyerEmails } : { notIn: buyerEmails },
    },
    select: { id: true, email: true },
  });
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
  const audience = z.enum(['ALL', 'BUYERS', 'NON_BUYERS']).parse(query.audience ?? 'ALL');
  const recipients = await resolveAudience(fastify, audience);
  return { audience, count: recipients.length };
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
  const { subject, html } = renderCampaign(campaign, unsubscribeUrl(throwawayToken), settings);

  const { id: resendId } = await sendEmail({
    to: email,
    subject: `[TEST] ${subject}`,
    html,
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

  const recipients = await resolveAudience(fastify, campaign.audience);
  if (recipients.length === 0) {
    throw { statusCode: 400, message: 'That audience currently has nobody in it' };
  }

  await fastify.prisma.$transaction(async (tx) => {
    await tx.campaignRecipient.createMany({
      data: recipients.map((r) => ({ campaignId: id, subscriberId: r.id, toEmail: r.email })),
      skipDuplicates: true,
    });
    await tx.campaign.update({
      where: { id },
      data: { status: 'SENDING', recipientCount: recipients.length },
    });
  });

  fastify.log.info({ campaignId: id, recipients: recipients.length }, 'campaign queued for sending');
  return { ok: true, recipientCount: recipients.length };
}
