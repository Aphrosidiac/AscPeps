import type { FastifyInstance } from 'fastify';
import { createOrder, lookupOrders } from './orders.controller.js';
import { validateDiscountCode } from '../admin/admin-discounts.controller.js';

export default async function orderRoutes(fastify: FastifyInstance) {
  fastify.post('/', async (request) => {
    return createOrder(fastify, request.body);
  });

  fastify.get('/lookup', async (request) => {
    const { phone } = request.query as { phone: string };
    return lookupOrders(fastify, phone);
  });

  fastify.post('/validate-discount', async (request) => {
    const { code, subtotal } = request.body as { code: string; subtotal: number };
    const { discount, discountAmount } = await validateDiscountCode(fastify, code, subtotal);
    return {
      code: discount.code,
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      discountAmount,
    };
  });
}
