import type { FastifyInstance } from 'fastify';
import { handlePaymentCallback, handlePaymentRedirect } from './payments.controller.js';

export default async function paymentRoutes(fastify: FastifyInstance) {
  // Generous limit (gateways retry) but not unbounded — a forged-callback flood
  // still costs a signature check + DB lookup each.
  fastify.post('/callback', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request) => {
    const body = request.body as Record<string, string>;
    return handlePaymentCallback(fastify, body);
  });

  fastify.get('/redirect', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const redirectUrl = await handlePaymentRedirect(fastify, query);
    return reply.redirect(redirectUrl);
  });
}
