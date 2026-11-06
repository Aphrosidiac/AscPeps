import type { FastifyInstance } from 'fastify';
import {
  adminAdjust,
  adminCancelPayout,
  adminGetAffiliate,
  adminGetSettings,
  adminListAffiliates,
  adminListPayouts,
  adminMarkPayoutPaid,
  adminSaveSettings,
  adminUpdateAffiliate,
} from './affiliates.controller.js';
import { adminDecideChange, adminListChanges } from './affiliate-changes.js';

/** Admin → Affiliates. */
export default async function adminAffiliateRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  const actor = (request: { user?: { email?: string } }) => request.user?.email ?? 'admin';

  fastify.get('/settings', async () => adminGetSettings(fastify));
  fastify.put('/settings', async (request) => adminSaveSettings(fastify, request.body, actor(request)));

  fastify.get<{ Querystring: Record<string, string> }>('/payouts', async (request) => adminListPayouts(fastify, request.query));
  fastify.post<{ Params: { id: string } }>('/payouts/:id/paid', async (request) =>
    adminMarkPayoutPaid(fastify, request.params.id, request.body, actor(request))
  );
  fastify.post<{ Params: { id: string } }>('/payouts/:id/cancel', async (request) => adminCancelPayout(fastify, request.params.id, request.body, actor(request)));

  fastify.get<{ Querystring: Record<string, string> }>('/changes', async (request) => adminListChanges(fastify, request.query));
  fastify.post<{ Params: { id: string } }>('/changes/:id', async (request) =>
    adminDecideChange(fastify, request.params.id, request.body, actor(request))
  );

  fastify.get<{ Querystring: Record<string, string> }>('/', async (request) => adminListAffiliates(fastify, request.query));
  fastify.get<{ Params: { id: string } }>('/:id', async (request) => adminGetAffiliate(fastify, request.params.id));
  fastify.patch<{ Params: { id: string } }>('/:id', async (request) =>
    adminUpdateAffiliate(fastify, request.params.id, request.body, actor(request))
  );
  fastify.post<{ Params: { id: string } }>('/:id/adjust', async (request) => adminAdjust(fastify, request.params.id, request.body, actor(request)));
}
