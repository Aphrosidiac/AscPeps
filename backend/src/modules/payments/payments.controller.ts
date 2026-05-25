import type { FastifyInstance } from 'fastify';
import { verifyCallbackSignature, verifyRedirectSignature } from '../../utils/billplz.js';
import { env } from '../../config/env.js';

export async function handleBillplzCallback(fastify: FastifyInstance, body: Record<string, string>) {
  if (!verifyCallbackSignature(body)) {
    fastify.log.warn('Billplz callback: invalid signature');
    throw { statusCode: 400, message: 'Invalid signature' };
  }

  const billId = body.id;
  const paid = body.paid === 'true';
  const state = body.state;

  const order = await fastify.prisma.order.findFirst({
    where: { paymentRef: billId },
  });

  if (!order) {
    fastify.log.warn(`Billplz callback: no order found for bill ${billId}`);
    return { status: 'ok' };
  }

  if (order.paymentStatus === 'PAID') {
    return { status: 'ok' };
  }

  if (paid && state === 'paid') {
    await fastify.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PAID',
        status: 'CONFIRMED',
      },
    });
    fastify.log.info(`Order ${order.orderNumber} paid via Billplz (bill ${billId})`);
  } else {
    await fastify.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'FAILED' },
    });
    fastify.log.info(`Order ${order.orderNumber} payment failed (bill ${billId})`);
  }

  return { status: 'ok' };
}

export function handleBillplzRedirect(query: Record<string, string>) {
  const valid = verifyRedirectSignature(query);
  const paid = query['billplz[paid]'] === 'true';
  const billId = query['billplz[id]'] || '';

  const frontendUrl = env.FRONTEND_URL || 'https://ascendpeptides.my';

  if (valid && paid) {
    return `${frontendUrl}/checkout/success?bill=${billId}`;
  } else {
    return `${frontendUrl}/checkout/failed?bill=${billId}`;
  }
}
