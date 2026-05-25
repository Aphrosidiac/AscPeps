import type { FastifyInstance } from 'fastify';
import { handleBillplzCallback, handleBillplzRedirect } from './payments.controller.js';

export default async function paymentRoutes(fastify: FastifyInstance) {
  fastify.post('/billplz/callback', async (request, reply) => {
    const body = request.body as Record<string, string>;
    return handleBillplzCallback(fastify, body);
  });

  fastify.get('/billplz/redirect', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const redirectUrl = handleBillplzRedirect(query);
    return reply.redirect(redirectUrl);
  });
}
