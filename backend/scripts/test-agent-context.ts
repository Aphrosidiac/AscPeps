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
import { newPlaybooks, routeDomains } from '../src/modules/ai-agent/domains.js';
import { CLAIMS_MEMORY, keepFor } from '../src/modules/ai-agent/core/run.js';
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

  console.log('\n▸ the money reads are always on offer (21 Oct 2026 audit)');
  const promo = toolsFor(true, routeDomains('promo code')).map((t) => t.name);
  check('run_report_query, describe_database, month_end_report, finance_overview with no money keyword', ['run_report_query', 'describe_database', 'month_end_report', 'finance_overview'].every((n) => promo.includes(n)));
  check('"ab calc this month wrap" routes to reports', routeDomains('ab calc this month wrap').includes('reports'));

  console.log('\n▸ a widened area brings its rules, once');
  const fin = newPlaybooks(['finance'], ['orders']);
  check('finance brings the money-flow rules', /Money, from a sale/.test(fin));
  check('and not the order rules already loaded', !/How an order arrives/.test(fin));
  check('nothing new when the playbook is already in', newPlaybooks(['delivery'], ['orders']) === '');

  console.log('\n▸ promises to remember are recognised (real replies from the group, 21 Oct 2026)');
  for (const t of ['Understood — English only from here on, noted for good 👍', 'Memorised! Poha = Fakhrul. Won\'t forget again', 'Noted, boss! ✅ Filing that away permanently', 'Got it. From now on I\'ll only respond when I\'m @\'ed', "I'll remember that, boss"])
    check(`claim: "${t.slice(0, 40)}"`, CLAIMS_MEMORY.test(t));
  for (const t of ['Done — RT10 stock is at 0, Asywa ✅', 'Noted, sire — both orders stand as PAID and ready to pack.', 'Got it — no change made, books stay at 70/30', 'The memory file says the split is 70/30.'])
    check(`not a claim: "${t.slice(0, 40)}"`, !CLAIMS_MEMORY.test(t));

  console.log('\n▸ a recap keeps a sized tail');
  const big = (n: number, chars: number) => Array.from({ length: n }, (_, i) => ({ seq: i + 1, role: i % 2 ? 'assistant' : 'user', content: { text: 'x'.repeat(chars) } as any }));
  check('small rows: up to 12 kept', keepFor(big(40, 200)) === 12);
  check('huge rows: never fewer than 6', keepFor(big(40, 20_000)) === 6);
  check('mid rows: cut near 16k characters', keepFor(big(40, 2_500)) === 6 && keepFor(big(40, 1_000)) === 12);

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

  // ------------------------------------------------- memory: said = saved
  const memBefore = await prisma.agentMemoryFile.findMany();
  try {
    console.log('\n▸ "from now on…" is saved, not just "noted"');
    await resetThread();
    const since2 = new Date();
    const r4 = await send('from now on always call me Captain Test when you reply to me');
    const changed = await prisma.agentMemoryFile.findMany({ where: { updatedAt: { gte: since2 } } });
    console.log(`   reply: ${String(r4.text ?? r4.reason).slice(0, 160).replace(/\n/g, ' ')}`);
    check('a memory file was written', changed.some((m) => /captain test/i.test(m.content)), changed.map((m) => m.path).join(',') || 'nothing written');

    // ------------------------------------------- an operator's word wins
    console.log('\n▸ a standing rule in memory does not veto an operator');
    await prisma.agentMemoryFile.upsert({
      where: { path: 'procedures/stock-rule.md' },
      create: { path: 'procedures/stock-rule.md', content: '# Standing rule: NO stock changes unless real physical stock is confirmed by the owner.', createdBy: 'test', updatedBy: 'test' },
      update: { content: '# Standing rule: NO stock changes unless real physical stock is confirmed by the owner.' },
    });
    const v = await prisma.productVariant.findFirst({ where: { active: true, product: { active: true } }, orderBy: { code: 'asc' }, select: { id: true, code: true, stock: true } });
    if (v) {
      await resetThread();
      const target = v.stock === 7 ? 8 : 7;
      const r5 = await send(`set ${v.code} stock to ${target}`);
      const after = await prisma.productVariant.findUnique({ where: { id: v.id }, select: { stock: true } });
      console.log(`   ${v.code}: ${v.stock} → ${after?.stock}; reply: ${String(r5.text ?? r5.reason).slice(0, 160).replace(/\n/g, ' ')}`);
      check('the stock was changed on the first ask', after?.stock === target);
      await prisma.productVariant.update({ where: { id: v.id }, data: { stock: v.stock } });
    }

    // ------------------------------------- old limits in the transcript
    console.log('\n▸ an old "I can\'t browse" in the thread does not stick');
    await resetThread();
    const t = await prisma.agentThread.create({ data: { chatKey: CHAT_KEY, kind: 'whatsapp', title: 'Test Operator · WhatsApp' } });
    await prisma.agentMessage.create({ data: { threadId: t.id, seq: 1, role: 'user', content: { text: 'can you browse the web?' }, actorPhone: '0123456789', actorName: 'Test Operator' } });
    await prisma.agentMessage.create({ data: { threadId: t.id, seq: 2, role: 'assistant', content: { text: "Haha, I'm software — I don't browse or screenshot things myself." } } });
    const r6 = await send('ok so can you look something up online for me if I ask? yes or no');
    const said = String(r6.text ?? '');
    console.log(`   reply: ${said.slice(0, 160).replace(/\n/g, ' ')}`);
    check('says it can browse now', /\byes\b|i can|can do|sure/i.test(said) && !/\b(can't|cannot|don't) (browse|look)/i.test(said));
  } finally {
    await prisma.agentMemoryFile.deleteMany({});
    for (const m of memBefore) await prisma.agentMemoryFile.create({ data: m });
  }

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
