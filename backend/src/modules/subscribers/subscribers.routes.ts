import type { FastifyInstance } from 'fastify';
import { subscribe, unsubscribeByToken } from './subscribers.controller.js';

export default async function subscriberRoutes(fastify: FastifyInstance) {
  // Tighter than the global 100/min. Signing up costs us an outbound welcome
  // email on an address the submitter chose, which is the same abuse shape
  // members/register guards against, so it gets a comparable bucket.
  fastify.post(
    '/',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request) => subscribe(fastify, request.body)
  );

  // GET because a human reaches it by clicking the footer link in an email.
  // Not rate-limited as tightly as signup: some mail clients prefetch links,
  // and the operation is idempotent and harmless when repeated.
  fastify.get<{ Querystring: { token?: string } }>(
    '/unsubscribe',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => unsubscribeByToken(fastify, request.query.token ?? '')
  );

  // RFC 8058 one-click. Gmail/Yahoo POST here directly from the inbox UI with
  // `List-Unsubscribe=One-Click` as a form body — there is no browser, no
  // session and no confirmation step, so this must complete the opt-out on
  // its own and answer 200. @fastify/formbody (registered in server.ts) is
  // what lets the form-encoded body parse at all; without it this 415s and
  // the mail client reports the unsubscribe as failed.
  fastify.post<{ Querystring: { token?: string } }>(
    '/unsubscribe',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => unsubscribeByToken(fastify, request.query.token ?? '')
  );
}
