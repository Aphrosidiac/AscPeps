import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { verifyWebhookSignature } from '../../utils/btcpay.js';
import { applyPaid, applyFailed } from '../../utils/payment-reconcile.js';

const eventSchema = z.object({ type: z.string(), invoiceId: z.string() });

/**
 * Verify + handle one BTCPay webhook delivery. Always fails closed: no
 * BTCPAY_WEBHOOK_SECRET, or a signature that doesn't check out, means a 400
 * and nothing else happens — same contract as the Resend webhook handler.
 *
 * This is the primary confirmation path for btcpay orders (there is no
 * gateway callback fallback the way billplz has one) — the redirect-time
 * verify in payments.controller.ts and the reconcile sweep both exist as
 * backstops for a customer who never returns to the redirect URL, or a
 * webhook delivery that never arrives.
 */
export async function handleBtcpayWebhook(
  fastify: FastifyInstance,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const secret = env.BTCPAY_WEBHOOK_SECRET;
  if (!secret) {
    fastify.log.warn('BTCPay webhook received but BTCPAY_WEBHOOK_SECRET is not set — rejecting');
    return { statusCode: 400, body: { error: 'Webhook not configured' } };
  }

  const sigHeader = headers['btcpay-sig'];
  const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!verifyWebhookSignature(rawBody, sig, secret)) {
    fastify.log.warn('BTCPay webhook: signature verification failed');
    return { statusCode: 400, body: { error: 'Invalid signature' } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { statusCode: 400, body: { error: 'Invalid JSON' } };
  }

  const parsed = eventSchema.safeParse(payload);
  // Verified, but not a shape we recognise — still 200 so BTCPay doesn't
  // retry forever; there's nothing a retry would fix.
  if (!parsed.success) {
    return { statusCode: 200, body: { received: true } };
  }
  const { type, invoiceId } = parsed.data;

  const order = await fastify.prisma.order.findFirst({
    where: { paymentRef: invoiceId, paymentGateway: 'btcpay' },
  });
  if (!order) {
    fastify.log.warn(`BTCPay webhook: no order for invoice ${invoiceId}`);
    return { statusCode: 200, body: { received: true } };
  }
  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'FAILED') {
    return { statusCode: 200, body: { received: true } };
  }

  if (type === 'InvoiceSettled') {
    const paid = await applyPaid(fastify, order);
    if (paid) fastify.log.info(`Order ${order.orderNumber} paid via btcpay (invoice ${invoiceId})`);
  } else if (type === 'InvoiceExpired' || type === 'InvoiceInvalid') {
    // Expired = the invoice ran out with nothing sent; Invalid = a payment was
    // seen and rejected. Same split BTCPay's own invoice status makes.
    await applyFailed(fastify, order.id, {
      reason: type === 'InvoiceInvalid' ? 'DECLINED' : 'NO_ATTEMPT',
    });
    fastify.log.info(`Order ${order.orderNumber} payment failed via btcpay (invoice ${invoiceId})`);
  }
  // InvoiceCreated / InvoiceProcessing / others: no-op, wait for a final event.

  return { statusCode: 200, body: { received: true } };
}
