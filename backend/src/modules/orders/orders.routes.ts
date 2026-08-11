import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createOrder, lookupOrders } from './orders.controller.js';
import { getReceiptData, getReceiptPdf } from './receipt.controller.js';
import { validateDiscountCode } from '../admin/admin-discounts.controller.js';

// Both identifiers are mandatory — the phone is the ownership proof for the
// (guessable, sequential) order number.
const lookupQuerySchema = z.object({
  phone: z.string().min(1),
  orderNumber: z.string().min(1),
});

const validateDiscountSchema = z.object({
  code: z.string().min(1),
  subtotal: z.number().int().min(0),
});

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
      const { phone, orderNumber } = lookupQuerySchema.parse(request.query);
      return lookupOrders(fastify, phone, orderNumber);
    }
  );

  fastify.get<{ Params: { orderNumber: string } }>(
    '/receipt/:orderNumber',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { phone } = request.query as { phone: string };
      return getReceiptData(fastify, request.params.orderNumber, phone || '');
    }
  );

  fastify.get<{ Params: { orderNumber: string } }>(
    '/receipt/:orderNumber/pdf',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { phone } = request.query as { phone: string };
      const pdf = await getReceiptPdf(fastify, request.params.orderNumber, phone || '');
      const safeFilename = request.params.orderNumber.replace(/[^a-zA-Z0-9\-_\/]/g, '').replace(/\//g, '-');
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `inline; filename="Ascend-MY-Receipt-${safeFilename}.pdf"`);
      reply.header('Referrer-Policy', 'no-referrer');
      return reply.send(pdf);
    }
  );

  fastify.post(
    '/validate-discount',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (request) => {
      const { code, subtotal } = validateDiscountSchema.parse(request.body);
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
