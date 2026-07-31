/**
 * Delivery scheduling, end to end against the database.
 *
 * Covers the rules that actually matter: a slot must be real before it can be
 * booked, capacity is enforced, a blocked date closes bookings, cancelling
 * frees the slot, and rescheduling moves the booking rather than creating a
 * second one. Everything is cleaned up afterwards.
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { getTool } from '../src/modules/ai-agent/registry.js';
import type { ToolContext } from '../src/modules/ai-agent/tool-kit.js';
import { describeSlot, fromMytWallClock, toMytParts } from '../src/utils/delivery-slots.js';

const fastify = Fastify({ logger: false });
await fastify.register(prismaPlugin);
const prisma = fastify.prisma;
const ctx: ToolContext = {
  fastify, prisma,
  actor: { phone: '0123456789', name: 'Delivery Test', canWrite: true },
  revalidate: () => {},
};
const run = (tool: string, input: any) => getTool(tool)!.run(ctx, input);

let pass = 0, fail = 0;
const failures: string[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try { console.log(`✓ ${name.padEnd(52)} ${await fn()}`); pass++; }
  catch (e: any) { console.log(`✗ ${name.padEnd(52)} ${e?.message}`); fail++; failures.push(name); }
};
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };

// Clean slate for the test's own artifacts.
await prisma.deliveryBooking.deleteMany({});
await prisma.deliveryBlackout.deleteMany({});
await prisma.deliveryWindow.deleteMany({});

// Pick a weekday comfortably in the future so "past slots are hidden" can't
// interfere, and use its real day-of-week.
const target = new Date(Date.now() + 8 * 24 * 60 * 60_000);
const tp = toMytParts(target);
const dateStr = `${tp.year}-${String(tp.month).padStart(2, '0')}-${String(tp.day).padStart(2, '0')}`;
const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

console.log('='.repeat(74));
console.log(`DELIVERY SCHEDULING — target date ${dateStr} (${dayNames[tp.dayOfWeek]})`);
console.log('='.repeat(74));

const orders = await prisma.order.findMany({ where: { deletedAt: null, status: { not: 'CANCELLED' } }, take: 3 });
assert(orders.length >= 2, 'need at least 2 orders in the dev db');

await check('set_delivery_window creates a window', async () => {
  const r: any = await run('set_delivery_window', {
    day: dayNames[tp.dayOfWeek], from: '10am', to: '1pm', slotMinutes: 60, deliveriesPerSlot: 1,
  });
  assert(r.slotsPerWeek === 3, `expected 3 slots/week, got ${r.slotsPerWeek}`);
  return `${r.day} ${r.from}–${r.to}, ${r.slotsPerWeek} slots`;
});

await check('list_delivery_slots offers the real times', async () => {
  const r: any = await run('list_delivery_slots', { from: dateStr, to: dateStr, limit: 10 });
  const times = r.slots.map((s: any) => s.time);
  assert(JSON.stringify(times) === JSON.stringify(['10:00','11:00','12:00']), `got ${JSON.stringify(times)}`);
  return times.join(', ');
});

await check('schedule_delivery refuses a time outside the window', async () => {
  try {
    await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: dateStr, time: '4pm' });
  } catch (e: any) {
    assert(/not an available delivery slot/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused 16:00 (outside 10:00–13:00)';
  }
  throw new Error('accepted a slot outside the window');
});

await check('schedule_delivery books a real slot', async () => {
  const r: any = await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: dateStr, time: '10am', notes: 'Call on arrival' });
  assert(r.status === 'SCHEDULED', `status ${r.status}`);
  const b = await prisma.deliveryBooking.findUniqueOrThrow({ where: { orderId: orders[0].id } });
  assert(toMytParts(b.scheduledFor).minuteOfDay === 600, 'stored instant is not 10:00 MYT');
  return `${r.order} -> ${r.when}`;
});

await check('a full slot is refused for a second order', async () => {
  try {
    await run('schedule_delivery', { orderRef: orders[1].orderNumber, date: dateStr, time: '10am' });
  } catch (e: any) {
    assert(/already full/i.test(e.message), `wrong error: ${e.message}`);
    return 'capacity 1 enforced';
  }
  throw new Error('overbooked a full slot');
});

await check('the booked slot disappears from availability', async () => {
  const r: any = await run('list_delivery_slots', { from: dateStr, to: dateStr });
  const times = r.slots.map((s: any) => s.time);
  assert(!times.includes('10:00'), '10:00 still offered after being booked');
  return `now offering ${times.join(', ')}`;
});

await check('rescheduling moves the booking, not duplicates it', async () => {
  const r: any = await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: dateStr, time: '12pm' });
  assert(r.movedFrom, 'did not report the previous slot');
  const count = await prisma.deliveryBooking.count({ where: { orderId: orders[0].id } });
  assert(count === 1, `expected 1 booking, found ${count}`);
  const slots: any = await run('list_delivery_slots', { from: dateStr, to: dateStr });
  assert(slots.slots.some((s: any) => s.time === '10:00'), '10:00 was not freed');
  return `moved to ${r.when}, old slot freed`;
});

await check('delivery_schedule shows the run sheet with address', async () => {
  const r: any = await run('delivery_schedule', { from: dateStr, to: dateStr });
  assert(r.count === 1, `expected 1 delivery, got ${r.count}`);
  assert(r.deliveries[0].address, 'no address on the run sheet');
  assert(r.deliveries[0].phone, 'no phone on the run sheet');
  return `${r.deliveries[0].order} @ ${r.deliveries[0].when}`;
});

await check('block_delivery_date warns about existing bookings', async () => {
  const r: any = await run('block_delivery_date', { date: dateStr, reason: 'Public holiday' });
  assert(r.alreadyBooked.length === 1, `expected 1 affected booking, got ${r.alreadyBooked.length}`);
  assert(r.warning, 'no warning produced');
  return `flagged ${r.alreadyBooked.length} existing booking`;
});

await check('a blocked date offers no slots', async () => {
  const r: any = await run('list_delivery_slots', { from: dateStr, to: dateStr });
  assert(r.slots.length === 0, `expected 0 slots, got ${r.slots.length}`);
  return 'date fully closed';
});

await check('booking onto a blocked date is refused', async () => {
  try {
    await run('schedule_delivery', { orderRef: orders[1].orderNumber, date: dateStr, time: '11am' });
  } catch (e: any) {
    assert(/not an available delivery slot/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused a slot on a blocked date';
  }
  throw new Error('booked onto a blocked date');
});

await check('unblocking restores availability', async () => {
  await prisma.deliveryBlackout.deleteMany({});
  const r: any = await run('list_delivery_slots', { from: dateStr, to: dateStr });
  assert(r.slots.length === 2, `expected 2 free slots, got ${r.slots.length}`);
  return `${r.slots.length} slots back`;
});

await check('update_delivery COMPLETED stamps the finish time', async () => {
  const r: any = await run('update_delivery', { orderRef: orders[0].orderNumber, status: 'COMPLETED' });
  assert(r.status === 'COMPLETED' && r.completedAt, 'completedAt not stamped');
  return 'completed and timestamped';
});

await check('cancel_delivery frees the slot but keeps the order', async () => {
  await run('schedule_delivery', { orderRef: orders[1].orderNumber, date: dateStr, time: '11am' });
  const r: any = await run('cancel_delivery', { orderRef: orders[1].orderNumber });
  assert(r.cancelled, 'not cancelled');
  const slots: any = await run('list_delivery_slots', { from: dateStr, to: dateStr });
  assert(slots.slots.some((s: any) => s.time === '11:00'), '11:00 not freed by cancelling');
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orders[1].id } });
  assert(!order.deletedAt, 'cancelling the delivery touched the order');
  return 'slot freed, order untouched';
});

await check('orders_awaiting_delivery excludes the booked one', async () => {
  const r: any = await run('orders_awaiting_delivery', { limit: 50 });
  const nums = r.orders.map((o: any) => o.orderNumber);
  assert(!nums.includes(orders[0].orderNumber), 'a scheduled order is still listed as awaiting');
  return `${r.count} awaiting a slot`;
});

// Cleanup
await prisma.deliveryBooking.deleteMany({});
await prisma.deliveryBlackout.deleteMany({});
await prisma.deliveryWindow.deleteMany({});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
await fastify.close();
process.exit(fail ? 1 : 0);
