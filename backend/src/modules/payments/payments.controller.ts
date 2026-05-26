import type { FastifyInstance } from 'fastify';
import { getGatewayByBillId } from '../../utils/payment-gateway.js';

export async function handlePaymentCallback(fastify: FastifyInstance, body: Record<string, string>) {
  const isBillplz = !!body.x_signature;
  const billId = isBillplz ? body.id : body.billcode;
  const gatewayName = isBillplz ? 'billplz' : 'toyyibpay';

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) {
    fastify.log.warn(`Payment callback: unknown gateway for bill ${billId}`);
    return { status: 'ok' };
  }

  if (!gateway.verifyCallback(body)) {
    fastify.log.warn(`${gateway.name} callback: invalid signature`);
    throw { statusCode: 400, message: 'Invalid signature' };
  }

  const result = gateway.parseCallback(body);

  const order = await fastify.prisma.order.findFirst({
    where: { paymentRef: result.billId },
  });

  if (!order) {
    fastify.log.warn(`${gateway.name} callback: no order for bill ${result.billId}`);
    return { status: 'ok' };
  }

  if (order.paymentStatus === 'PAID') {
    return { status: 'ok' };
  }

  if (result.paid) {
    await fastify.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
    });
    fastify.log.info(`Order ${order.orderNumber} paid via ${gateway.name} (bill ${result.billId})`);
  } else {
    await fastify.prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'FAILED' },
    });
    fastify.log.info(`Order ${order.orderNumber} payment failed via ${gateway.name} (bill ${result.billId})`);
  }

  return { status: 'ok' };
}

export function handlePaymentRedirect(query: Record<string, string>) {
  const isBillplz = !!query['billplz[id]'];
  const gatewayName = isBillplz ? 'billplz' : 'toyyibpay';
  const billId = isBillplz ? query['billplz[id]'] : query.billcode || '';

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) return 'https://ascendpeptides.my/checkout/failed';

  return gateway.buildRedirectUrl(query);
}
