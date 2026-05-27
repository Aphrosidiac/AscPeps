import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { refundBill } from '../../utils/billplz.js';

const updateOrderSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  notes: z.string().optional(),
});

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

const VALID_PAYMENT_TRANSITIONS: Record<string, string[]> = {
  UNPAID: ['PAID', 'FAILED'],
  PAID: ['REFUNDED'],
  FAILED: ['UNPAID'],
  REFUNDED: [],
};

export async function adminListOrders(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = {};
  if (query.status) where.status = query.status;
  if (query.search) {
    where.OR = [
      { orderNumber: { contains: query.search, mode: 'insensitive' } },
      { customerName: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search } },
    ];
  }

  const [orders, total] = await Promise.all([
    fastify.prisma.order.findMany({
      where,
      include: {
        items: { include: { product: { select: { name: true, code: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.order.count({ where }),
  ]);

  return paginatedResponse(orders, total, page, limit);
}

export async function adminGetOrder(fastify: FastifyInstance, id: string) {
  const order = await fastify.prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: true } },
    },
  });

  if (!order) throw { statusCode: 404, message: 'Order not found' };
  return order;
}

export async function adminUpdateOrder(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateOrderSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };

  if (data.status) {
    const allowed = VALID_STATUS_TRANSITIONS[order.status] || [];
    if (!allowed.includes(data.status)) {
      throw { statusCode: 400, message: `Cannot change status from ${order.status} to ${data.status}` };
    }
  }

  if (data.paymentStatus) {
    const allowed = VALID_PAYMENT_TRANSITIONS[order.paymentStatus] || [];
    if (!allowed.includes(data.paymentStatus)) {
      throw { statusCode: 400, message: `Cannot change payment from ${order.paymentStatus} to ${data.paymentStatus}` };
    }
    if (data.paymentStatus === 'FAILED' && order.paymentStatus === 'UNPAID') {
      for (const item of order.items) {
        await fastify.prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
    if (data.paymentStatus === 'REFUNDED' && order.paymentRef && order.paymentGateway === 'billplz') {
      try {
        await refundBill(order.paymentRef, `Refund for order ${order.orderNumber}`);
        fastify.log.info(`Billplz refund initiated for order ${order.orderNumber}`);
      } catch (err) {
        fastify.log.error({ err, orderId: order.id }, 'Billplz refund failed');
        throw { statusCode: 400, message: 'Refund API call failed — check logs for details' };
      }
      for (const item of order.items) {
        await fastify.prisma.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    }
  }

  return fastify.prisma.order.update({ where: { id }, data });
}
