import type { FastifyInstance } from 'fastify';
import { listInsights, getInsightBySlug } from './insights.controller.js';
import { listComments, createComment, deleteOwnComment } from './comments.controller.js';

export default async function insightRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request) => listInsights(fastify, request.query as Record<string, string>));

  // Registered before '/:slug' so the literal segment can't be swallowed by
  // the slug param.
  fastify.delete<{ Params: { id: string } }>(
    '/comments/:id',
    { preHandler: [fastify.authenticateMember] },
    async (request) => deleteOwnComment(fastify, request.params.id, request.member!.id)
  );

  fastify.get<{ Params: { slug: string } }>('/:slug', async (request) => getInsightBySlug(fastify, request.params.slug));

  fastify.get<{ Params: { slug: string } }>(
    '/:slug/comments',
    async (request) => listComments(fastify, request.params.slug)
  );

  fastify.post<{ Params: { slug: string } }>(
    '/:slug/comments',
    {
      preHandler: [fastify.authenticateMember, fastify.requireVerifiedMember],
      // Per-IP, on top of the account requirement — a signed-in spammer still
      // can't machine-gun the thread.
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    },
    async (request) => createComment(fastify, request.params.slug, request.member!.id, request.body)
  );
}
