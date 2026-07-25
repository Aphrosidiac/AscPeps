import type { FastifyInstance } from 'fastify';
import { Webhook } from 'svix';
import { z } from 'zod';

const eventSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().optional() }).passthrough(),
});

// Resend event `type` -> the EmailStatus it maps onto. Every other event type
// (email.sent, email.opened, email.clicked, ...) falls through as a safe
// no-op below: 200-ack, nothing to update. No suppression logic here by
// design — a bounce/complaint is only surfaced as a status, never acted on
// automatically (e.g. blocking future sends to the address).
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
  // message this app never tracked, or a timing race with the send.
  await fastify.prisma.emailOutbox.updateMany({
    where: { resendId: emailId },
    data: { status },
  });

  return { statusCode: 200, body: { received: true } };
}
