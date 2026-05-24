import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

const updateOrderSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  notes: z.string().optional(),
});

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
  return fastify.prisma.order.update({ where: { id }, data });
}
