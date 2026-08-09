import type { FastifyInstance } from 'fastify';
import {
  adminListCampaigns,
  adminGetCampaign,
  adminAudienceCount,
  adminCreateCampaign,
  adminUpdateCampaign,
  adminDeleteCampaign,
  adminSendTestCampaign,
  adminSendCampaign,
} from './admin-campaigns.controller.js';

export default async function adminCampaignRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request) =>
    adminListCampaigns(fastify, request.query as Record<string, string>)
  );

  // Registered before '/:id' so "audience-count" can't be swallowed as an id.
  fastify.get('/audience-count', async (request) =>
    adminAudienceCount(fastify, request.query as Record<string, string>)
  );

  fastify.get('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return adminGetCampaign(fastify, id);
  });

  fastify.post('/', async (request) => adminCreateCampaign(fastify, request.body));

  fastify.patch('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return adminUpdateCampaign(fastify, id, request.body);
  });

  fastify.delete('/:id', async (request) => {
    const { id } = request.params as { id: string };
    return adminDeleteCampaign(fastify, id);
  });

  fastify.post('/:id/test', async (request) => {
    const { id } = request.params as { id: string };
    return adminSendTestCampaign(fastify, id, request.body);
  });

  // The one irreversible action in this module — there is no unsend, which is
  // why the UI gates it behind a typed confirmation showing the headcount.
  fastify.post('/:id/send', async (request) => {
    const { id } = request.params as { id: string };
    return adminSendCampaign(fastify, id);
  });
}
