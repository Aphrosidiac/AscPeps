import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { newUnsubscribeToken, unsubscribeUrl } from '../../utils/marketing.js';
import { renderWelcome, type WelcomeDiscount } from '../../emails/welcome.js';

// Mirrors the welcome sweep's own ceiling (utils/marketing-worker.ts) so the
// admin list can tell "still retrying automatically" apart from "gave up,
// needs a manual retry" without importing the worker module itself.
const MAX_WELCOME_ATTEMPTS = 4;

const listQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['SUBSCRIBED', 'UNSUBSCRIBED']).optional(),
  source: z.enum(['FOOTER', 'CHECKOUT', 'ADMIN']).optional(),
});

function buildWhere(query: Record<string, string>): Prisma.SubscriberWhereInput {
  const { search, status, source } = listQuerySchema.parse(query);
  const where: Prisma.SubscriberWhereInput = {};
  if (search) where.email = { contains: search, mode: 'insensitive' };
  if (status) where.status = status;
  if (source) where.source = source;
  return where;
}

export async function adminListSubscribers(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const where = buildWhere(query);

  const [subscribers, total] = await Promise.all([
    fastify.prisma.subscriber.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      // Never select unsubscribeToken. It is a capability — anything that can
      // read it can opt anyone out — and the admin UI has an explicit
      // unsubscribe action that needs the id, not the token.
      select: {
        id: true,
        email: true,
        status: true,
        source: true,
        createdAt: true,
        unsubscribedAt: true,
        unsubscribeReason: true,
        welcomeSentAt: true,
        welcomeAttempts: true,
        welcomeError: true,
        welcomeStatus: true,
        welcomeStatusAt: true,
        welcomeDiscountCode: { select: { code: true, usedCount: true } },
      },
    }),
    fastify.prisma.subscriber.count({ where }),
  ]);

  // welcomeExhausted: the sweep has stopped retrying on its own (it excludes
  // rows at MAX_WELCOME_ATTEMPTS), so this is what tells the list apart from
  // "still failing but the backoff will try again" — and it's the signal for
  // whether the manual retry button actually does something new.
  const rows = subscribers.map((s) => ({
    ...s,
    welcomeExhausted: !s.welcomeSentAt && s.welcomeAttempts >= MAX_WELCOME_ATTEMPTS,
  }));

  return paginatedResponse(rows, total, page, limit);
}

/**
 * Headline numbers for the subscribers screen. `last30Days` is the only one
 * that answers "is the capture actually working" — a lifetime total keeps
 * looking healthy long after the signup form has stopped converting.
 */
export async function adminSubscriberStats(fastify: FastifyInstance) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [subscribed, unsubscribed, last30Days, pendingWelcome, delivered, deliveryIssues, bySource] = await Promise.all([
    fastify.prisma.subscriber.count({ where: { status: 'SUBSCRIBED' } }),
    fastify.prisma.subscriber.count({ where: { status: 'UNSUBSCRIBED' } }),
    fastify.prisma.subscriber.count({ where: { createdAt: { gte: since } } }),
    fastify.prisma.subscriber.count({ where: { welcomeSentAt: null, status: 'SUBSCRIBED' } }),
    fastify.prisma.subscriber.count({ where: { welcomeStatus: 'DELIVERED' } }),
    // Two ways a welcome ends up needing a human: Resend/the recipient's
    // server rejected the send outright (bounced/complained), or the sweep
    // gave up retrying before it ever got a resendId to track (exhausted).
    fastify.prisma.subscriber.count({
      where: {
        OR: [
          { welcomeStatus: { in: ['BOUNCED', 'COMPLAINED'] } },
          { welcomeSentAt: null, welcomeAttempts: { gte: MAX_WELCOME_ATTEMPTS } },
        ],
      },
    }),
    fastify.prisma.subscriber.groupBy({
      by: ['source'],
      where: { status: 'SUBSCRIBED' },
      _count: { _all: true },
    }),
  ]);

  return {
    subscribed,
    unsubscribed,
    last30Days,
    pendingWelcome,
    delivered,
    deliveryIssues,
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
  };
}

function settingInt(settings: Record<string, string>, key: string, fallback: number): number {
  const raw = Number(settings[key]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

const previewWelcomeQuerySchema = z.object({ subscriberId: z.string().optional() });

/**
 * Render the welcome email exactly as processWelcome() would — same
 * template, same settings — for the admin's read-only preview.
 *
 * Given a subscriberId whose welcome already went out, this renders with
 * their real (already-minted) discount code. Otherwise it fabricates a
 * placeholder code from the current settings, same shape ensureWelcomeDiscount
 * would mint, but never writes one — a preview must not have the side effect
 * of minting a real single-use code nobody will ever receive.
 */
export async function adminPreviewWelcome(fastify: FastifyInstance, query: Record<string, string>) {
  const { subscriberId } = previewWelcomeQuerySchema.parse(query);

  const settingsRows = await fastify.prisma.setting.findMany();
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  let discount: WelcomeDiscount | null = null;
  let token = 'preview';

  if (subscriberId) {
    const subscriber = await fastify.prisma.subscriber.findUnique({
      where: { id: subscriberId },
      include: { welcomeDiscountCode: true },
    });
    if (!subscriber) throw { statusCode: 404, message: 'Subscriber not found' };
    token = subscriber.unsubscribeToken;
    if (subscriber.welcomeDiscountCode) {
      discount = {
        code: subscriber.welcomeDiscountCode.code,
        percent: subscriber.welcomeDiscountCode.discountValue,
        expiresAt: subscriber.welcomeDiscountCode.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        minOrderAmount: subscriber.welcomeDiscountCode.minOrderAmount,
      };
    }
  }

  if (!discount) {
    const percent = settingInt(settings, 'welcome_discount_percent', 0);
    if (percent > 0) {
      const days = settingInt(settings, 'welcome_discount_days', 30);
      const minOrder = settingInt(settings, 'welcome_discount_min_order', 0);
      discount = {
        code: 'ASCPREVIEW',
        percent,
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        minOrderAmount: minOrder > 0 ? minOrder : null,
      };
    }
  }

  return renderWelcome(discount, unsubscribeUrl(token), settings);
}

const createSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.trim().toLowerCase()),
});

/** Add an address by hand (a request over WhatsApp, a name off a form). */
export async function adminCreateSubscriber(fastify: FastifyInstance, body: unknown) {
  const { email } = createSchema.parse(body);
  const existing = await fastify.prisma.subscriber.findUnique({ where: { email } });
  if (existing) throw { statusCode: 409, message: 'That address is already on the list' };

  return fastify.prisma.subscriber.create({
    data: { email, source: 'ADMIN', unsubscribeToken: newUnsubscribeToken() },
    select: { id: true, email: true, status: true, source: true, createdAt: true },
  });
}

/**
 * Opt someone out from the admin side (they asked over WhatsApp, say).
 * One-way on purpose — there is no admin "re-subscribe", because consent is
 * the person's to give and the signup form is where they give it.
 */
export async function adminUnsubscribe(fastify: FastifyInstance, id: string) {
  await fastify.prisma.subscriber.update({
    where: { id },
    data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), unsubscribeReason: 'admin' },
  });
  return { ok: true };
}

/**
 * Clear the failure state so the welcome sweep picks the row up again. The
 * attempt counter is what excluded it, so resetting that IS the retry — no
 * separate send path, which keeps "sent once" true.
 */
export async function adminRetryWelcome(fastify: FastifyInstance, id: string) {
  const subscriber = await fastify.prisma.subscriber.findUnique({
    where: { id },
    select: { welcomeSentAt: true },
  });
  if (!subscriber) throw { statusCode: 404, message: 'Subscriber not found' };
  if (subscriber.welcomeSentAt) throw { statusCode: 400, message: 'Welcome email already sent' };

  await fastify.prisma.subscriber.update({
    where: { id },
    data: { welcomeAttempts: 0, welcomeError: null },
  });
  return { ok: true };
}

export async function adminDeleteSubscriber(fastify: FastifyInstance, id: string) {
  await fastify.prisma.subscriber.delete({ where: { id } });
  return { ok: true };
}

/**
 * CSV of the current list, honouring the same filters as the table.
 *
 * Deliberately unpaginated: an export that silently stopped at 20 rows would
 * be worse than no export. Streaming isn't warranted at this list's size, but
 * if it ever runs into six figures this is the thing to revisit.
 */
export async function adminExportSubscribers(fastify: FastifyInstance, query: Record<string, string>) {
  const rows = await fastify.prisma.subscriber.findMany({
    where: buildWhere(query),
    orderBy: { createdAt: 'desc' },
    select: { email: true, status: true, source: true, createdAt: true, unsubscribedAt: true },
  });

  const escape = (value: string) =>
    // Prefixing a leading =, +, - or @ with a quote stops spreadsheet apps
    // treating an address like "=cmd|..." as a formula on open. The list is
    // user-submitted text, so this is the same class of hygiene as escaping
    // it before putting it in HTML.
    /^[=+\-@]/.test(value) ? `"'${value.replace(/"/g, '""')}"` : `"${value.replace(/"/g, '""')}"`;

  const header = 'email,status,source,subscribed_at,unsubscribed_at';
  const body = rows
    .map((r) =>
      [
        escape(r.email),
        escape(r.status),
        escape(r.source),
        escape(r.createdAt.toISOString()),
        escape(r.unsubscribedAt?.toISOString() ?? ''),
      ].join(',')
    )
    .join('\n');

  return `${header}\n${body}\n`;
}
