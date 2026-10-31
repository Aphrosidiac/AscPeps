import type { FastifyInstance } from 'fastify';
import {
  adminListGroupBuys, adminCreateGroupBuy, adminGetGroupBuy, adminUpdateGroupBuy, adminSetGroupBuyItems,
  adminSetGroupBuyStages, adminNotifyCurrentStage, adminDuplicateGroupBuy, adminDeleteGroupBuy, adminGroupBuyOrders,
  adminGroupBuySupplierSheet, adminGroupBuySignups, adminGroupBuySignupsCsv, adminAddSignup, adminUpdateSignup,
  adminDeleteSignup, adminGroupBuyNotices, adminPreviewGroupBuyEmail, adminGroupBuyVariants,
} from './admin-group-buys.controller.js';

type IdParams = { Params: { id: string } };

export default async function adminGroupBuyRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async () => adminListGroupBuys(fastify));
  fastify.post('/', async (request) => adminCreateGroupBuy(fastify, request.body));
  // Registered before '/:id' so it is never read as an id.
  fastify.get('/variants', async () => adminGroupBuyVariants(fastify));

  fastify.get<IdParams>('/:id', async (request) => adminGetGroupBuy(fastify, request.params.id));
  fastify.patch<IdParams>('/:id', async (request) => adminUpdateGroupBuy(fastify, request.params.id, request.body));
  fastify.delete<IdParams>('/:id', async (request) => adminDeleteGroupBuy(fastify, request.params.id));
  fastify.post<IdParams>('/:id/duplicate', async (request) => adminDuplicateGroupBuy(fastify, request.params.id));
  fastify.put<IdParams>('/:id/items', async (request) => adminSetGroupBuyItems(fastify, request.params.id, request.body));
  fastify.put<IdParams>('/:id/stages', async (request) => adminSetGroupBuyStages(fastify, request.params.id, request.body));
  fastify.post<IdParams>('/:id/notify', async (request) => adminNotifyCurrentStage(fastify, request.params.id));
  fastify.get<IdParams>('/:id/orders', async (request) => adminGroupBuyOrders(fastify, request.params.id));
  fastify.get<IdParams>('/:id/supplier-sheet', async (request) => adminGroupBuySupplierSheet(fastify, request.params.id));
  fastify.get<IdParams>('/:id/signups', async (request) => adminGroupBuySignups(fastify, request.params.id));
  fastify.get<IdParams>('/:id/signups.csv', async (request, reply) => {
    const { csv, filename } = await adminGroupBuySignupsCsv(fastify, request.params.id);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send('﻿' + csv);
  });
  fastify.post<IdParams>('/:id/signups', async (request) => adminAddSignup(fastify, request.params.id, request.body));
  fastify.patch<{ Params: { id: string; signupId: string } }>('/:id/signups/:signupId', async (request) =>
    adminUpdateSignup(fastify, request.params.id, request.params.signupId, request.body)
  );
  fastify.delete<{ Params: { id: string; signupId: string } }>('/:id/signups/:signupId', async (request) =>
    adminDeleteSignup(fastify, request.params.id, request.params.signupId)
  );
  fastify.get<IdParams>('/:id/notices', async (request) => adminGroupBuyNotices(fastify, request.params.id));
  fastify.get<IdParams>('/:id/preview-email', async (request) =>
    adminPreviewGroupBuyEmail(fastify, request.params.id, request.query as { kind?: string; stageKey?: string })
  );
}
