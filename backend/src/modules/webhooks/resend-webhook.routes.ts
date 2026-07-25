import type { FastifyInstance } from 'fastify';
import { handleResendWebhook } from './resend-webhook.controller.js';

// Public — Resend calls this directly from their servers, not an admin user,
// so no fastify.authenticate preHandler here (unlike every other admin-emails
// route).
export default async function resendWebhookRoutes(fastify: FastifyInstance) {
  // svix signature verification needs the RAW request bytes — re-serializing
  // Fastify's default parsed-JSON body would produce a different byte string
  // than what Resend signed, breaking verification every time. formbody/
  // multipart are already registered globally in server.ts for every other
  // route, so rather than touch that, override the content-type parser only
  // for THIS plugin: addContentTypeParser is encapsulated in the scope it's
  // declared in (see node_modules/fastify/docs/Reference/ContentTypeParser.md),
  // so this only applies to routes registered on this `fastify` instance.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });

  fastify.post('/', async (request, reply) => {
    const { statusCode, body } = await handleResendWebhook(
      fastify,
      request.body as Buffer,
      request.headers as Record<string, string | string[] | undefined>
    );
    return reply.status(statusCode).send(body);
  });
}
