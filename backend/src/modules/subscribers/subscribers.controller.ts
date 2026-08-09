import type { FastifyInstance } from 'fastify';
import type { Prisma, SubscriberSource } from '@prisma/client';
import { z } from 'zod';
import { newUnsubscribeToken } from '../../utils/marketing.js';

const subscribeSchema = z.object({
  email: z
    .string()
    .email()
    // RFC 5321's practical ceiling. Without it a multi-kilobyte "address"
    // still passes .email() in some shapes and lands in the database.
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  source: z.enum(['FOOTER', 'CHECKOUT']).default('FOOTER'),
  // Honeypot. Hidden from real users by CSS, so anything non-empty here is a
  // bot filling every field it can see in the DOM. Named `website` rather
  // than something obviously fake because scrapers skip fields called `hp`.
  website: z.string().optional(),
});

/**
 * Add an address to the marketing list.
 *
 * Always answers the same `{ ok: true }` whatever happened — new signup,
 * already on the list, previously unsubscribed, or a bot caught by the
 * honeypot. That uniformity is the point: a response that distinguished
 * "added" from "already subscribed" would be an email-enumeration oracle,
 * letting anyone test whether a given address belongs to a customer of a site
 * that sells controlled research compounds. That is a materially worse leak
 * here than on a normal shop, and the honest UX cost is one vaguer success
 * message.
 *
 * The welcome email is NOT sent from here. It is picked up by the welcome
 * sweep (utils/welcome-sweep.ts) off `welcomeSentAt: null`, so a Resend
 * outage during signup delays the welcome instead of losing it — and the
 * person's discount code with it.
 */
export async function subscribe(fastify: FastifyInstance, body: unknown) {
  const data = subscribeSchema.parse(body);

  // Silently accept and discard. Returning an error would tell the bot which
  // field is the trap; returning success costs nothing and wastes its time.
  if (data.website && data.website.trim() !== '') {
    fastify.log.info({ source: data.source }, 'newsletter signup rejected by honeypot');
    return { ok: true };
  }

  const existing = await fastify.prisma.subscriber.findUnique({
    where: { email: data.email },
    select: { id: true, status: true },
  });

  if (!existing) {
    await fastify.prisma.subscriber.create({
      data: {
        email: data.email,
        source: data.source as SubscriberSource,
        unsubscribeToken: newUnsubscribeToken(),
      },
    });
    fastify.log.info({ source: data.source }, 'newsletter signup');
    return { ok: true };
  }

  if (existing.status === 'UNSUBSCRIBED') {
    // Someone who left and came back through a signup form is opting in
    // again, so honour it — but leave `source` pointing at where they first
    // came from, and leave welcomeSentAt alone so re-subscribing can't be
    // farmed for a second discount code.
    await fastify.prisma.subscriber.update({
      where: { id: existing.id },
      data: { status: 'SUBSCRIBED', unsubscribedAt: null, unsubscribeReason: null },
    });
    fastify.log.info('newsletter re-subscribe');
  }

  return { ok: true };
}

/**
 * Opt an address out by its token. Idempotent — mail clients prefetch links,
 * people click twice, and Gmail's one-click POST can arrive alongside a human
 * following the same URL, so a second call must succeed quietly rather than
 * 404 or double-write `unsubscribedAt`.
 *
 * An unknown token also returns ok. There is nothing useful to do with the
 * failure (the person cannot fix a token they did not choose), and answering
 * differently would confirm which tokens are real.
 */
export async function unsubscribeByToken(
  fastify: FastifyInstance,
  token: string,
  reason?: string
) {
  if (!token) return { ok: true };

  const subscriber = await fastify.prisma.subscriber.findUnique({
    where: { unsubscribeToken: token },
    select: { id: true, email: true, status: true },
  });
  if (!subscriber) return { ok: true };

  if (subscriber.status === 'SUBSCRIBED') {
    await fastify.prisma.subscriber.update({
      where: { id: subscriber.id },
      data: {
        status: 'UNSUBSCRIBED',
        unsubscribedAt: new Date(),
        unsubscribeReason: reason ?? null,
      },
    });
    fastify.log.info('newsletter unsubscribe');
  }

  // Safe to echo: holding the token already proves possession of an email we
  // sent to that address.
  return { ok: true, email: subscriber.email };
}

/**
 * Mark a subscriber gone because the mailbox told us to, not because the
 * person clicked. Called from the Resend webhook on a hard bounce or a spam
 * complaint.
 *
 * Continuing to mail either one is how a sending domain's reputation dies, so
 * this is not optional hygiene — it is the reason single opt-in is defensible
 * at all here.
 */
export async function suppressByEmail(
  prisma: Prisma.TransactionClient | FastifyInstance['prisma'],
  email: string,
  reason: 'bounced' | 'complained'
): Promise<boolean> {
  const { count } = await prisma.subscriber.updateMany({
    where: { email: email.trim().toLowerCase(), status: 'SUBSCRIBED' },
    data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), unsubscribeReason: reason },
  });
  return count > 0;
}
