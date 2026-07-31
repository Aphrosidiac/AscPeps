import type { FastifyInstance } from 'fastify';
import {
  cancelDelivery,
  createDeliveryBlackout,
  deleteDeliveryBlackout,
  deleteDeliveryWindow,
  getAvailableSlots,
  listDeliveryBookings,
  listDeliveryWindows,
  listUnscheduledOrders,
  saveDeliveryWindow,
  scheduleDelivery,
  updateDeliveryStatus,
} from './admin-delivery.controller.js';

export default async function adminDeliveryRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  // Availability
  fastify.get('/windows', async () => listDeliveryWindows(fastify));
  fastify.post('/windows', async (request) => saveDeliveryWindow(fastify, null, request.body));
  fastify.put<{ Params: { id: string } }>('/windows/:id', async (request) =>
    saveDeliveryWindow(fastify, request.params.id, request.body)
  );
  fastify.delete<{ Params: { id: string } }>('/windows/:id', async (request) =>
    deleteDeliveryWindow(fastify, request.params.id)
  );

  fastify.post('/blackouts', async (request) => createDeliveryBlackout(fastify, request.body));
  fastify.delete<{ Params: { id: string } }>('/blackouts/:id', async (request) =>
    deleteDeliveryBlackout(fastify, request.params.id)
  );

  // Slots + bookings
  fastify.get('/slots', async (request) => {
    const q = request.query as Record<string, string>;
    return getAvailableSlots(fastify, {
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
      includeFull: q.includeFull === 'true',
    });
  });
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
