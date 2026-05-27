import type { FastifyInstance } from 'fastify';
import { adminListDiscounts, adminCreateDiscount, adminUpdateDiscount, adminDeleteDiscount } from './admin-discounts.controller.js';

export default async function adminDiscountRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request) => {
    return adminListDiscounts(fastify, request.query as Record<string, string>);
  });

  fastify.post('/', async (request) => {
    return adminCreateDiscount(fastify, request.body);
  });

  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return adminUpdateDiscount(fastify, id, request.body);
  });

  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return adminDeleteDiscount(fastify, id);
  });
}
