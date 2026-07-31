import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { describeSlot, formatMinute, mytDateKey, toMytParts } from '../../utils/delivery-slots.js';

// Asywa's delivery diary: one booking per order, at whatever time she says.
//
// There is deliberately no availability layer — see the comment on the delivery
// models in schema.prisma. She is the only person booking, so a rule about when
// bookings are allowed would only ever have blocked her.
//
// The Malaysia-time arithmetic lives in utils/delivery-slots.ts and is unit
// tested there; this file is the database and validation layer around it.

const bookingSchema = z.object({
  orderId: z.string().min(1),
  scheduledFor: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(8 * 60).optional(),
  notes: z.string().max(500).nullable().optional(),
});

// ---------------------------------------------------------------- bookings

export async function listDeliveryBookings(fastify: FastifyInstance, query: Record<string, string> = {}) {
  const where: any = {};
  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.scheduledFor = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };
  }
  const bookings = await fastify.prisma.deliveryBooking.findMany({
    where,
    orderBy: { scheduledFor: 'asc' },
    take: Math.min(parseInt(query.limit ?? '100', 10) || 100, 200),
    include: {
      order: {
        select: {
          orderNumber: true,
          customerName: true,
          phone: true,
          address: true,
          city: true,
          state: true,
          postcode: true,
          total: true,
          status: true,
          paymentStatus: true,
        },
      },
    },
  });
  return bookings.map(presentBooking);
}

function presentBooking(b: any) {
  return {
    id: b.id,
    orderId: b.orderId,
    orderNumber: b.order?.orderNumber,
    customer: b.order?.customerName,
    phone: b.order?.phone,
    address: b.order ? `${b.order.address}, ${b.order.postcode} ${b.order.city}, ${b.order.state}` : null,
    orderTotal: b.order?.total,
    orderStatus: b.order?.status,
    paymentStatus: b.order?.paymentStatus,
    scheduledFor: b.scheduledFor,
    localDate: mytDateKey(b.scheduledFor),
    localTime: formatMinute(toMytParts(b.scheduledFor).minuteOfDay),
    label: describeSlot(b.scheduledFor, b.durationMinutes),
    durationMinutes: b.durationMinutes,
    status: b.status,
    notes: b.notes,
    completedAt: b.completedAt,
  };
}

/**
 * Book (or move) an order's delivery to any date and time.
 *
 * The only checks are the ones that protect against a mistake rather than
 * against the operator: the order has to exist and be live, and the date has to
 * be within a couple of years — enough to catch a mistyped year, not enough to
 * argue with her about when she can drive somewhere.
 */
export async function scheduleDelivery(fastify: FastifyInstance, body: unknown) {
  const data = bookingSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id: data.orderId } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  if (order.deletedAt) throw { statusCode: 400, message: 'That order is deleted — restore it before scheduling a delivery.' };
  if (order.status === 'CANCELLED') {
    throw { statusCode: 400, message: 'That order is cancelled — nothing to deliver.' };
  }

  // Typo guard. A slipped year turns into a booking nobody sees again, and the
  // run sheet quietly loses a delivery.
  const twoYears = 2 * 365 * 24 * 60 * 60_000;
  const drift = data.scheduledFor.getTime() - Date.now();
  if (Math.abs(drift) > twoYears) {
    throw {
      statusCode: 400,
      message: `${describeSlot(data.scheduledFor, data.durationMinutes ?? 60)} is more than two years away — check the date.`,
    };
  }

  const existing = await fastify.prisma.deliveryBooking.findUnique({ where: { orderId: data.orderId } });

  const payload = {
    scheduledFor: data.scheduledFor,
    durationMinutes: data.durationMinutes ?? 60,
    notes: data.notes ?? null,
    // Rescheduling a cancelled or failed delivery makes it live again —
    // otherwise it would keep its old status and vanish from the run sheet.
    status: 'SCHEDULED' as const,
    completedAt: null,
  };

  const booking = await fastify.prisma.deliveryBooking.upsert({
    where: { orderId: data.orderId },
    create: { orderId: data.orderId, ...payload },
    update: payload,
    include: { order: { select: { orderNumber: true, customerName: true, phone: true, address: true, city: true, state: true, postcode: true, total: true, status: true, paymentStatus: true } } },
  });

  return {
    ...presentBooking(booking),
    rescheduledFrom: existing ? describeSlot(existing.scheduledFor, existing.durationMinutes) : null,
  };
}

export async function updateDeliveryStatus(
  fastify: FastifyInstance,
  id: string,
  body: { status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'FAILED'; notes?: string | null }
) {
  const status = z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'FAILED']).parse(body?.status);
  const booking = await fastify.prisma.deliveryBooking.update({
    where: { id },
    data: {
      status,
      // Stamped only on completion, and cleared if it is moved back — "booked
      // for 2pm" and "actually delivered at 3:40" stay separately answerable.
      completedAt: status === 'COMPLETED' ? new Date() : null,
      ...(body?.notes !== undefined ? { notes: body.notes } : {}),
    },
    include: { order: { select: { orderNumber: true, customerName: true, phone: true, address: true, city: true, state: true, postcode: true, total: true, status: true, paymentStatus: true } } },
  });
  return presentBooking(booking);
}

export async function cancelDelivery(fastify: FastifyInstance, id: string) {
  // Cancelling keeps the row so the history survives — the run sheet filters
  // on status rather than deleting anything.
  const booking = await fastify.prisma.deliveryBooking.update({
    where: { id },
    data: { status: 'CANCELLED', completedAt: null },
  });
  return { cancelled: true, orderId: booking.orderId };
}

/** Orders that are ready to go out but have no delivery booked. */
export async function listUnscheduledOrders(fastify: FastifyInstance, limit = 25) {
  const orders = await fastify.prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: ['PENDING', 'CONFIRMED', 'SHIPPED'] },
      delivery: null,
    },
    orderBy: { createdAt: 'asc' },
    take: Math.min(limit, 100),
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      phone: true,
      city: true,
      state: true,
      total: true,
      status: true,
      paymentStatus: true,
      createdAt: true,
    },
  });
  return orders;
}
