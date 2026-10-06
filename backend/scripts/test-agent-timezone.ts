/**
 * Malaysia time, end to end.
 *
 * 6 Oct 2026, Ascend MY group: asked to tick Profit Shared on "everything
 * before October", the assistant wrote `"createdAt" < '2026-10-01'` — UTC
 * midnight, 08:00 in Malaysia — and ticked ASC2610/0001, placed at 02:35 on
 * 1 October. Asked why a "September" order was numbered 2610, it read the raw
 * UTC timestamp, got the conversion backwards and blamed the generator.
 *
 *   1. what the model is shown: UTC timestamps become Malaysia time (pure);
 *   2. the SQL check that flags a UTC day boundary (pure);
 *   3. sales_breakdown buckets by the Malaysian day (dev db);
 *   4. real turns: an order placed at 02:37 MYT is read on its Malaysian date,
 *      and "before <date>" leaves it out (needs the API and OPENROUTER_API_KEY).
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-agent-timezone.ts [--no-e2e]
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { modelJson, toMalaysiaIso } from '../src/modules/ai-agent/tool-kit.js';
import { timezoneWarning, reportTools } from '../src/modules/ai-agent/tools/reports.tools.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name} — ${e?.message}`);
    fail++;
    failures.push(name);
  }
}
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

console.log('\n— what the model is shown —');
await check('a UTC timestamp becomes the Malaysian one, offset included', () => {
  assert(toMalaysiaIso('2026-09-30T18:35:13.265Z') === '2026-10-01T02:35:13+08:00', toMalaysiaIso('2026-09-30T18:35:13.265Z'));
  assert(toMalaysiaIso('2026-10-01T02:26:46Z') === '2026-10-01T10:26:46+08:00', 'daytime');
});
await check('tool results are rewritten everywhere in the tree, Dates included, text untouched', () => {
  const out = modelJson({ createdAt: new Date('2026-09-30T18:35:13.265Z'), rows: [{ at: '2026-09-30T18:35:13Z' }], note: 'placed 2026-09-30T18:35:13Z per the log', n: 3 });
  assert(out.includes('"createdAt":"2026-10-01T02:35:13+08:00"') && out.includes('"at":"2026-10-01T02:35:13+08:00"'), out);
  assert(out.includes('placed 2026-09-30T18:35:13Z per the log'), 'free text was rewritten');
  assert(modelJson(undefined) === 'null', 'undefined');
});

console.log('\n— the SQL check —');
await check("the exact query from 6 Oct is flagged", () => {
  const sql = `SELECT "orderNumber" FROM orders WHERE "deletedAt" IS NULL AND "paymentStatus" = 'PAID' AND status = 'DELIVERED' AND "createdAt" < '2026-10-01' ORDER BY "createdAt"`;
  assert(timezoneWarning(sql)?.includes('8 hours'), 'not flagged');
});
await check('date casts and month buckets on raw timestamps are flagged', () => {
  assert(timezoneWarning(`SELECT "createdAt"::date AS d, count(*) FROM orders GROUP BY 1`), '::date');
  assert(timezoneWarning(`SELECT to_char(o."createdAt", 'YYYY-MM') m FROM orders o`), 'to_char');
  assert(timezoneWarning(`SELECT date_trunc('month', "occurredAt") FROM company_expenses`), 'date_trunc');
});
await check('shifted queries and queries without dates pass clean', () => {
  assert(!timezoneWarning(`SELECT * FROM orders WHERE ("createdAt" + interval '8 hours') < '2026-10-01'`), 'shifted');
  assert(!timezoneWarning(`SELECT ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')::date FROM orders`), 'at time zone');
  assert(!timezoneWarning(`SELECT status, count(*) FROM orders GROUP BY status`), 'no dates');
  assert(!timezoneWarning(`SELECT * FROM orders ORDER BY "createdAt" DESC LIMIT 5`), 'ordering is fine');
});

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const subject = await prisma.order.findFirst({
  where: { orderNumber: 'ASC2608/0005', deletedAt: null },
  select: { orderNumber: true, createdAt: true, paymentStatus: true },
});

console.log('\n— sales_breakdown —');
await check('days are Malaysian days', async () => {
  const tool = reportTools.find((t) => t.name === 'sales_breakdown')!;
  const ctx: any = { fastify: { prisma }, prisma, actor: { phone: '', name: 't', canWrite: false }, revalidate: () => {} };
  const r: any = await tool.run(ctx, { groupBy: 'day', from: '2026-06-01', to: '2026-10-31', limit: 200 });
  const paid = await prisma.order.findMany({ where: { deletedAt: null, paymentStatus: 'PAID', createdAt: { gte: new Date('2026-05-31T16:00:00Z') } }, select: { createdAt: true } });
  const myt = new Map<string, number>();
  for (const o of paid) {
    const k = toMalaysiaIso(o.createdAt.toISOString()).slice(0, 10);
    myt.set(k, (myt.get(k) ?? 0) + 1);
  }
  const rows: { bucket: string; orders: number }[] = r.rows ?? r.buckets ?? r.breakdown;
  assert(Array.isArray(rows) && rows.length, `unexpected shape: ${JSON.stringify(r).slice(0, 200)}`);
  for (const row of rows) assert(myt.get(row.bucket) === Number(row.orders), `${row.bucket}: tool ${row.orders}, Malaysian count ${myt.get(row.bucket)}`);
  if (subject) assert(rows.some((x) => x.bucket === '2026-08-05'), 'the 02:37 MYT order did not land on 5 Aug');
});

const API = `http://127.0.0.1:${process.env.PORT || 3105}`;
const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
if (process.argv.includes('--no-e2e') || !up || !process.env.OPENROUTER_API_KEY || !subject) {
  console.log(`\n· e2e skipped (${!subject ? 'no ASC2608/0005 in this db' : !up ? 'API down' : 'flag/key'})`);
} else {
  console.log('\n— real turns —');
  const PHONE = '0123456789';
  const reset = () => prisma.agentThread.deleteMany({ where: { chatKey: `dm:${PHONE}` } });
  const say = async (text: string) => {
    const r = (await fetch(`${API}/api/v1/internal/agent/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WORKER_HTTP_TOKEN}` },
      body: JSON.stringify({ kind: 'dm', senderPhone: `6${PHONE}`, senderName: 'Test Operator', mentionsBot: true, text }),
      signal: AbortSignal.timeout(240_000),
    }).then((x) => x.json())) as any;
    console.log(`   ${(r.text ?? r.reason).replace(/\n/g, '\n   ').slice(0, 500)}`);
    return String(r.text ?? '');
  };
  await prisma.whatsAppOperator.upsert({ where: { phone: PHONE }, create: { phone: PHONE, name: 'Test Operator', active: true, canWrite: true }, update: { active: true } });

  await check('an order placed at 02:37 Malaysia time is read on its Malaysian date', async () => {
    await reset();
    const reply = await say('what date and time was ASC2608/0005 placed?');
    assert(/5(th)?\s*(Aug|August)|2026-08-05|05\/08/i.test(reply), 'did not say 5 August');
    assert(!/4(th)?\s*(Aug|August)|2026-08-04/i.test(reply), 'said 4 August');
  });

  await check('"before 5 August" leaves it out; "on 5 August" includes it', async () => {
    await reset();
    const before = await say('list the order numbers of paid orders placed in August 2026 before 5 August. just the numbers');
    assert(!before.includes('ASC2608/0005'), 'counted the 02:37 MYT order as before 5 August');
    const on = await say('and which paid orders were placed on 5 August 2026 exactly?');
    assert(on.includes('ASC2608/0005'), 'missed it on its own date');
  });
  await reset();
}

await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
