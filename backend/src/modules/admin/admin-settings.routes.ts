import type { FastifyInstance } from 'fastify';
import { getSettings, updateSettings } from './admin-settings.controller.js';

export default async function adminSettingsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async () => {
    return getSettings(fastify);
  });

  fastify.put('/', async (request) => {
    return updateSettings(fastify, request.body);
  });
}
