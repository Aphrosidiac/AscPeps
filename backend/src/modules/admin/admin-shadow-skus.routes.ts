import type { FastifyInstance } from 'fastify';
import {
  assignMapping,
  createShadowSku,
  deleteShadowSku,
  getCoverage,
  listMapping,
  listOrderSummaries,
  listShadowSkus,
  previewOrderSummary,
  streamOrderSummaryPdf,
  updateShadowSku,
} from './admin-shadow-skus.controller.js';

export default async function adminShadowSkusRoutes(fastify: FastifyInstance) {
  // Admin-only, the PDF included. There is no unauthenticated path to any of
  // this — the whole feature exists on the inside of the admin panel.
  fastify.addHook('preHandler', fastify.authenticate);

  // --- the shadow catalogue ---
  fastify.get('/', async (request) => listShadowSkus(fastify, request.query as Record<string, string>));

  fastify.post('/', async (request) => createShadowSku(fastify, request.body));

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) =>
    updateShadowSku(fastify, request.params.id, request.body),
  );

  fastify.delete<{ Params: { id: string } }>('/:id', async (request) =>
    deleteShadowSku(fastify, request.params.id),
  );

  // --- coverage + mapping ---
  // Registered before /:id-shaped routes would shadow them; Fastify's router
  // prefers static segments, but keeping them adjacent makes that obvious.
  fastify.get('/coverage', async () => getCoverage(fastify));

  fastify.get('/mapping', async (request) =>
    listMapping(fastify, request.query as Record<string, string>),
  );

  fastify.put('/mapping', async (request) => assignMapping(fastify, request.body));

  // --- the order backlog ---
  fastify.get('/orders', async (request) =>
    listOrderSummaries(fastify, request.query as Record<string, string>),
  );

  // --- one order's summary ---
  fastify.get<{ Params: { orderRef: string } }>('/orders/:orderRef/summary', async (request) =>
    previewOrderSummary(fastify, request.params.orderRef),
  );

  // Produces the sheet, which is also what freezes the wording onto the order.
  fastify.get<{ Params: { orderRef: string } }>(
    '/orders/:orderRef/summary.pdf',
    async (request, reply) => streamOrderSummaryPdf(fastify, request.params.orderRef, reply),
  );
}
