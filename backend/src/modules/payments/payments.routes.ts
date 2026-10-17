import type { FastifyInstance } from 'fastify';
import { handlePaymentCallback, handlePaymentRedirect, handleChipCallback } from './payments.controller.js';

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

  // CHIP signs the raw JSON bytes, so this one route needs the body unparsed.
  // Registered in its own child context so the buffer parser can't leak into
  // /callback above, which must keep receiving form-encoded objects.
  fastify.register(async (chip) => {
    chip.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });
    chip.post('/chip/callback', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
      const header = request.headers['x-signature'];
      const { statusCode, body } = await handleChipCallback(
        chip,
        request.body as Buffer,
        Array.isArray(header) ? header[0] : header
      );
      return reply.status(statusCode).send(body);
    });
  });
}
