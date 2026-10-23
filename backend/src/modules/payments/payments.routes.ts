import type { FastifyInstance } from 'fastify';
import { handlePaymentCallback, handlePaymentRedirect, handlePayLink } from './payments.controller.js';
import { clientContext } from '../../utils/payment-trail.js';

export default async function paymentRoutes(fastify: FastifyInstance) {
  // Generous limit (gateways retry) but not unbounded — a forged-callback flood
  // still costs a signature check + DB lookup each.
  fastify.post('/callback', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request) => {
    const body = request.body as Record<string, string>;
    return handlePaymentCallback(fastify, body);
  });

  // The pay link every checkout, email and retry button uses for Billplz and
  // ToyyibPay bills: records the visit, then on to the gateway's page.
  fastify.get<{ Params: { billId: string }; Querystring: { src?: string } }>(
    '/go/:billId',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const url = await handlePayLink(fastify, request.params.billId, request.query.src, clientContext(request));
      return reply.redirect(url);
    }
  );

  fastify.get('/redirect', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const redirectUrl = await handlePaymentRedirect(fastify, query);
    return reply.redirect(redirectUrl);
  });
}
