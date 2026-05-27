import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
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
    fastify.log.warn({ gateway: gateway.name, body }, 'Payment callback: invalid signature');
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

  if (order.paymentStatus === 'PAID' || order.paymentStatus === 'FAILED') {
    return { status: 'ok' };
  }

  if (result.paid) {
    const { count } = await fastify.prisma.order.updateMany({
      where: { id: order.id, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PAID', status: 'CONFIRMED' },
    });
    if (count === 0) return { status: 'ok' };
    fastify.log.info(`Order ${order.orderNumber} paid via ${gateway.name} (bill ${result.billId})`);
  } else {
    const { count } = await fastify.prisma.order.updateMany({
      where: { id: order.id, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'FAILED' },
    });
    if (count === 0) return { status: 'ok' };
    const failedOrder = await fastify.prisma.order.findUnique({
      where: { id: order.id },
      include: { items: true },
    });
    if (failedOrder) {
      for (const item of failedOrder.items) {
        await fastify.prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
      if (failedOrder.discountCodeId) {
        await fastify.prisma.discountCode.update({
          where: { id: failedOrder.discountCodeId },
          data: { usedCount: { decrement: 1 } },
        });
      }
    }
    fastify.log.info(`Order ${order.orderNumber} payment failed via ${gateway.name} — stock & discount restored`);
  }

  return { status: 'ok' };
}

export function handlePaymentRedirect(query: Record<string, string>) {
  const isBillplz = !!query['billplz[id]'];
  const gatewayName = isBillplz ? 'billplz' : 'toyyibpay';
  const billId = isBillplz ? query['billplz[id]'] : query.billcode || '';

  const gateway = getGatewayByBillId(billId, gatewayName);
  if (!gateway) return `${env.FRONTEND_URL}/checkout/failed`;

  return gateway.buildRedirectUrl(query);
}
