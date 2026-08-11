import type { FastifyInstance } from 'fastify';
import {
  adminListSubscribers,
  adminSubscriberStats,
  adminCreateSubscriber,
  adminUnsubscribe,
  adminRetryWelcome,
  adminDeleteSubscriber,
  adminExportSubscribers,
  adminPreviewWelcome,
} from './admin-subscribers.controller.js';

export default async function adminSubscriberRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request) =>
    adminListSubscribers(fastify, request.query as Record<string, string>)
  );

  fastify.get('/stats', async () => adminSubscriberStats(fastify));

  fastify.get('/preview-welcome', async (request) =>
    adminPreviewWelcome(fastify, request.query as Record<string, string>)
  );

  fastify.get('/export', async (request, reply) => {
    const csv = await adminExportSubscribers(fastify, request.query as Record<string, string>);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="ascend-subscribers.csv"')
      .send(csv);
  });

  fastify.post('/', async (request) => adminCreateSubscriber(fastify, request.body));

  fastify.post('/:id/unsubscribe', async (request) => {
    const { id } = request.params as { id: string };
    return adminUnsubscribe(fastify, id);
  });

  fastify.post('/:id/retry-welcome', async (request) => {
    const { id } = request.params as { id: string };
    return adminRetryWelcome(fastify, id);
  });

  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return adminDeleteSubscriber(fastify, id);
  });
}
