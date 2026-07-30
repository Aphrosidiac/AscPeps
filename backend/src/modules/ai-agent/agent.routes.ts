import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { handleMessage, type InboundMessage } from './agent.service.js';

// The worker → API hop. This endpoint can run every tool the agent has, so it
// is guarded exactly like the worker's own control plane: localhost source
// address AND the shared bearer token. It is registered outside the admin JWT
// scope because the caller is a process, not a logged-in human.
export default async function internalAgentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // `trustProxy: 1` is set on this server, so request.ip is the client
    // address as forwarded by nginx. The worker connects over the loopback
    // interface directly and never passes through nginx, so it presents as
    // 127.0.0.1 — anything else did come through the proxy and is not the worker.
    const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!allowed.includes(request.ip)) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    if ((request.headers.authorization || '') !== `Bearer ${env.WORKER_HTTP_TOKEN}`) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  fastify.post('/inbound', async (request, reply) => {
    const body = request.body as Partial<InboundMessage>;
    if (!body?.senderPhone || typeof body.text !== 'string') {
      return reply.status(400).send({ error: 'senderPhone and text are required' });
    }

    const msg: InboundMessage = {
      kind: body.kind === 'group' ? 'group' : 'dm',
      senderPhone: body.senderPhone,
      senderName: body.senderName ?? null,
      text: body.text,
      groupJid: body.groupJid,
      groupSubject: body.groupSubject,
      mentionsBot: body.mentionsBot ?? true,
    };

    const outcome = await handleMessage(fastify, msg);
    return reply.send(outcome);
  });
}
