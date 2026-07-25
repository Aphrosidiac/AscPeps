import type { FastifyInstance } from 'fastify';
import { adminListEmails, adminPreviewEmail, adminRetryFailedEmails, adminSendTestEmail } from './admin-emails.controller.js';

export default async function adminEmailRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => {
    return adminListEmails(fastify, request.query as Record<string, string>);
  });

  fastify.get('/preview', async (request) => {
    return adminPreviewEmail(fastify, request.query as Record<string, string>);
  });

  fastify.post('/retry-failed', async () => {
    return adminRetryFailedEmails(fastify);
  });

  fastify.post('/test-send', async (request) => {
    return adminSendTestEmail(fastify, request.body);
  });
}
