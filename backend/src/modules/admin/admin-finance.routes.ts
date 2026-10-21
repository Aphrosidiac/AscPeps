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
import {
  getMoneyOverview,
  getBankLedger,
  createBankEntry,
  deleteBankEntry,
  createBankCheck,
  deleteBankCheck,
  listSplitRules,
  createSplitRule,
  deleteSplitRule,
  getShareOut,
  createShareOut,
  deleteShareOut,
} from './admin-money.controller.js';

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

  /* Ascend Money — the bank, the split rule, share-outs. */
  const actor = (request: { user?: { email?: string } }) => request.user?.email ?? null;

  fastify.get('/money', async (request) => getMoneyOverview(fastify, request.query));

  fastify.get('/bank', async (request) => getBankLedger(fastify, request.query));
  fastify.post('/bank/entries', async (request) => createBankEntry(fastify, request.body, actor(request)));
  fastify.delete<{ Params: { id: string } }>('/bank/entries/:id', async (request) =>
    deleteBankEntry(fastify, request.params.id)
  );
  fastify.post('/bank/checks', async (request) => createBankCheck(fastify, request.body, actor(request)));
  fastify.delete<{ Params: { id: string } }>('/bank/checks/:id', async (request) =>
    deleteBankCheck(fastify, request.params.id)
  );

  fastify.get('/split-rules', async () => listSplitRules(fastify));
  fastify.post('/split-rules', async (request) => createSplitRule(fastify, request.body, actor(request)));
  fastify.delete<{ Params: { id: string } }>('/split-rules/:id', async (request) =>
    deleteSplitRule(fastify, request.params.id)
  );

  fastify.get('/share-out', async () => getShareOut(fastify));
  fastify.post('/share-out', async (request) => createShareOut(fastify, request.body, actor(request)));
  fastify.delete<{ Params: { id: string } }>('/share-out/:id', async (request) =>
    deleteShareOut(fastify, request.params.id)
  );
}
