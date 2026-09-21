import type { FastifyInstance } from 'fastify';
import {
  createSupplier,
  deleteSupplier,
  getPriceSheet,
  getSupplierOptions,
  listSuppliers,
  setSupplierCosts,
  updateSupplier,
} from './admin-suppliers.controller.js';

export default async function adminSuppliersRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // --- the suppliers ---
  fastify.get('/', async () => listSuppliers(fastify));

  fastify.post('/', async (request) => createSupplier(fastify, request.body));

  // Static segments first so Fastify never reads "sheet" as an id.
  fastify.get('/sheet', async () => getPriceSheet(fastify));

  fastify.put('/costs', async (request) => setSupplierCosts(fastify, request.body));

  // ?variantIds=a,b,c — the dropdown contents for an order's lines.
  fastify.get<{ Querystring: { variantIds?: string } }>('/options', async (request) =>
    getSupplierOptions(fastify, (request.query.variantIds ?? '').split(','))
  );

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) =>
    updateSupplier(fastify, request.params.id, request.body)
  );

  fastify.delete<{ Params: { id: string } }>('/:id', async (request) =>
    deleteSupplier(fastify, request.params.id)
  );
}
