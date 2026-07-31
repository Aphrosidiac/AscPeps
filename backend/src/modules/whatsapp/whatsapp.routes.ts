import type { FastifyInstance } from 'fastify';
import {
  connectWhatsApp,
  deleteOperator,
  disconnectWhatsApp,
  getConversation,
  getWhatsAppQR,
  getWhatsAppStatus,
  listConversations,
  listOperators,
  listToolCalls,
  bindUnknownSender,
  dismissUnknownSender,
  listUnknownSenders,
  listWhatsAppGroups,
  sendTestMessage,
  stopWhatsApp,
  upsertGroup,
  upsertOperator,
} from './whatsapp.controller.js';

export default async function whatsappRoutes(fastify: FastifyInstance) {
  // Everything here is admin-only: pairing the number, granting an operator
  // write access, and reading the agent's conversation history are all
  // equivalent to admin capability.
  fastify.addHook('onRequest', fastify.authenticate);

  // Connection
  fastify.get('/status', getWhatsAppStatus);
  fastify.get('/qr', getWhatsAppQR);
  fastify.post('/connect', connectWhatsApp);
  fastify.post('/stop', stopWhatsApp);
  fastify.post('/disconnect', disconnectWhatsApp);
  fastify.post('/send', sendTestMessage);

  // Groups the connected number is in, annotated with whether the agent is on.
  fastify.get('/groups', async (request, reply) => listWhatsAppGroups(fastify, request, reply));

  // Allowlists
  fastify.get('/operators', async () => listOperators(fastify));
  fastify.post('/operators', async (request) => upsertOperator(fastify, request.body));
  fastify.delete<{ Params: { id: string } }>('/operators/:id', async (request) =>
    deleteOperator(fastify, request.params.id)
  );
  fastify.post('/groups', async (request) => upsertGroup(fastify, request.body));

  // Unrecognised senders (the WhatsApp LID binding flow)
  fastify.get('/unknown-senders', async () => listUnknownSenders(fastify));
  fastify.post('/unknown-senders/bind', async (request) => bindUnknownSender(fastify, request.body));
  fastify.delete<{ Params: { id: string } }>('/unknown-senders/:id', async (request) =>
    dismissUnknownSender(fastify, decodeURIComponent(request.params.id))
  );

  // Conversations + audit
  fastify.get('/conversations', async () => listConversations(fastify));
  fastify.get<{ Params: { id: string } }>('/conversations/:id', async (request) =>
    getConversation(fastify, request.params.id)
  );
  fastify.get('/tool-calls', async (request) => listToolCalls(fastify, request.query as Record<string, string>));
}
