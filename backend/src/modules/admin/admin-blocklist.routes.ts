import type { FastifyInstance } from 'fastify';
import {
  adminAddBlockEntry,
  adminBlockMember,
  adminCreateBlocked,
  adminDeleteBlocked,
  adminListBlocked,
  adminRemoveBlockEntry,
  adminUpdateBlocked,
} from './admin-blocklist.controller.js';

export default async function adminBlocklistRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);
  const actor = (request: { user?: { email?: string } }) => request.user?.email ?? null;

  fastify.get('/', async () => adminListBlocked(fastify));

  fastify.post('/', async (request) => adminCreateBlocked(fastify, request.body, actor(request)));

  fastify.post<{ Params: { memberId: string } }>('/members/:memberId', async (request) =>
    adminBlockMember(fastify, request.params.memberId, request.body, actor(request))
  );

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) => adminUpdateBlocked(fastify, request.params.id, request.body));

  fastify.post<{ Params: { id: string } }>('/:id/entries', async (request) =>
    adminAddBlockEntry(fastify, request.params.id, request.body)
  );

  fastify.delete<{ Params: { entryId: string } }>('/entries/:entryId', async (request) =>
    adminRemoveBlockEntry(fastify, request.params.entryId)
  );

  fastify.delete<{ Params: { id: string } }>('/:id', async (request) => adminDeleteBlocked(fastify, request.params.id));
}
