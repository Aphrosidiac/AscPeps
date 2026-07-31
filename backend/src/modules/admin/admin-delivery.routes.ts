import type { FastifyInstance } from 'fastify';
import {
  cancelDelivery,
  listDeliveryBookings,
  listUnscheduledOrders,
  scheduleDelivery,
  updateDeliveryStatus,
} from './admin-delivery.controller.js';

export default async function adminDeliveryRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  // Bookings
  fastify.get('/bookings', async (request) => listDeliveryBookings(fastify, request.query as Record<string, string>));
  fastify.post('/bookings', async (request) => scheduleDelivery(fastify, request.body));
  fastify.patch<{ Params: { id: string } }>('/bookings/:id', async (request) =>
    updateDeliveryStatus(fastify, request.params.id, request.body as any)
  );
  fastify.delete<{ Params: { id: string } }>('/bookings/:id', async (request) =>
    cancelDelivery(fastify, request.params.id)
  );

  fastify.get('/unscheduled', async () => listUnscheduledOrders(fastify));
}
