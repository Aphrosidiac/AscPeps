import type { FastifyInstance } from 'fastify';
import {
  adminListComments,
  adminSetCommentHidden,
  adminDeleteComment,
  adminSetMemberBanned,
} from './admin-comments.controller.js';

export default async function adminCommentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => adminListComments(fastify, request.query as Record<string, string>));

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) =>
    adminSetCommentHidden(fastify, request.params.id, request.body)
  );

  fastify.delete<{ Params: { id: string } }>('/:id', async (request) =>
    adminDeleteComment(fastify, request.params.id)
  );

  fastify.patch<{ Params: { memberId: string } }>('/members/:memberId', async (request) =>
    adminSetMemberBanned(fastify, request.params.memberId, request.body)
  );
}
