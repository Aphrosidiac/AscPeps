import type { FastifyInstance } from 'fastify';
import { createOrder, lookupOrders } from './orders.controller.js';
import { validateDiscountCode } from '../admin/admin-discounts.controller.js';

export default async function orderRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      return createOrder(fastify, request.body);
    }
  );

  fastify.get(
    '/lookup',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { phone, orderNumber } = request.query as { phone: string; orderNumber: string };
      return lookupOrders(fastify, phone, orderNumber);
    }
  );

  fastify.post(
    '/validate-discount',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const { code, subtotal } = request.body as { code: string; subtotal: number };
      const { discount, discountAmount } = await validateDiscountCode(fastify, code, subtotal);
      return {
        code: discount.code,
        discountType: discount.discountType,
        discountValue: discount.discountValue,
        discountAmount,
      };
    }
  );
}
