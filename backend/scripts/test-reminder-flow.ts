/**
 * Reminders end to end against the database: set → due → swept → settled.
 *
 * The sweep's send is stubbed rather than hitting the real worker — the point
 * under test is the lifecycle and the ROUTING (does it go back to the group it
 * was set in, or to the operator it was addressed to), not baileys. What the
 * stub captures is exactly what the worker would have been asked to send.
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-reminder-flow.ts
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { getTool } from '../src/modules/ai-agent/registry.js';
import type { ToolContext } from '../src/modules/ai-agent/tool-kit.js';
import { processDueReminders } from '../src/utils/reminder-sweep.js';

const fastify = Fastify({ logger: false });
await fastify.register(prismaPlugin);
const prisma = fastify.prisma;

const GROUP_KEY = 'group:120999test@g.us';

const ctx: ToolContext = {
  fastify,
  prisma,
  actor: { phone: '0123456789', name: 'Test Operator', canWrite: true },
  origin: { kind: 'group', chatKey: GROUP_KEY, label: 'this group — Ops' },
  revalidate: () => {},
};
const run = (tool: string, input: any) => getTool(tool)!.run(ctx, input);

let pass = 0;
let fail = 0;
const failures: string[] = [];
const check = async (name: string, fn: () => Promise<string>) => {
  try {
    console.log(`✓ ${name.padEnd(56)} ${await fn()}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name.padEnd(56)} ${e?.message}`);
    fail++;
    failures.push(name);
  }
};
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(m);
};

// Only this test's own rows are removed — a real pending reminder in the dev
// database must survive a test run.
const CLEANUP = { createdByPhone: '0123456789', createdInChatKey: GROUP_KEY };
await prisma.agentReminder.deleteMany({ where: CLEANUP });

await prisma.whatsAppOperator.upsert({
  where: { phone: '0123456789' },
  create: { phone: '0123456789', name: 'Test Operator', active: true, canWrite: true },
  update: { active: true, name: 'Test Operator' },
});
await prisma.whatsAppOperator.upsert({
  where: { phone: '0198887777' },
  create: { phone: '0198887777', name: 'Asywa Driver', active: true, canWrite: true },
  update: { active: true, name: 'Asywa Driver' },
});

console.log('='.repeat(78));
console.log('AGENT REMINDERS — lifecycle, routing, and the customer guard');
console.log('='.repeat(78));

// ------------------------------------------------------------------ creating

await check('set_reminder defaults to the chat it was asked in', async () => {
  const r: any = await run('set_reminder', { message: 'Chase the RM145 transfer', when: 'in 2 hours' });
  assert(r.goesTo === 'this group — Ops', `went to ${r.goesTo}`);
  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.targetChatKey === GROUP_KEY, `stored key ${row.targetChatKey}`);
  assert(row.status === 'PENDING', `status ${row.status}`);
  return `→ ${r.goesTo}, ${r.when}`;
});

await check('"me" routes to the requester\'s DM even when asked in a group', async () => {
  const r: any = await run('set_reminder', { message: 'Personal note', when: 'in 3 hours', to: 'me' });
  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.targetChatKey === 'dm:0123456789', `stored key ${row.targetChatKey}`);
  return `→ ${r.goesTo}`;
});

await check('an operator can be addressed by name', async () => {
  const r: any = await run('set_reminder', { message: 'Load the van', when: 'tomorrow 8am', to: 'Asywa' });
  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.targetChatKey === 'dm:0198887777', `stored key ${row.targetChatKey}`);
  return `→ ${r.goesTo}`;
});

await check('an operator can be addressed by number', async () => {
  const r: any = await run('set_reminder', { message: 'Check stock', when: 'tomorrow 9am', to: '0198887777' });
  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.targetChatKey === 'dm:0198887777', `stored key ${row.targetChatKey}`);
  return `→ ${r.goesTo}`;
});

await check('a NON-operator number is refused — the agent cannot message customers', async () => {
  // The guarantee this protects: the only thing that ever reaches a customer
  // is a transactional email. A scheduled free-text message to any number
  // would quietly remove that.
  try {
    await run('set_reminder', { message: 'Pay your invoice', when: 'tomorrow 9am', to: '0111234567' });
  } catch (e: any) {
    assert(/not one of the allowlisted operators/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused a number that is not an operator';
  }
  throw new Error('scheduled a message to an arbitrary number');
});

await check('an unreadable time is refused rather than guessed', async () => {
  try {
    await run('set_reminder', { message: 'Something', when: 'sometime next week' });
  } catch (e: any) {
    assert(/could not read/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused "sometime next week"';
  }
  throw new Error('guessed at an unparseable time');
});

await check('a reminder can be attached to an order', async () => {
  const order = await prisma.order.findFirstOrThrow({ where: { deletedAt: null } });
  const r: any = await run('set_reminder', {
    message: 'Follow up on this order',
    when: 'in 4 hours',
    orderRef: order.orderNumber,
    topic: 'payment chase',
  });
  assert(r.order === order.orderNumber, `order ${r.order}`);
  const found: any = await run('list_reminders', { orderRef: order.orderNumber });
  assert(found.count >= 1, 'not listed against the order');
  return `attached to ${order.orderNumber}`;
});

// ------------------------------------------------------------------ listing

await check('list_reminders shows what is pending', async () => {
  const r: any = await run('list_reminders', { mine: true });
  assert(r.count >= 5, `expected the ones just set, got ${r.count}`);
  assert(r.reminders[0].when, 'no human-readable time on the row');
  return `${r.count} pending`;
});

// ------------------------------------------------------------------ cancelling

await check('cancel_reminder settles a pending one', async () => {
  const list: any = await run('list_reminders', { mine: true });
  const target = list.reminders[0];
  const r: any = await run('cancel_reminder', { reminderId: target.reminderId });
  assert(r.cancelled, 'not cancelled');
  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: target.reminderId } });
  assert(row.status === 'CANCELLED', `status ${row.status}`);
  return 'CANCELLED';
});

await check('cancelling something already settled is refused, not reported as done', async () => {
  const cancelled = await prisma.agentReminder.findFirstOrThrow({
    where: { ...CLEANUP, status: 'CANCELLED' },
  });
  try {
    await run('cancel_reminder', { reminderId: cancelled.id });
  } catch (e: any) {
    assert(/nothing to cancel/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused a second cancel';
  }
  throw new Error('reported success cancelling an already-cancelled reminder');
});

// ------------------------------------------------------------------ the sweep

// Capture what the sweep would have sent, instead of reaching the real worker.
// processDueReminders takes the sender as a parameter for exactly this reason —
// ES modules are frozen, so there is no patching a real export at runtime.
const sent: { target: any; text: string }[] = [];
const capture = async (target: any, text: string) => {
  sent.push({ target, text });
};
const failing = async () => {
  throw new Error('WhatsApp not connected');
};

await check('a due reminder is sent and marked SENT', async () => {
  const r: any = await run('set_reminder', { message: 'Fire me now', when: 'in 2 hours' });
  // Make it due without waiting two hours.
  await prisma.agentReminder.update({
    where: { id: r.reminderId },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });

  sent.length = 0;
  await processDueReminders(fastify, capture);

  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.status === 'SENT', `status ${row.status}`);
  assert(row.sentAt, 'no sentAt stamped');
  assert(sent.length === 1, `expected 1 send, got ${sent.length}`);
  assert(sent[0].text.includes('Fire me now'), `message not in the text: ${sent[0].text}`);
  return 'delivered and settled';
});

await check('it was addressed to the group it was set in', async () => {
  // Routing is the whole point of targetChatKey — a group key must become a
  // jid, never a phone.
  assert(sent[0].target.jid === '120999test@g.us', `addressed to ${JSON.stringify(sent[0].target)}`);
  assert(!sent[0].target.phone, 'a group was addressed by phone');
  return `jid ${sent[0].target.jid}`;
});

await check('a DM reminder is addressed by phone, not jid', async () => {
  const r: any = await run('set_reminder', { message: 'DM routing', when: 'in 2 hours', to: 'Asywa' });
  await prisma.agentReminder.update({
    where: { id: r.reminderId },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });
  sent.length = 0;
  await processDueReminders(fastify, capture);
  assert(sent.length === 1, `expected 1 send, got ${sent.length}`);
  assert(sent[0].target.phone === '0198887777', `addressed to ${JSON.stringify(sent[0].target)}`);
  return `phone ${sent[0].target.phone}`;
});

await check('an already-sent reminder is not sent twice', async () => {
  sent.length = 0;
  await processDueReminders(fastify, capture);
  assert(sent.length === 0, `re-sent ${sent.length} settled reminders`);
  return 'sweep is idempotent';
});

await check('a cancelled reminder never fires, even once due', async () => {
  const r: any = await run('set_reminder', { message: 'Should never arrive', when: 'in 2 hours' });
  await run('cancel_reminder', { reminderId: r.reminderId });
  await prisma.agentReminder.update({
    where: { id: r.reminderId },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });
  sent.length = 0;
  await processDueReminders(fastify, capture);
  assert(sent.length === 0, 'a cancelled reminder was sent');
  return 'stayed silent';
});

await check('a send failure retries rather than losing the reminder', async () => {
  const r: any = await run('set_reminder', { message: 'Retry me', when: 'in 2 hours' });
  await prisma.agentReminder.update({
    where: { id: r.reminderId },
    data: { dueAt: new Date(Date.now() - 60_000) },
  });
  await processDueReminders(fastify, failing);

  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.status === 'PENDING', `should still be pending, got ${row.status}`);
  assert(row.attempts === 1, `attempts ${row.attempts}`);
  assert(row.nextAttemptAt.getTime() > Date.now(), 'no backoff applied');
  assert(/not connected/i.test(row.lastError ?? ''), `lastError ${row.lastError}`);
  return `still PENDING, retry after backoff (${row.lastError})`;
});

await check('a reminder more than 24h overdue is settled, not sent late', async () => {
  const r: any = await run('set_reminder', { message: 'Ancient', when: 'in 2 hours' });
  await prisma.agentReminder.update({
    where: { id: r.reminderId },
    data: { dueAt: new Date(Date.now() - 48 * 60 * 60_000) },
  });
  await processDueReminders(fastify, capture);
  const row = await prisma.agentReminder.findUniqueOrThrow({ where: { id: r.reminderId } });
  assert(row.status === 'FAILED', `status ${row.status}`);
  assert(/within 24h/i.test(row.lastError ?? ''), `lastError ${row.lastError}`);
  return 'expired rather than arriving days late';
});

// Cleanup
await prisma.agentReminder.deleteMany({ where: CLEANUP });
await prisma.agentReminder.deleteMany({ where: { createdByPhone: '0123456789' } });

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
await fastify.close();
process.exit(fail ? 1 : 0);
