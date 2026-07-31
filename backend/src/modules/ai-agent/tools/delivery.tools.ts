import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate } from '../tool-kit.js';
import {
  cancelDelivery,
  listDeliveryBookings,
  listUnscheduledOrders,
  scheduleDelivery,
  updateDeliveryStatus,
} from '../../admin/admin-delivery.controller.js';
import { describeSlot, fromMytWallClock, parseTimeOfDay } from '../../../utils/delivery-slots.js';

// Delivery scheduling over WhatsApp — which is where Asywa actually is when
// she is deciding a run. Everything delegates to admin-delivery.controller so
// the booking rules have exactly one implementation.
//
// There is no availability layer to consult: she books any time she likes. The
// tools that managed recurring windows and blackout dates were removed with it
// — see the delivery models in schema.prisma for why.
//
// Times are Malaysia local throughout. The tools take "3pm" and "tomorrow"
// because that is how a delivery gets discussed; the conversion to a real
// instant happens once, in utils/delivery-slots.ts.

// Turn a date ("tomorrow", "2026-08-03") plus a time ("3pm") into an instant.
function resolveSlotInstant(dateText: string, timeText: string): Date {
  const day = parseDate(dateText, false);
  if (!day) throw new Error(`Could not read "${dateText}" as a date.`);
  const minute = parseTimeOfDay(timeText);
  // parseDate builds the day in the server's local time; re-read its calendar
  // parts and rebuild against the fixed Malaysia offset so the result never
  // depends on the host timezone.
  return fromMytWallClock(day.getFullYear(), day.getMonth() + 1, day.getDate(), minute);
}

async function resolveOrderForDelivery(prisma: any, ref: string) {
  const raw = String(ref).trim();
  const direct = await prisma.order.findFirst({
    where: { OR: [{ id: raw }, { orderNumber: { equals: raw, mode: 'insensitive' } }] },
  });
  if (direct) return direct;

  const matches = await prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        { orderNumber: { contains: raw, mode: 'insensitive' } },
        { customerName: { contains: raw, mode: 'insensitive' } },
        { phone: { contains: raw.replace(/[^0-9]/g, '') || ' ' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  if (!matches.length) throw new Error(`No order found matching "${ref}".`);
  if (matches.length > 1) {
    throw new Error(
      `"${ref}" matches ${matches.length} orders: ${matches.map((o: any) => `${o.orderNumber} (${o.customerName})`).join('; ')}. Ask which one.`
    );
  }
  return matches[0];
}

export const deliveryTools: AgentTool[] = [

  {
    name: 'delivery_schedule',
    description:
      'What is booked in — the run sheet. Use for "what am I delivering tomorrow" or "what is outstanding this week". Includes each customer\'s address and phone.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '"today", "tomorrow", or YYYY-MM-DD. Default today.' },
        to: { type: 'string', description: 'Default 7 days from `from`.' },
        status: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'FAILED'] },
        limit: { type: 'number' },
      },
    },
    run: async ({ fastify }, input) => {
      const from = parseDate(input.from ?? 'today', false)!;
      const to = input.to ? parseDate(input.to, true)! : new Date(from.getTime() + 7 * 24 * 60 * 60_000);
      const bookings = await listDeliveryBookings(fastify, {
        from: from.toISOString(),
        to: to.toISOString(),
        ...(input.status ? { status: input.status } : {}),
        limit: String(clampLimit(input.limit, 30)),
      });
      return {
        count: bookings.length,
        deliveries: bookings.map((b: any) => ({
          bookingId: b.id,
          when: b.label,
          order: b.orderNumber,
          customer: b.customer,
          phone: b.phone,
          address: b.address,
          orderTotal: money(b.orderTotal),
          paymentStatus: b.paymentStatus,
          status: b.status,
          notes: b.notes,
        })),
      };
    },
  },

  {
    name: 'orders_awaiting_delivery',
    description: 'Live orders with no delivery booked yet. The queue of things that still need a slot.',
    input_schema: { type: 'object', properties: { limit: { type: 'number' } } },
    run: async ({ fastify }, input) => {
      const orders = await listUnscheduledOrders(fastify, clampLimit(input.limit, 25));
      return {
        count: orders.length,
        orders: orders.map((o: any) => ({
          orderNumber: o.orderNumber,
          customer: o.customerName,
          phone: o.phone,
          area: `${o.city}, ${o.state}`,
          total: money(o.total),
          status: o.status,
          paymentStatus: o.paymentStatus,
          placed: o.createdAt,
        })),
      };
    },
  },

  {
    name: 'schedule_delivery',
    description:
      'Book (or move) an order\'s delivery to any date and time — there are no fixed delivery windows. Rescheduling moves the existing booking, so an order can never be out for delivery twice.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string', description: 'Order number, customer name or phone.' },
        date: { type: 'string', description: '"today", "tomorrow", or YYYY-MM-DD.' },
        time: { type: 'string', description: 'Time in Malaysia time — "15:00" or "3pm".' },
        notes: { type: 'string', description: 'For the driver: gate code, call on arrival, landmark.' },
      },
      required: ['orderRef', 'date', 'time'],
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrderForDelivery(prisma, input.orderRef);
      const scheduledFor = resolveSlotInstant(input.date, input.time);
      const booking: any = await scheduleDelivery(fastify, {
        orderId: order.id,
        scheduledFor,
        notes: input.notes ?? null,
      });
      return {
        order: booking.orderNumber,
        customer: booking.customer,
        phone: booking.phone,
        address: booking.address,
        when: booking.label,
        status: booking.status,
        movedFrom: booking.rescheduledFrom,
        note: booking.rescheduledFrom
          ? `Moved from ${booking.rescheduledFrom}. The customer has not been told — the agent cannot message them.`
          : 'The customer has not been told — the agent cannot message them.',
      };
    },
  },

  {
    name: 'update_delivery',
    description:
      'Mark a delivery done, failed, or put it back to scheduled. COMPLETED stamps the time it actually finished. FAILED means the run happened but the drop did not (nobody home, wrong address) — different from cancelling, which frees the slot.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        status: { type: 'string', enum: ['SCHEDULED', 'COMPLETED', 'FAILED'] },
        notes: { type: 'string' },
      },
      required: ['orderRef', 'status'],
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrderForDelivery(prisma, input.orderRef);
      const existing = await prisma.deliveryBooking.findUnique({ where: { orderId: order.id } });
      if (!existing) throw new Error(`Order ${order.orderNumber} has no delivery booked.`);
      const booking: any = await updateDeliveryStatus(fastify, existing.id, {
        status: input.status,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      });
      return {
        order: booking.orderNumber,
        when: booking.label,
        status: booking.status,
        completedAt: booking.completedAt,
        note:
          input.status === 'COMPLETED'
            ? 'This records the delivery only — it does not mark the order paid or change the order status.'
            : undefined,
      };
    },
  },

  {
    name: 'cancel_delivery',
    description: 'Call off a booked delivery. The slot is freed for someone else; the order itself is untouched.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { orderRef: { type: 'string' } },
      required: ['orderRef'],
    },
    summarize: async ({ prisma }, input) => {
      const order = await resolveOrderForDelivery(prisma, input.orderRef);
      const booking = await prisma.deliveryBooking.findUnique({ where: { orderId: order.id } });
      if (!booking) throw new Error(`Order ${order.orderNumber} has no delivery booked.`);
      return `cancel the delivery for ${order.orderNumber} (${order.customerName}) booked for ${describeSlot(booking.scheduledFor, booking.durationMinutes)}`;
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrderForDelivery(prisma, input.orderRef);
      const booking = await prisma.deliveryBooking.findUnique({ where: { orderId: order.id } });
      if (!booking) throw new Error(`Order ${order.orderNumber} has no delivery booked.`);
      await cancelDelivery(fastify, booking.id);
      return { order: order.orderNumber, cancelled: true, slotFreed: describeSlot(booking.scheduledFor, booking.durationMinutes) };
    },
  },

];
