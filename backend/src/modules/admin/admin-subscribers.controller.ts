import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { newUnsubscribeToken } from '../../utils/marketing.js';

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
        welcomeDiscountCode: { select: { code: true, usedCount: true } },
      },
    }),
    fastify.prisma.subscriber.count({ where }),
  ]);

  return paginatedResponse(subscribers, total, page, limit);
}

/**
 * Headline numbers for the subscribers screen. `last30Days` is the only one
 * that answers "is the capture actually working" — a lifetime total keeps
 * looking healthy long after the signup form has stopped converting.
 */
export async function adminSubscriberStats(fastify: FastifyInstance) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [subscribed, unsubscribed, last30Days, pendingWelcome, bySource] = await Promise.all([
    fastify.prisma.subscriber.count({ where: { status: 'SUBSCRIBED' } }),
    fastify.prisma.subscriber.count({ where: { status: 'UNSUBSCRIBED' } }),
    fastify.prisma.subscriber.count({ where: { createdAt: { gte: since } } }),
    fastify.prisma.subscriber.count({ where: { welcomeSentAt: null, status: 'SUBSCRIBED' } }),
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
    bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
  };
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
