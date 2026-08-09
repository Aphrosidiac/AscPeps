import type { FastifyInstance } from 'fastify';
import { Webhook } from 'svix';
import { z } from 'zod';
import { suppressByEmail } from '../subscribers/subscribers.controller.js';

const eventSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().optional() }).passthrough(),
});

// Resend event `type` -> the EmailStatus it maps onto. Every other event type
// (email.sent, email.opened, email.clicked, ...) falls through as a safe
// no-op below: 200-ack, nothing to update.
//
// Transactional mail is still never suppressed by a bounce or complaint: the
// customer is owed their receipt regardless, and an order email has nowhere
// else to go. Marketing mail is the opposite — see the suppression block at
// the bottom, which takes the recipient off the newsletter list on either
// event, no matter which kind of email triggered it. Someone who marks an
// order receipt as spam has told us plainly not to send them a newsletter.
const STATUS_BY_EVENT: Record<string, 'DELIVERED' | 'BOUNCED' | 'COMPLAINED'> = {
  'email.delivered': 'DELIVERED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
};

/**
 * Verify + handle one Resend webhook delivery. Always fails closed: no
 * RESEND_WEBHOOK_SECRET, or a signature that doesn't check out, means a 400
 * and nothing else happens — the payload is never inspected, let alone
 * applied, unless it's verified first.
 */
export async function handleResendWebhook(
  fastify: FastifyInstance,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    fastify.log.warn('Resend webhook received but RESEND_WEBHOOK_SECRET is not set — rejecting');
    return { statusCode: 400, body: { error: 'Webhook not configured' } };
  }

  const svixHeaders = {
    'svix-id': String(headers['svix-id'] ?? ''),
    'svix-timestamp': String(headers['svix-timestamp'] ?? ''),
    'svix-signature': String(headers['svix-signature'] ?? ''),
  };

  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(rawBody, svixHeaders);
  } catch (err) {
    fastify.log.warn({ err }, 'Resend webhook: signature verification failed');
    return { statusCode: 400, body: { error: 'Invalid signature' } };
  }

  const parsed = eventSchema.safeParse(payload);
  const status = parsed.success ? STATUS_BY_EVENT[parsed.data.type] : undefined;
  const emailId = parsed.success ? parsed.data.data.email_id : undefined;

  // Verified, but not an event type we track (or missing the id we'd match
  // on) — still 200, just nothing to do. Resend/svix retry on non-200, and
  // there's nothing here that a retry would fix.
  if (!status || !emailId) {
    return { statusCode: 200, body: { received: true } };
  }

  // No matching row is a normal, silent no-op — could be an event for a
  // message this app never tracked, or a timing race with the send. A given
  // message id lives in exactly one of these two tables, so both run and at
  // most one matches.
  const [, campaignUpdated] = await Promise.all([
    fastify.prisma.emailOutbox.updateMany({ where: { resendId: emailId }, data: { status } }),
    fastify.prisma.campaignRecipient.updateMany({ where: { resendId: emailId }, data: { status } }),
  ]);

  if (status === 'BOUNCED' || status === 'COMPLAINED') {
    // Resolve the address from whichever table owns the message rather than
    // trusting the webhook payload's own `to` field — these two tables are
    // what this app actually sent, and matching on the id we stored keeps a
    // forged-but-somehow-verified payload from suppressing a stranger.
    const [outboxRow, campaignRow] = await Promise.all([
      fastify.prisma.emailOutbox.findFirst({ where: { resendId: emailId }, select: { toEmail: true } }),
      campaignUpdated.count > 0
        ? fastify.prisma.campaignRecipient.findFirst({ where: { resendId: emailId }, select: { toEmail: true } })
        : null,
    ]);
    const toEmail = outboxRow?.toEmail ?? campaignRow?.toEmail;
    if (toEmail) {
      const suppressed = await suppressByEmail(
        fastify.prisma,
        toEmail,
        status === 'BOUNCED' ? 'bounced' : 'complained'
      );
      if (suppressed) {
        fastify.log.info({ status }, 'subscriber suppressed from marketing list');
      }
    }
  }

  return { statusCode: 200, body: { received: true } };
}
