import type { FastifyInstance } from 'fastify';
import { adminListOrders, adminGetOrder, adminUpdateOrder } from './admin-orders.controller.js';

export default async function adminOrderRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => {
    return adminListOrders(fastify, request.query as Record<string, string>);
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    return adminGetOrder(fastify, request.params.id);
  });

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) => {
    return adminUpdateOrder(fastify, request.params.id, request.body);
  });
}
