/**
 * The yes/no flow on WhatsApp, replayed through the real code with a
 * scripted model — no OpenRouter call, no credit spent.
 *
 * Everything around the model is real: the message gate, the parked action,
 * approveAction, the resumed turn, the guards and the relay that builds the
 * reply. Only what the model says is fixed, so each case is the exact shape
 * that went wrong in the Ascend MY group:
 *
 *  - 22 Oct, ASC2610/0027 + 0029: "Yes", the action ran, the model returned
 *    nothing twice → "I ran that but have nothing to report back".
 *  - 22 Oct, ASC2610/0046: "Yes paid on waldo only" quoting the confirmation
 *    was read as moving on and cancelled it; after approval the model said
 *    "Still waiting on your *yes*".
 *  - 21 Oct: one web search made every change in the group wait for a yes,
 *    for good.
 *
 * The write used is update_variant (stock) on a real variant, restored at the
 * end: it sends no email and touches nothing else. Runs on the local database.
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-agent-approval.ts
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { scriptCompletions, type CompletionOptions, type CompletionResult } from '../src/modules/ai-agent/core/provider.js';
import { handleMessage, CONFIRM_SUFFIX, type InboundMessage } from '../src/modules/ai-agent/agent.service.js';
import { WEB_TAINT_MS } from '../src/modules/ai-agent/core/run.js';
import { normalizePhone } from '../src/utils/phone.js';

const fastify = Fastify({ logger: false });
await fastify.register(prismaPlugin);
const prisma = fastify.prisma;

const PHONE = '60100000777';
const GROUP = '999000777000@g.us';
const variant = await prisma.productVariant.findFirstOrThrow({ where: { active: true }, orderBy: { createdAt: 'asc' } });
const originalStock = variant.stock;
// A throwaway operator and group, so the real gate lets the messages in.
await prisma.whatsAppOperator.upsert({
  where: { phone: normalizePhone(PHONE) },
  create: { phone: normalizePhone(PHONE), name: 'Approval Test', canWrite: true, morningBrief: false },
  update: { active: true, canWrite: true },
});
await prisma.whatsAppGroup.upsert({
  where: { groupJid: GROUP },
  create: { groupJid: GROUP, subject: 'Approval test', requireMention: false },
  update: { active: true },
});

// ---------------------------------------------------------------- the script

type Step = { tool: string; args: Record<string, unknown> } | { text: string };
let queue: Step[] = [];
let calls = 0;
scriptCompletions(async (_opts: CompletionOptions): Promise<CompletionResult> => {
  calls++;
  const step = queue.shift();
  if (!step) throw new Error('the model was called more times than the script has steps');
  return {
    text: 'text' in step ? step.text : '',
    reasoning: '',
    reasoningDetails: null,
    toolCalls: 'tool' in step ? [{ id: `call_${calls}`, name: step.tool, arguments: JSON.stringify(step.args) }] : [],
    finishReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, costUsd: 0 },
    model: 'script',
  };
});

// ---------------------------------------------------------------- harness

let pass = 0;
let fail = 0;
const failures: string[] = [];
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

async function cleanThread() {
  const thread = await prisma.agentThread.findUnique({ where: { chatKey: `group:${GROUP}` } });
  if (!thread) return;
  await prisma.agentAction.deleteMany({ where: { threadId: thread.id } });
  await prisma.agentMessage.deleteMany({ where: { threadId: thread.id } });
  await prisma.agentThread.delete({ where: { id: thread.id } });
}

async function check(name: string, fn: () => Promise<string>) {
  await cleanThread();
  await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: originalStock } });
  queue = [];
  try {
    const detail = await fn();
    assert(queue.length === 0, `${queue.length} scripted step(s) never used`);
    console.log(`✓ ${name.padEnd(58)} ${detail}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name.padEnd(58)} ${e?.message ?? e}`);
    fail++;
    failures.push(`${name}: ${e?.message ?? e}`);
  }
}

const say = async (text: string, quoted?: string): Promise<string> => {
  const msg: InboundMessage = {
    kind: 'group',
    senderPhone: PHONE,
    senderName: 'Approval Test',
    text,
    groupJid: GROUP,
    groupSubject: 'Approval test',
    mentionsBot: true,
    ...(quoted ? { quoted: { text: quoted, fromBot: true } } : {}),
  };
  const out = await handleMessage(fastify, msg);
  assert(out.action === "reply", `expected a reply, got ${out.action}: ${(out as any).reason}`);
  return (out as { text: string }).text;
};

const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
const pendingCount = async () => {
  const thread = await prisma.agentThread.findUnique({ where: { chatKey: `group:${GROUP}` } });
  return thread ? prisma.agentAction.count({ where: { threadId: thread.id, status: 'pending' } }) : 0;
};

// A web page read `ago` ms before now, as the browser tool leaves it.
async function webRead(agoMs: number) {
  await say('hi');
  const thread = await prisma.agentThread.findUniqueOrThrow({ where: { chatKey: `group:${GROUP}` } });
  const max = await prisma.agentMessage.aggregate({ where: { threadId: thread.id }, _max: { seq: true } });
  const seq = (max._max.seq ?? 0) + 1;
  const at = new Date(Date.now() - agoMs);
  await prisma.agentMessage.create({
    data: { threadId: thread.id, seq, role: 'assistant', createdAt: at, content: { toolCalls: [{ id: 'web1', name: 'browser_navigate', input: { url: 'https://example.com' } }] } },
  });
  await prisma.agentMessage.create({
    data: { threadId: thread.id, seq: seq + 1, role: 'tool', createdAt: at, content: { toolResults: [{ id: 'web1', name: 'browser_navigate', output: { text: '- Page URL: https://example.com' } }] } },
  });
}

const target = originalStock + 7;
const setStock = { tool: 'update_variant', args: { variantId: variant.id, stock: target } };
const ASKED = { text: "I've asked for your go-ahead to change the stock." };

/** A web page read just now, then a change asked for and parked. Returns the confirmation Abby sent. */
async function parkedChange(): Promise<string> {
  queue.push({ text: 'Hello.' });
  await webRead(60_000);
  queue.push(setStock, ASKED);
  const reply = await say('set the stock');
  assert(reply.includes(CONFIRM_SUFFIX), `no confirmation prompt in: ${reply.slice(0, 160)}`);
  assert((await stock()) === originalStock, 'stock changed before approval');
  assert((await pendingCount()) === 1, 'nothing parked');
  return reply;
}

console.log('='.repeat(96));
console.log('APPROVAL FLOW — real code, scripted model');
console.log('='.repeat(96));

// ---------------------------------------------------------------- web flag

await check('fresh web read: a change waits for a yes', async () => {
  await parkedChange();
  return 'parked, stock untouched';
});

await check('web read older than the window: a change just runs', async () => {
  queue.push({ text: 'Hello.' });
  await webRead(WEB_TAINT_MS + 5 * 60_000);
  queue.push(setStock, { text: `Done — stock is now ${target}.` });
  const reply = await say('set the stock');
  assert(!reply.includes(CONFIRM_SUFFIX), `asked for a yes anyway: ${reply.slice(0, 160)}`);
  assert((await stock()) === target, `stock is ${await stock()}, expected ${target}`);
  return `ran straight away (${WEB_TAINT_MS / 3_600_000} h window)`;
});

// ---------------------------------------------------------------- approvals

await check('0027: bare "Yes", model returns nothing twice', async () => {
  await parkedChange();
  queue.push({ text: '' }, { text: '' });
  const reply = await say('Yes');
  assert((await stock()) === target, 'not carried out');
  assert(!/nothing to report back/i.test(reply), `generic fallback: ${reply}`);
  assert(/approved and carried out/i.test(reply), `does not say it was done: ${reply}`);
  return reply.slice(0, 60);
});

await check('0046: "Yes paid on waldo only" quoting the prompt approves', async () => {
  const prompt = await parkedChange();
  queue.push({ text: `Done ✅ stock is now ${target}.` });
  const reply = await say('Yes paid on waldo only', prompt);
  assert((await stock()) === target, 'not carried out');
  assert(!reply.includes(CONFIRM_SUFFIX), `asked again: ${reply.slice(0, 160)}`);
  return 'approved on the quoted yes';
});

await check('0046: model says "still waiting on your yes" after approval', async () => {
  await parkedChange();
  queue.push({ text: "Still waiting on your *yes* to release it — the system needs a fresh approval line. Reply *yes* and it'll go straight through." });
  const reply = await say('yes');
  assert((await stock()) === target, 'not carried out');
  assert(!/waiting|reply \*?yes/i.test(reply), `false "waiting" reached the chat: ${reply}`);
  assert(/approved and carried out/i.test(reply), `does not say it was done: ${reply}`);
  return 'replaced with what was done';
});

await check('unquoted "Yes waldo only paid" asks once, keeps it parked', async () => {
  await parkedChange();
  const reply = await say('Yes waldo only paid');
  assert(reply.startsWith('Is that a yes to'), `unexpected reply: ${reply.slice(0, 160)}`);
  assert((await pendingCount()) === 1, 'the action was dropped');
  assert((await stock()) === originalStock, 'ran without a clear yes');
  queue.push({ text: `Done ✅ stock is now ${target}.` });
  await say('yes');
  assert((await stock()) === target, 'the following "yes" did not carry it out');
  return 'asked, then the yes went through';
});

await check('"ok what\'s the latest order?" is not a yes', async () => {
  await parkedChange();
  queue.push({ text: 'The latest order is …' });
  await say("ok what's the latest order?");
  assert((await stock()) === originalStock, 'a question approved the change');
  assert((await pendingCount()) === 0, 'still parked after the operator moved on');
  return 'dropped, nothing changed';
});

await check('"no" cancels, nothing changes', async () => {
  await parkedChange();
  const reply = await say('no');
  assert((await stock()) === originalStock, 'changed after a no');
  assert(/cancelled/i.test(reply), `unexpected reply: ${reply}`);
  return reply;
});

await check('quoting an OLD confirmation does not approve a different one', async () => {
  const old = 'About to delete every order.\n\n' + CONFIRM_SUFFIX;
  await parkedChange();
  const reply = await say('yes go', old);
  assert((await stock()) === originalStock, 'approved on a quote of something else');
  assert(reply.startsWith('Is that a yes to'), `unexpected reply: ${reply.slice(0, 160)}`);
  return 'asked which, nothing changed';
});

// ---------------------------------------------------------------- done

scriptCompletions(null);
await cleanThread();
await prisma.productVariant.update({ where: { id: variant.id }, data: { stock: originalStock } });
await prisma.whatsAppGroup.delete({ where: { groupJid: GROUP } });
await prisma.whatsAppOperator.delete({ where: { phone: normalizePhone(PHONE) } });
const restored = await stock();
console.log('='.repeat(96));
console.log(`${pass} passed, ${fail} failed · stock restored to ${restored} (was ${originalStock})`);
if (failures.length) for (const f of failures) console.log(`  ✗ ${f}`);
await fastify.close();
process.exit(fail || restored !== originalStock ? 1 : 0);
