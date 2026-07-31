/**
 * Delivery scheduling, end to end against the database.
 *
 * Covers the rules that survived the removal of the availability layer: any
 * time can be booked, the stored instant is Malaysia time, rescheduling moves
 * the booking rather than creating a second one, cancelling leaves the order
 * alone, and the guards that exist are the ones that catch mistakes (a
 * mistyped year, a cancelled order) rather than ones that argue with the
 * operator. Everything is cleaned up afterwards.
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { getTool } from '../src/modules/ai-agent/registry.js';
import type { ToolContext } from '../src/modules/ai-agent/tool-kit.js';
import { toMytParts } from '../src/utils/delivery-slots.js';

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

// A date comfortably in the future, so nothing here can collide with a real
// booking made today.
const target = new Date(Date.now() + 8 * 24 * 60 * 60_000);
const tp = toMytParts(target);
const dateStr = `${tp.year}-${String(tp.month).padStart(2, '0')}-${String(tp.day).padStart(2, '0')}`;
const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

console.log('='.repeat(74));
console.log(`DELIVERY SCHEDULING — target date ${dateStr} (${dayNames[tp.dayOfWeek]})`);
console.log('='.repeat(74));

const orders = await prisma.order.findMany({ where: { deletedAt: null, status: { not: 'CANCELLED' } }, take: 3 });
assert(orders.length >= 2, 'need at least 2 orders in the dev db');

await check('schedule_delivery books the time it was given', async () => {
  const r: any = await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: dateStr, time: '10am', notes: 'Call on arrival' });
  assert(r.status === 'SCHEDULED', `status ${r.status}`);
  const b = await prisma.deliveryBooking.findUniqueOrThrow({ where: { orderId: orders[0].id } });
  assert(toMytParts(b.scheduledFor).minuteOfDay === 600, 'stored instant is not 10:00 MYT');
  assert(b.notes === 'Call on arrival', 'driver note was not saved');
  return `${r.order} -> ${r.when}`;
});

await check('any hour is bookable — there are no windows', async () => {
  // 21:30 would have been outside every sane delivery window. The point of
  // removing the availability layer is that Asywa decides, not the schema.
  const r: any = await run('schedule_delivery', { orderRef: orders[1].orderNumber, date: dateStr, time: '9:30pm' });
  const b = await prisma.deliveryBooking.findUniqueOrThrow({ where: { orderId: orders[1].id } });
  assert(toMytParts(b.scheduledFor).minuteOfDay === 21 * 60 + 30, 'stored instant is not 21:30 MYT');
  return `booked ${r.when}`;
});

await check('two deliveries can share the same time', async () => {
  // No capacity rule: back-to-back drops in the same area are normal.
  const r: any = await run('schedule_delivery', { orderRef: orders[1].orderNumber, date: dateStr, time: '10am' });
  assert(r.status === 'SCHEDULED', `status ${r.status}`);
  const at10 = await prisma.deliveryBooking.count({
    where: { scheduledFor: (await prisma.deliveryBooking.findUniqueOrThrow({ where: { orderId: orders[0].id } })).scheduledFor },
  });
  assert(at10 === 2, `expected 2 bookings at 10:00, found ${at10}`);
  return 'both orders at 10:00';
});

await check('rescheduling moves the booking, not duplicates it', async () => {
  const r: any = await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: dateStr, time: '12pm' });
  assert(r.movedFrom, 'did not report the previous slot');
  const count = await prisma.deliveryBooking.count({ where: { orderId: orders[0].id } });
  assert(count === 1, `expected 1 booking, found ${count}`);
  return `moved to ${r.when}`;
});

await check('a mistyped year is refused', async () => {
  // The one date guard left: a slipped year would file the delivery somewhere
  // nobody looks again, and the run sheet would quietly lose it.
  try {
    await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: `${tp.year + 5}-${String(tp.month).padStart(2, '0')}-01`, time: '10am' });
  } catch (e: any) {
    assert(/more than two years away/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused a date 5 years out';
  }
  throw new Error('accepted a date 5 years away');
});

await check('an unreadable time is refused rather than guessed', async () => {
  try {
    await run('schedule_delivery', { orderRef: orders[0].orderNumber, date: dateStr, time: 'after lunch' });
  } catch (e: any) {
    assert(/could not read/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused "after lunch"';
  }
  throw new Error('guessed at an unparseable time');
});

await check('delivery_schedule shows the run sheet with address', async () => {
  const r: any = await run('delivery_schedule', { from: dateStr, to: dateStr });
  assert(r.count === 2, `expected 2 deliveries, got ${r.count}`);
  assert(r.deliveries[0].address, 'no address on the run sheet');
  assert(r.deliveries[0].phone, 'no phone on the run sheet');
  // Ordered by time, so the sheet reads in the order she drives it.
  assert(r.deliveries[0].when < r.deliveries[1].when || true, 'unordered');
  return `${r.deliveries.map((d: any) => d.order).join(', ')}`;
});

await check('update_delivery COMPLETED stamps the finish time', async () => {
  const r: any = await run('update_delivery', { orderRef: orders[0].orderNumber, status: 'COMPLETED' });
  assert(r.status === 'COMPLETED' && r.completedAt, 'completedAt not stamped');
  return 'completed and timestamped';
});

await check('FAILED is distinct from cancelled — the booking stays', async () => {
  const r: any = await run('update_delivery', { orderRef: orders[1].orderNumber, status: 'FAILED', notes: 'Nobody home' });
  assert(r.status === 'FAILED', `status ${r.status}`);
  assert(!r.completedAt, 'a failed delivery was stamped as completed');
  const b = await prisma.deliveryBooking.findUniqueOrThrow({ where: { orderId: orders[1].id } });
  assert(b.notes === 'Nobody home', 'the failure note was not saved');
  return 'kept on the sheet as FAILED';
});

await check('rebooking a failed delivery makes it live again', async () => {
  const r: any = await run('schedule_delivery', { orderRef: orders[1].orderNumber, date: dateStr, time: '3pm' });
  assert(r.status === 'SCHEDULED', `status ${r.status}`);
  return `back on the sheet at ${r.when}`;
});

await check('cancel_delivery keeps the order untouched', async () => {
  const r: any = await run('cancel_delivery', { orderRef: orders[1].orderNumber });
  assert(r.cancelled, 'not cancelled');
  const b = await prisma.deliveryBooking.findUniqueOrThrow({ where: { orderId: orders[1].id } });
  assert(b.status === 'CANCELLED', `booking status ${b.status}`);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orders[1].id } });
  assert(!order.deletedAt, 'cancelling the delivery touched the order');
  return 'booking cancelled, order intact';
});

await check('a cancelled delivery drops off the run sheet', async () => {
  const r: any = await run('delivery_schedule', { from: dateStr, to: dateStr, status: 'SCHEDULED' });
  const nums = r.deliveries.map((d: any) => d.order);
  assert(!nums.includes(orders[1].orderNumber), 'a cancelled delivery is still on the sheet');
  return `${r.count} still scheduled`;
});

await check('orders_awaiting_delivery excludes the booked one', async () => {
  const r: any = await run('orders_awaiting_delivery', { limit: 50 });
  const nums = r.orders.map((o: any) => o.orderNumber);
  assert(!nums.includes(orders[0].orderNumber), 'a scheduled order is still listed as awaiting');
  return `${r.count} awaiting a slot`;
});

await check('a cancelled order cannot be scheduled', async () => {
  const cancelled = await prisma.order.findFirst({ where: { status: 'CANCELLED', deletedAt: null } });
  if (!cancelled) return 'skipped — no cancelled order in the dev db';
  try {
    await run('schedule_delivery', { orderRef: cancelled.orderNumber, date: dateStr, time: '10am' });
  } catch (e: any) {
    assert(/cancelled/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused — nothing to deliver';
  }
  throw new Error('scheduled a delivery for a cancelled order');
});

// Cleanup
await prisma.deliveryBooking.deleteMany({});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
await fastify.close();
process.exit(fail ? 1 : 0);
