import type { FastifyInstance } from 'fastify';
import { adminListMembers, adminExportMembers } from './admin-members.controller.js';

export default async function adminMemberRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', async (request) =>
    adminListMembers(fastify, request.query as Record<string, string>)
  );

  fastify.get('/export', async (request, reply) => {
    const { csv, filename } = await adminExportMembers(fastify, request.query as Record<string, string>);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(csv);
  });
}
