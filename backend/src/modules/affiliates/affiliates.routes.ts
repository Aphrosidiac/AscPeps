import type { FastifyInstance } from 'fastify';
import {
  checkCode,
  getMyAffiliate,
  getProgramme,
  joinProgramme,
  listMyEntries,
  listMyOrders,
  listMyPayouts,
  requestMyPayout,
  suggestMyCode,
  updateMyAffiliate,
} from './affiliates.controller.js';

/** affiliate.ascendpeptides.my's API. Signed in with the store account. */
export default async function affiliateRoutes(fastify: FastifyInstance) {
  fastify.get('/programme', async () => getProgramme(fastify));

  fastify.get('/me', { preHandler: [fastify.authenticateMember] }, async (request) => getMyAffiliate(fastify, request.member!.id));

  fastify.get<{ Querystring: { code?: string; name?: string } }>(
    '/code',
    { preHandler: [fastify.authenticateMember], config: { rateLimit: { max: 40, timeWindow: '1 minute' } } },
    async (request) => (request.query.code ? checkCode(fastify, request.query.code) : suggestMyCode(fastify, request.query.name ?? ''))
  );

  // A payout goes to a real person: the email has to be confirmed first.
  fastify.post(
    '/join',
    { preHandler: [fastify.authenticateMember, fastify.requireVerifiedMember], config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => joinProgramme(fastify, request.member!, request.body)
  );

  fastify.patch(
    '/me',
    { preHandler: [fastify.authenticateMember], config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => updateMyAffiliate(fastify, request.member!.id, request.body)
  );

  fastify.get<{ Querystring: Record<string, string> }>('/orders', { preHandler: [fastify.authenticateMember] }, async (request) =>
    listMyOrders(fastify, request.member!.id, request.query)
  );

  fastify.get('/entries', { preHandler: [fastify.authenticateMember] }, async (request) => listMyEntries(fastify, request.member!.id));

  fastify.get('/payouts', { preHandler: [fastify.authenticateMember] }, async (request) => listMyPayouts(fastify, request.member!.id));

  fastify.post(
    '/payouts',
    { preHandler: [fastify.authenticateMember, fastify.requireVerifiedMember], config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => requestMyPayout(fastify, request.member!.id)
  );
}
