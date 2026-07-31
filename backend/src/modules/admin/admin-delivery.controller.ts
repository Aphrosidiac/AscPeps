import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  describeSlot,
  formatMinute,
  fromMytWallClock,
  generateSlots,
  isSlotOpen,
  mytDateKey,
  toMytParts,
  type Slot,
} from '../../utils/delivery-slots.js';

// Asywa's delivery diary. Recurring windows define when deliveries are
// possible; the slot engine turns those into concrete times; a booking pins one
// slot to one order.
//
// All the awkward date arithmetic lives in utils/delivery-slots.ts and is unit
// tested there — this file is the database and validation layer around it.

const windowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(24 * 60),
  endMinute: z.number().int().min(0).max(24 * 60),
  slotMinutes: z.number().int().min(15).max(8 * 60).default(60),
  capacity: z.number().int().min(1).max(20).default(1),
  active: z.boolean().default(true),
  partnerId: z.string().nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});

const blackoutSchema = z.object({
  date: z.coerce.date(),
  startMinute: z.number().int().min(0).max(24 * 60).nullable().optional(),
  endMinute: z.number().int().min(0).max(24 * 60).nullable().optional(),
  reason: z.string().trim().min(1).max(200),
});

const bookingSchema = z.object({
  orderId: z.string().min(1),
  scheduledFor: z.coerce.date(),
  durationMinutes: z.number().int().min(15).max(8 * 60).optional(),
  notes: z.string().max(500).nullable().optional(),
});

function validateWindowBounds(w: { startMinute: number; endMinute: number; slotMinutes: number }) {
  if (w.endMinute <= w.startMinute) {
    throw { statusCode: 400, message: 'The window must end after it starts.' };
  }
  if (w.endMinute - w.startMinute < w.slotMinutes) {
    throw {
      statusCode: 400,
      message: `A ${w.slotMinutes}-minute slot does not fit in a ${w.endMinute - w.startMinute}-minute window.`,
    };
  }
}

// ---------------------------------------------------------------- windows

export async function listDeliveryWindows(fastify: FastifyInstance) {
  const [windows, blackouts] = await Promise.all([
    fastify.prisma.deliveryWindow.findMany({
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      include: { partner: { select: { name: true } } },
    }),
    fastify.prisma.deliveryBlackout.findMany({
      where: { date: { gte: startOfTodayMyt() } },
      orderBy: { date: 'asc' },
    }),
  ]);
  return { windows, blackouts };
}

export async function saveDeliveryWindow(fastify: FastifyInstance, id: string | null, body: unknown) {
  const data = windowSchema.parse(body);
  validateWindowBounds(data);
  if (id) return fastify.prisma.deliveryWindow.update({ where: { id }, data });
  return fastify.prisma.deliveryWindow.create({ data });
}

export async function deleteDeliveryWindow(fastify: FastifyInstance, id: string) {
  // Bookings already made against this window keep their times — they are
  // stored as instants, not as references to the window. Removing a window
  // only stops NEW slots being offered.
  await fastify.prisma.deliveryWindow.delete({ where: { id } });
  return { deleted: true };
}

// ---------------------------------------------------------------- blackouts

export async function createDeliveryBlackout(fastify: FastifyInstance, body: unknown) {
  const data = blackoutSchema.parse(body);
  if (data.startMinute != null && data.endMinute != null && data.endMinute <= data.startMinute) {
    throw { statusCode: 400, message: 'The blocked period must end after it starts.' };
  }
  return fastify.prisma.deliveryBlackout.create({ data });
}

export async function deleteDeliveryBlackout(fastify: FastifyInstance, id: string) {
  await fastify.prisma.deliveryBlackout.delete({ where: { id } });
  return { deleted: true };
}

// ---------------------------------------------------------------- slots

function startOfTodayMyt(): Date {
  const p = toMytParts(new Date());
  return fromMytWallClock(p.year, p.month, p.day, 0);
}

/**
 * Open slots between two instants. `from` defaults to now, so a slot that has
 * already started is never offered.
 */
export async function getAvailableSlots(
  fastify: FastifyInstance,
  opts: { from?: Date; to?: Date; includeFull?: boolean } = {}
) {
  const from = opts.from ?? new Date();
  const to = opts.to ?? new Date(from.getTime() + 14 * 24 * 60 * 60_000);

  const [windows, blackouts, bookings] = await Promise.all([
    fastify.prisma.deliveryWindow.findMany({ where: { active: true } }),
    fastify.prisma.deliveryBlackout.findMany({
      where: { date: { gte: new Date(from.getTime() - 24 * 60 * 60_000) } },
    }),
    // Only live bookings occupy a slot — a cancelled one frees it again.
    fastify.prisma.deliveryBooking.findMany({
      where: { scheduledFor: { gte: from, lte: to }, status: { in: ['SCHEDULED', 'COMPLETED'] } },
      select: { scheduledFor: true },
    }),
  ]);

  const slots = generateSlots({
    windows,
    blackouts,
    bookedAt: bookings.map((b) => b.scheduledFor),
    from,
    to,
  });

  const visible = opts.includeFull ? slots : slots.filter(isSlotOpen);
  return visible.map(presentSlot);
}

function presentSlot(s: Slot) {
  return {
    startsAt: s.startsAt,
    localDate: s.localDate,
    localTime: s.localTime,
    durationMinutes: s.durationMinutes,
    label: describeSlot(s.startsAt, s.durationMinutes),
    booked: s.booked,
    capacity: s.capacity,
    open: isSlotOpen(s),
  };
}

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
 * Book (or move) an order's delivery.
 *
 * The slot is re-validated against live availability every time rather than
 * trusted from the caller: windows change, holidays get added, and another
 * order may have taken the last space since the list was read.
 */
export async function scheduleDelivery(fastify: FastifyInstance, body: unknown) {
  const data = bookingSchema.parse(body);

  const order = await fastify.prisma.order.findUnique({ where: { id: data.orderId } });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  if (order.deletedAt) throw { statusCode: 400, message: 'That order is deleted — restore it before scheduling a delivery.' };
  if (order.status === 'CANCELLED') {
    throw { statusCode: 400, message: 'That order is cancelled — nothing to deliver.' };
  }

  const existing = await fastify.prisma.deliveryBooking.findUnique({ where: { orderId: data.orderId } });

  // Ask the engine about this exact instant. `includeFull` so a slot that is
  // full reports as full rather than silently vanishing into "unknown slot".
  const windowSlots = await getAvailableSlots(fastify, {
    from: new Date(data.scheduledFor.getTime() - 1),
    to: new Date(data.scheduledFor.getTime() + 1),
    includeFull: true,
  });
  const match = windowSlots.find((s) => s.startsAt.getTime() === data.scheduledFor.getTime());

  if (!match) {
    throw {
      statusCode: 400,
      message: `${describeSlot(data.scheduledFor, data.durationMinutes ?? 60)} is not an available delivery slot — it is outside the delivery windows, blocked, or in the past.`,
    };
  }
  // Moving a booking within its own slot must not count itself as competition.
  const selfOccupies = existing && existing.scheduledFor.getTime() === data.scheduledFor.getTime();
  if (!match.open && !selfOccupies) {
    throw {
      statusCode: 400,
      message: `${match.label} is already full (${match.booked}/${match.capacity}). Pick another slot.`,
    };
  }

  const payload = {
    scheduledFor: data.scheduledFor,
    durationMinutes: data.durationMinutes ?? match.durationMinutes,
    notes: data.notes ?? null,
    // Re-scheduling a cancelled or failed delivery makes it live again —
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

  return { ...presentBooking(booking), rescheduledFrom: existing ? describeSlot(existing.scheduledFor, existing.durationMinutes) : null };
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
  // Cancelling keeps the row (so the history survives) but frees the slot,
  // because getAvailableSlots only counts SCHEDULED and COMPLETED.
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
