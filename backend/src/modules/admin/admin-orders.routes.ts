import type { FastifyInstance } from 'fastify';
import { adminListOrders, adminGetOrder, adminUpdateOrder } from './admin-orders.controller.js';
import { adminGetReceiptPdf } from '../orders/receipt.controller.js';

export default async function adminOrderRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    // Accept JWT from Authorization header or ?token= query param (for PDF download links)
    const { token } = request.query as { token?: string };
    if (token && !request.headers.authorization) {
      request.headers.authorization = `Bearer ${token}`;
    }
    return fastify.authenticate(request, reply);
  });

  fastify.get('/', async (request) => {
    return adminListOrders(fastify, request.query as Record<string, string>);
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    return adminGetOrder(fastify, request.params.id);
  });

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) => {
    return adminUpdateOrder(fastify, request.params.id, request.body);
  });

  fastify.get<{ Params: { id: string } }>('/:id/receipt', async (request, reply) => {
    const pdf = await adminGetReceiptPdf(fastify, request.params.id);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'inline; filename="ASCEND-Receipt.pdf"');
    reply.header('Referrer-Policy', 'no-referrer');
    return reply.send(pdf);
  });
}
