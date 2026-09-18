/**
 * Context-management tests: rolling compaction, and the load_context escape
 * hatch when keyword routing misses.
 *
 * Neither mechanism is reachable from the other suites — compaction needs a
 * thread longer than COMPACT_TRIGGER, and load_context only fires on a message
 * whose keywords point at the wrong domain. Both are exactly the kind of thing
 * that looks fine until an operator hits it in month three, so they get their
 * own harness.
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-agent-context.ts
 *
 * Requires the API running on PORT and OPENROUTER_API_KEY set.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { routeDomains } from '../src/modules/ai-agent/domains.js';
import { toolsFor } from '../src/modules/ai-agent/registry.js';
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
  });
  return (await res.json()) as any;
}

async function resetThread() {
  await prisma.agentThread.deleteMany({ where: { chatKey: CHAT_KEY } });
}

// A distinctive fact planted early in the thread, far enough back that it is
// guaranteed to be inside the compacted region by the time it is asked about.
// If compaction is working, the agent can still answer; if the old `take: 16`
// truncation were still in place, this is precisely what would be lost.
const PLANTED = 'our courier is Skynet and the account number is SKY-7781';

// Compaction is triggered by SIZE, not row count (COMPACT_AT_CHARS in
// core/run.ts): a month of short WhatsApp turns and an afternoon of report
// dumps should compact on the same rule. The filler replies are padded so a
// modest number of turns crosses the threshold.
const PADDING = ' Full report follows. ' + 'Lorem ipsum stock levels and order notes. '.repeat(70);

async function seedLongThread(turns: number) {
  const thread = await prisma.agentThread.create({
    data: { chatKey: CHAT_KEY, kind: 'whatsapp', title: 'Test Operator · WhatsApp' },
  });

  const filler = [
    'whats stock looking like',
    'ok noted',
    'any orders today',
    'thanks',
    'hows revenue this week',
    'got it',
  ];

  let seq = 0;
  const row = (role: string, text: string) =>
    prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        seq: ++seq,
        role,
        content: { text },
        actorPhone: role === 'user' ? '0123456789' : null,
        actorName: role === 'user' ? 'Test Operator' : null,
      },
    });

  await row('user', `note for later: ${PLANTED}`);
  await row('assistant', `Noted — ${PLANTED}. I'll keep that in mind.`);
  for (let i = 0; i < turns; i++) {
    await row('user', filler[i % filler.length]);
    await row('assistant', `Sure — ${filler[i % filler.length]} handled.${PADDING}`);
  }
  return { threadId: thread.id, rows: seq };
}

const summaryRow = async (threadId: string) => {
  const rows = await prisma.agentMessage.findMany({ where: { threadId, role: 'system' }, orderBy: { seq: 'asc' } });
  const summaries = rows.filter((r) => r.content && typeof r.content === 'object' && 'replaces' in (r.content as object) && (r.content as any).summary !== '(superseded)');
  return { count: summaries.length, latest: summaries.at(-1)?.content as { summary: string; replaces: [number, number] } | undefined };
};

async function main() {
  // Sending as an operator that does not exist means the agent never runs at
  // all, and every assertion below fails for a reason none of them describe.
  await ensureTestOperators(prisma);
  console.log('\n=== agent context management ===\n');

  // ---------------------------------------------------------------- routing
  console.log('▸ routing narrows the tool list without dropping the core reads');
  const all = toolsFor(true).length;
  const narrowed = toolsFor(true, routeDomains('whats the stock on bpc-157')).length;
  check('catalog message gets a narrowed list', narrowed < all / 2, `${narrowed} of ${all}`);
  const core = toolsFor(true, routeDomains('promo code')).map((t) => t.name);
  check('core reads survive an unrelated route', core.includes('get_order') && core.includes('search_products'));

  console.log('\n▸ read-only operators still never receive write tools after routing');
  const roTools = toolsFor(false, routeDomains('delete order ASC2607/0019 and refund it'));
  check('no write tool in a routed read-only list', roTools.every((t) => !t.write), roTools.filter((t) => t.write).map((t) => t.name).join(','));

  // ------------------------------------------------------------- compaction
  console.log('\n▸ a long thread compacts instead of silently truncating');
  await resetThread();
  const seeded = await seedLongThread(40); // ~120k chars — past COMPACT_AT_CHARS (100k)

  const r1 = await send('what courier do we use and whats the account number?');
  const first = await summaryRow(seeded.threadId);

  console.log(`   seeded ${seeded.rows} rows; summary rows=${first.count}; replaces=${JSON.stringify(first.latest?.replaces)}`);
  check('a summary row was written', first.count === 1 && (first.latest?.summary.length ?? 0) > 20);
  check('the summary stands in for the oldest rows only', !!first.latest && first.latest.replaces[0] === 1 && first.latest.replaces[1] < seeded.rows, JSON.stringify(first.latest?.replaces));
  check('the planted row is inside the compacted range', !!first.latest && first.latest.replaces[1] >= 2);

  if (first.latest) console.log(`   summary: ${first.latest.summary.slice(0, 220).replace(/\n/g, ' ')}…`);
  console.log(`   reply: ${String(r1.text ?? r1.reason).slice(0, 200).replace(/\n/g, ' ')}`);

  // The real point of compaction: a fact from the dropped region survives.
  const reply = String(r1.text ?? '').toLowerCase();
  check('a fact from the compacted region survived', reply.includes('skynet') || reply.includes('sky-7781'));

  console.log('\n▸ compaction is not redone on every turn');
  const r2 = await send('thanks');
  const second = await summaryRow(seeded.threadId);
  check(
    'the summary held steady on the next turn',
    second.count === 1 && JSON.stringify(second.latest?.replaces) === JSON.stringify(first.latest?.replaces),
    `${JSON.stringify(first.latest?.replaces)} -> ${JSON.stringify(second.latest?.replaces)}`
  );
  void r2;

  // ----------------------------------------------------------- load_context
  console.log('\n▸ load_context recovers when routing misses the needed domain');
  await resetThread();

  // Carries no ops keyword ("operator", "access", "allowlist" all absent) but
  // can only be answered with an ops tool, and needs nothing clarified first —
  // so the model's only route to an answer is to widen its own context. A
  // probe that leaves room for a clarifying question does not test this: the
  // model will reasonably ask instead, and prove nothing either way.
  const probe = 'who else is allowed to message you?';
  const routed = routeDomains(probe);
  check('the router genuinely misses ops here', !routed.includes('ops'), routed.join(','));

  const since = new Date();
  const r3 = await send(probe);
  const calls = await prisma.agentAction.findMany({
    where: { actorPhone: '0123456789', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { tool: true, ok: true },
  });
  const names = calls.map((c) => c.tool);
  console.log(`   routed to: [${routed.join(',')}]`);
  console.log(`   tools ran: ${names.join(', ') || '(none)'}`);
  console.log(`   reply: ${String(r3.text ?? r3.reason).slice(0, 200).replace(/\n/g, ' ')}`);
  // load_context is handled inside the turn loop and leaves no action row by
  // design. The proof it fired is that a tool it had not been given ran anyway.
  check(
    'reached an ops tool despite the miss',
    names.includes('list_operators'),
    `ran: ${names.join(',') || 'nothing'}`
  );

  await resetThread();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log(`failed: ${failures.join(' | ')}`);
  console.log('='.repeat(70));
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
