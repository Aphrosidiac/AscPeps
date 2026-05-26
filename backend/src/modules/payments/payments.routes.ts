import type { FastifyInstance } from 'fastify';
import { handlePaymentCallback, handlePaymentRedirect } from './payments.controller.js';

export default async function paymentRoutes(fastify: FastifyInstance) {
  fastify.post('/callback', async (request) => {
    const body = request.body as Record<string, string>;
    return handlePaymentCallback(fastify, body);
  });

  fastify.get('/redirect', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const redirectUrl = handlePaymentRedirect(query);
    return reply.redirect(redirectUrl);
  });
}
