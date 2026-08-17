/**
 * Grounding regression corpus — the real failures, replayed end to end.
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-agent-grounding.ts
 *
 * Requires the API running on PORT, OPENROUTER_API_KEY set, and
 * AGENT_GROUNDING_MODE=enforce in the API's environment.
 *
 * `test-grounding-unit.ts` proves the guard classifies correctly. This proves
 * the WHOLE PATH behaves: that a real model, given a real question against real
 * data, cannot get an unchecked answer past the turn loop and out to an
 * operator.
 *
 * Every scenario here is a thing that actually happened in production:
 *
 *   - 5 Aug   "Yuh" (give me the full order) answered off a list_orders summary
 *             with invented items and another customer's address.
 *   - 17 Aug  "Full detail pls" answered the same way, then "no address on
 *             file" for an order that had one.
 *   - 17 Aug  "calment" — one letter wrong — found nothing at all.
 *   - 17 Aug  "No the latest order ab, try again" swallowed by the confirmation
 *             regex and answered with a canned "nothing was pending".
 *
 * ASSERT ON INVARIANTS, NOT ON WORDING. The model is nondeterministic and its
 * phrasing changes between runs and between models; what must never change is
 * that a detail claim is backed by a get_order, and that a misspelling still
 * finds the order. Asserting on prose here would produce a suite that fails for
 * the wrong reasons and gets ignored — which is how this class of bug survived
 * twelve days in the first place.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { checkGrounding } from '../src/modules/ai-agent/grounding.js';
import { ensureTestOperators } from './_agent-fixtures.js';

const API = `http://127.0.0.1:${process.env.PORT || 3105}`;
const TOKEN = process.env.WORKER_HTTP_TOKEN || 'local-dev-worker-token';
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const WRITER = '60123456789';
const CHAT_KEY = 'dm:0123456789';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`   \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`   \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function send(text: string) {
  const res = await fetch(`${API}/api/v1/internal/agent/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ kind: 'dm', senderPhone: WRITER, senderName: 'Test Operator', text }),
    signal: AbortSignal.timeout(180_000),
  });
  return (await res.json()) as { action: string; text?: string; reason?: string };
}

async function resetThread() {
  await prisma.agentConversation.deleteMany({ where: { chatKey: CHAT_KEY } });
  await prisma.agentPendingAction.deleteMany({ where: { actorPhone: '0123456789' } });
}

async function toolsSince(since: Date): Promise<{ names: string[]; results: { tool: string; result: string }[] }> {
  const rows = await prisma.agentToolCall.findMany({
    where: { createdAt: { gt: since } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    names: rows.map((r) => r.toolName),
    results: rows.map((r) => ({ tool: r.toolName, result: r.result })),
  };
}

/** A real order to ask about, with items and an address — like the ones both incidents involved. */
async function pickSubject() {
  const order = await prisma.order.findFirst({
    where: { deletedAt: null, address: { not: '' }, items: { some: {} } },
    include: { items: { include: { variant: { include: { product: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  if (!order) throw new Error('No order with items and an address in this database — seed one first.');
  return order;
}

async function main() {
  await ensureTestOperators(prisma);
  const order = await pickSubject();
  console.log(`\nSubject order: ${order.orderNumber} — ${order.customerName}`);
  console.log(`  real address: ${order.address}`);
  console.log(`  real items:   ${order.items.map((i) => i.variant.product.name).join(', ')}\n`);

  // ---- 1. The 5 Aug / 17 Aug fabrication, reproduced exactly: force a
  //         summary-only lookup first, then ask for detail it cannot contain.
  console.log('=== detail must not be answered from a summary ===\n');
  await resetThread();
  await send(`list the orders for ${order.customerName}`);
  let t0 = new Date();
  let r = await send('full detail pls — items and address');
  let after = await toolsSince(t0);

  // The invariant is NOT "get_order always runs" — a model that asks "which
  // order did you mean?" has behaved perfectly and called nothing. What must
  // never happen is a DETAIL CLAIM without the lookup that supports it. Asserting
  // the tool call unconditionally made this fail on a turn where the agent was
  // right to ask a question first.
  const claimsDetail = /\bitems?\b|\baddress\b|\bx\s?\d+\b|RM\s?\d/i.test(r.text ?? '');
  check(
    'no detail claim without get_order',
    !claimsDetail || after.names.includes('get_order'),
    `claimsDetail=${claimsDetail} ran: ${after.names.join(', ') || 'nothing'} | ${(r.text ?? '').slice(0, 110)}`
  );
  const verdict = checkGrounding({
    reply: r.text ?? '',
    toolResults: after.results,
    operatorText: 'full detail pls — items and address',
  });
  check(
    'the delivered reply is grounded in this turn\'s tools',
    verdict.violations.length === 0,
    verdict.violations.map((v) => v.detail).slice(0, 3).join(' | ')
  );

  // The specific 17 Aug lie: an address that exists, reported as absent.
  const claimsNoAddress = /\b(no|not yet|isn'?t|hasn'?t got an?)\b[^.\n]{0,30}\baddress\b|\baddress\b[^.\n]{0,20}\b(not (yet )?(on file|set|recorded)|missing|empty)\b/i.test(
    r.text ?? ''
  );
  check('does not deny an address that exists', !claimsNoAddress, (r.text ?? '').slice(0, 160));

  // ---- 2. Misspelled name still resolves (the "calment" round trip).
  console.log('\n=== a misspelled customer name still finds the order ===\n');
  await resetThread();
  const misspelled = misspell(order.customerName);
  t0 = new Date();
  r = await send(`pull me the order for ${misspelled}`);
  after = await toolsSince(t0);
  const foundIt = (r.text ?? '').includes(order.orderNumber);
  check(
    `"${misspelled}" resolves to ${order.orderNumber}`,
    foundIt,
    `ran: ${after.names.join(', ')} | reply: ${(r.text ?? '').slice(0, 120)}`
  );

  // ---- 3. The confirmation regex must not swallow a real instruction.
  console.log('\n=== a sentence starting with "no" is not a cancellation ===\n');
  await resetThread();
  r = await send('No the latest order ab, try again');
  check(
    'answered the question instead of "nothing was pending"',
    !/nothing was pending/i.test(r.text ?? ''),
    (r.text ?? '').slice(0, 140)
  );

  r = await send('ok what is the latest order');
  // Assert on the dead-end this bug produced, not on words that also occur in
  // the data — the first version of this check matched "CONFIRMED" as an order
  // STATUS and failed on a completely correct answer.
  check(
    '"ok …" is answered, not swallowed as a bare confirmation',
    !/nothing was pending|what would you like me to do|i(?:'m| am) not sure what.*confirm/i.test(r.text ?? '') &&
      /ASC\d{4}\/\d{4}|no orders/i.test(r.text ?? ''),
    (r.text ?? '').slice(0, 140)
  );

  // ---- 4. Two operators at once get one turn each, in order.
  console.log('\n=== concurrent messages on one thread are serialised ===\n');
  await resetThread();
  const started = new Date();
  const [a, b] = await Promise.all([send('how many orders today'), send('and what is our lowest stock item')]);
  const bothAnswered = !!a.text && !!b.text && a.text !== b.text;
  check('both concurrent messages got their own reply', bothAnswered);
  const stored = await prisma.agentMessage.count({
    where: { conversation: { chatKey: CHAT_KEY }, createdAt: { gt: started }, role: 'assistant' },
  });
  check('exactly two assistant turns were stored, not a race', stored === 2, `stored ${stored}`);

  // ---- 5. Whatever else happened, nothing ungrounded reached the operator.
  console.log('\n=== no ungrounded reply was delivered during this run ===\n');
  const suppressed = await prisma.agentGroundingEvent.count({
    where: { createdAt: { gt: started }, suppressed: true },
  });
  const events = await prisma.agentGroundingEvent.findMany({
    where: { createdAt: { gt: new Date(Date.now() - 10 * 60_000) } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(
    `   ${events.length} grounding event(s) this run: ${events
      .map((e) => `${e.repaired ? 'repaired' : e.suppressed ? 'suppressed' : e.mode}`)
      .join(', ') || 'none'}`
  );
  check('no reply had to be suppressed outright', suppressed === 0, `${suppressed} suppressed`);

  await resetThread();
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log(`failed: ${failures.join(' | ')}`);
  console.log('='.repeat(70));
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

/** Swap one interior letter — the same shape of typo as "calment" for "Calmant". */
function misspell(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  if (first.length < 4) return first;
  const i = Math.floor(first.length / 2);
  const swap = first[i].toLowerCase() === 'a' ? 'e' : 'a';
  return first.slice(0, i) + swap + first.slice(i + 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
