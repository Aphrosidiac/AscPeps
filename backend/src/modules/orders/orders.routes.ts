import type { FastifyInstance } from 'fastify';
import { createOrder, lookupOrders } from './orders.controller.js';

export default async function orderRoutes(fastify: FastifyInstance) {
  fastify.post('/', async (request) => {
    return createOrder(fastify, request.body);
  });

  fastify.get('/lookup', async (request) => {
    const { phone } = request.query as { phone: string };
    return lookupOrders(fastify, phone);
  });
}
