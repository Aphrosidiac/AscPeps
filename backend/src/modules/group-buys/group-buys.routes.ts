import type { FastifyInstance } from 'fastify';
import { getGroupBuy, getGroupBuyPromo, getMyGroupBuys, listGroupBuys, signupToGroupBuy } from './group-buys.controller.js';

export default async function groupBuyRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => listGroupBuys(fastify));

  // Registered before '/:slug' so these names are never read as a batch slug.
  fastify.get('/promo', async () => getGroupBuyPromo(fastify));

  fastify.get('/mine', { preHandler: [fastify.authenticateMember] }, async (request) =>
    getMyGroupBuys(fastify, request.member!)
  );

  fastify.get<{ Params: { slug: string } }>('/:slug', async (request) => getGroupBuy(fastify, request.params.slug, request));

  fastify.post<{ Params: { slug: string } }>(
    '/:slug/signup',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => signupToGroupBuy(fastify, request, request.params.slug)
  );
}
