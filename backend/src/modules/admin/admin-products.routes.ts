import type { FastifyInstance } from 'fastify';
import {
  adminListProducts,
  adminGetProduct,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
} from './admin-products.controller.js';

export default async function adminProductRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => {
    return adminListProducts(fastify, request.query as Record<string, string>);
  });

  fastify.get<{ Params: { id: string } }>('/:id', async (request) => {
    return adminGetProduct(fastify, request.params.id);
  });

  fastify.post('/', async (request) => {
    return adminCreateProduct(fastify, request.body);
  });

  fastify.patch<{ Params: { id: string } }>('/:id', async (request) => {
    return adminUpdateProduct(fastify, request.params.id, request.body);
  });

  fastify.delete<{ Params: { id: string } }>('/:id', async (request) => {
    return adminDeleteProduct(fastify, request.params.id);
  });
}
