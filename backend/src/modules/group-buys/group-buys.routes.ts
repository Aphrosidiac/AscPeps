import type { FastifyInstance } from 'fastify';
import { getGroupBuy, getGroupBuyPromo, getMyGroupBuys, listGroupBuys, signupToGroupBuy } from './group-buys.controller.js';
import { REFUSAL, identityFrom, screen } from '../../utils/blocklist.js';

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
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' }, blocklist: 'screen' } },
    async (request) => {
      if (await screen(fastify, request, 'group-buy', identityFrom(request.body))) {
        throw { statusCode: 403, message: REFUSAL };
      }
      return signupToGroupBuy(fastify, request, request.params.slug);
    }
  );
}
