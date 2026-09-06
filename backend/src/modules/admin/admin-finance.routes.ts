import type { FastifyInstance } from 'fastify';
import {
  deletePartner,
  getFinanceOverview,
  getPartnerDetail,
  saveFinancePartners,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  createFunding,
  deleteFunding,
  createRepayment,
  deleteRepayment,
  createPayout,
  deletePayout,
} from './admin-finance.controller.js';

export default async function adminFinanceRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/overview', async () => getFinanceOverview(fastify));

  fastify.delete<{ Params: { id: string } }>('/partners/:id', async (request) =>
    deletePartner(fastify, request.params.id)
  );

  fastify.get<{ Params: { id: string } }>('/partners/:id', async (request) =>
    getPartnerDetail(fastify, request.params.id)
  );

  // Saved as a set — ownership only means anything relative to the others.
  fastify.put('/partners', async (request) => saveFinancePartners(fastify, request.body));

  fastify.get('/expenses', async (request) =>
    listExpenses(fastify, request.query as Record<string, string>)
  );
  fastify.post('/expenses', async (request) => createExpense(fastify, request.body));
  fastify.patch<{ Params: { id: string } }>('/expenses/:id', async (request) =>
    updateExpense(fastify, request.params.id, request.body)
  );
  fastify.delete<{ Params: { id: string } }>('/expenses/:id', async (request) =>
    deleteExpense(fastify, request.params.id)
  );

  fastify.post('/funding', async (request) => createFunding(fastify, request.body));
  fastify.delete<{ Params: { id: string } }>('/funding/:id', async (request) =>
    deleteFunding(fastify, request.params.id)
  );

  fastify.post('/repayments', async (request) => createRepayment(fastify, request.body));
  fastify.delete<{ Params: { id: string } }>('/repayments/:id', async (request) =>
    deleteRepayment(fastify, request.params.id)
  );

  fastify.post('/payouts', async (request) => createPayout(fastify, request.body));
  fastify.delete<{ Params: { id: string } }>('/payouts/:id', async (request) =>
    deletePayout(fastify, request.params.id)
  );
}
