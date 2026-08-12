import type { FastifyInstance } from 'fastify';
import { handleBtcpayWebhook } from './btcpay-webhook.controller.js';

// Public — BTCPay Server calls this directly from its own server, not an
// admin user, so no fastify.authenticate preHandler here.
export default async function btcpayWebhookRoutes(fastify: FastifyInstance) {
  // BTCPay's HMAC signature is computed over the RAW request bytes —
  // re-serializing Fastify's default parsed-JSON body would produce a
  // different byte string than what BTCPay signed, breaking verification
  // every time. Scoped to this plugin only, same as the Resend webhook.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  fastify.post('/', async (request, reply) => {
    const { statusCode, body } = await handleBtcpayWebhook(
      fastify,
      request.body as Buffer,
      request.headers as Record<string, string | string[] | undefined>
    );
    return reply.status(statusCode).send(body);
  });
}
