import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate } from '../tool-kit.js';
import {
  cancelDelivery,
  createDeliveryBlackout,
  deleteDeliveryWindow,
  getAvailableSlots,
  listDeliveryBookings,
  listDeliveryWindows,
  listUnscheduledOrders,
  saveDeliveryWindow,
  scheduleDelivery,
  updateDeliveryStatus,
} from '../../admin/admin-delivery.controller.js';
import {
  dayName,
  describeSlot,
  formatMinute,
  fromMytWallClock,
  parseDayOfWeek,
  parseTimeOfDay,
  toMytParts,
} from '../../../utils/delivery-slots.js';

// Delivery scheduling over WhatsApp — which is where Asywa actually is when
// she is deciding a run. Everything delegates to admin-delivery.controller so
// the availability rules, the "is this slot real" check and the capacity check
// have exactly one implementation.
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
    name: 'delivery_availability',
    description:
      'The recurring weekly delivery windows and any blocked dates. This is the shape of the schedule, not the bookings — use list_delivery_slots for actual times you can book.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ fastify }) => {
      const { windows, blackouts } = await listDeliveryWindows(fastify);
      return {
        windows: windows.map((w: any) => ({
          windowId: w.id,
          day: dayName(w.dayOfWeek),
          from: formatMinute(w.startMinute),
          to: formatMinute(w.endMinute),
          slotMinutes: w.slotMinutes,
          deliveriesPerSlot: w.capacity,
          active: w.active,
          owner: w.partner?.name ?? null,
          notes: w.notes,
        })),
        blockedDates: blackouts.map((b: any) => ({
          blackoutId: b.id,
          date: b.date.toISOString().slice(0, 10),
          wholeDay: b.startMinute == null,
          from: b.startMinute == null ? null : formatMinute(b.startMinute),
          to: b.endMinute == null ? null : formatMinute(b.endMinute),
          reason: b.reason,
        })),
        note: windows.length ? undefined : 'No delivery windows are set up yet — nothing can be booked until at least one exists.',
      };
    },
  },

  {
    name: 'list_delivery_slots',
    description:
      'Bookable delivery slots, soonest first. Slots already in the past, blocked by a holiday, or already full are left out. Use this before scheduling so you offer a real time.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Date to start from — "today", "tomorrow", or YYYY-MM-DD. Default now.' },
        to: { type: 'string', description: 'Date to stop at. Default two weeks out.' },
        includeFull: { type: 'boolean', description: 'Also show slots with no space left. Default false.' },
        limit: { type: 'number' },
      },
    },
    run: async ({ fastify }, input) => {
      const from = input.from ? parseDate(input.from, false) : undefined;
      const to = input.to ? parseDate(input.to, true) : undefined;
      const slots = await getAvailableSlots(fastify, { from, to, includeFull: !!input.includeFull });
      const limited = slots.slice(0, clampLimit(input.limit, 20));
      return {
        count: slots.length,
        showing: limited.length,
        slots: limited.map((s) => ({
          date: s.localDate,
          time: s.localTime,
          label: s.label,
          spaces: `${s.capacity - s.booked} of ${s.capacity} free`,
          open: s.open,
        })),
        note: slots.length ? undefined : 'No slots available in that range — check delivery_availability for the windows and blocked dates.',
      };
    },
  },

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
      'Book (or move) an order\'s delivery to a slot. The slot is checked against the live windows, blocked dates and remaining capacity — a time that is not genuinely available is refused rather than saved. Rescheduling moves the existing booking, so an order can never be out for delivery twice.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string', description: 'Order number, customer name or phone.' },
        date: { type: 'string', description: '"today", "tomorrow", or YYYY-MM-DD.' },
        time: { type: 'string', description: 'Slot start in Malaysia time — "15:00" or "3pm".' },
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

  {
    name: 'set_delivery_window',
    description:
      'Add or change a recurring weekly delivery window, e.g. "Mondays 10am to 1pm, one-hour slots". Times are Malaysia local. Changing a window only affects slots offered from now on — deliveries already booked keep their times.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        windowId: { type: 'string', description: 'Omit to create a new window.' },
        day: { type: 'string', description: 'Day name or number, e.g. "Monday".' },
        from: { type: 'string', description: 'Start time, e.g. "10:00" or "10am".' },
        to: { type: 'string', description: 'End time, e.g. "13:00" or "1pm".' },
        slotMinutes: { type: 'number', description: 'Length of one slot. Default 60.' },
        deliveriesPerSlot: { type: 'number', description: 'How many deliveries fit in one slot. Default 1.' },
        active: { type: 'boolean' },
        notes: { type: 'string' },
      },
      required: ['day', 'from', 'to'],
    },
    run: async ({ fastify }, input) => {
      const dayOfWeek = parseDayOfWeek(input.day);
      const startMinute = parseTimeOfDay(input.from);
      const endMinute = parseTimeOfDay(input.to);
      const w: any = await saveDeliveryWindow(fastify, input.windowId ?? null, {
        dayOfWeek,
        startMinute,
        endMinute,
        slotMinutes: input.slotMinutes ?? 60,
        capacity: input.deliveriesPerSlot ?? 1,
        active: input.active !== false,
        notes: input.notes ?? null,
      });
      const slotCount = Math.floor((endMinute - startMinute) / (input.slotMinutes ?? 60));
      return {
        windowId: w.id,
        day: dayName(w.dayOfWeek),
        from: formatMinute(w.startMinute),
        to: formatMinute(w.endMinute),
        slotMinutes: w.slotMinutes,
        deliveriesPerSlot: w.capacity,
        active: w.active,
        slotsPerWeek: slotCount * w.capacity,
      };
    },
  },

  {
    name: 'remove_delivery_window',
    description: 'Delete a recurring delivery window. Deliveries already booked in it keep their times; only future slots stop being offered.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: { windowId: { type: 'string' } }, required: ['windowId'] },
    summarize: async ({ prisma }, input) => {
      const w = await prisma.deliveryWindow.findUnique({ where: { id: input.windowId } });
      if (!w) throw new Error(`No delivery window with id ${input.windowId}.`);
      return `remove the ${dayName(w.dayOfWeek)} ${formatMinute(w.startMinute)}–${formatMinute(w.endMinute)} delivery window`;
    },
    run: async ({ fastify }, input) => {
      await deleteDeliveryWindow(fastify, input.windowId);
      return { removed: true, windowId: input.windowId };
    },
  },

  {
    name: 'block_delivery_date',
    description:
      'Block a date so nothing can be booked — a public holiday, leave, van in the workshop. Give a time range to block only part of the day. Existing bookings on that date are NOT moved; check delivery_schedule and reschedule them.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD, or "tomorrow".' },
        reason: { type: 'string' },
        from: { type: 'string', description: 'Optional start time to block only part of the day.' },
        to: { type: 'string', description: 'Optional end time.' },
      },
      required: ['date', 'reason'],
    },
    run: async ({ fastify, prisma }, input) => {
      const day = parseDate(input.date, false);
      if (!day) throw new Error(`Could not read "${input.date}" as a date.`);
      const dateAtMytMidnight = fromMytWallClock(day.getFullYear(), day.getMonth() + 1, day.getDate(), 0);

      const b: any = await createDeliveryBlackout(fastify, {
        date: dateAtMytMidnight,
        startMinute: input.from ? parseTimeOfDay(input.from) : null,
        endMinute: input.to ? parseTimeOfDay(input.to) : null,
        reason: input.reason,
      });

      // Warn about anything already booked into the blocked period — silently
      // blocking a date that already has deliveries on it is how someone ends
      // up not turning up.
      const p = toMytParts(dateAtMytMidnight);
      const dayEnd = fromMytWallClock(p.year, p.month, p.day, 24 * 60);
      const affected = await prisma.deliveryBooking.findMany({
        where: { scheduledFor: { gte: dateAtMytMidnight, lt: dayEnd }, status: 'SCHEDULED' },
        include: { order: { select: { orderNumber: true, customerName: true } } },
      });

      return {
        blackoutId: b.id,
        date: input.date,
        reason: b.reason,
        wholeDay: b.startMinute == null,
        alreadyBooked: affected.map((a: any) => ({
          order: a.order.orderNumber,
          customer: a.order.customerName,
          when: describeSlot(a.scheduledFor, a.durationMinutes),
        })),
        warning: affected.length
          ? `${affected.length} delivery(ies) are already booked on that date and were NOT moved — reschedule them.`
          : undefined,
      };
    },
  },
];
