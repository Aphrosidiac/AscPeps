/**
 * Replays the grounding guard over conversations that have ALREADY happened.
 *
 *   set -a && source .env && set +a && npx tsx scripts/audit-agent-grounding.ts [days]
 *
 * Two jobs.
 *
 * Before rollout it is the calibration instrument: run it over real traffic and
 * read the false-positive rate off real replies, rather than guessing at one
 * from fixtures. A guard that cries wolf gets switched off, so this number
 * decides whether `enforce` is safe.
 *
 * After rollout it is a monitor. `agent_messages` and `agent_actions`
 * already record what was asked, what ran and what was said, so the next NEW
 * failure class is visible here the day it appears — instead of on the day an
 * operator happens to notice and push back, which for the two incidents this
 * guard was built from took three minutes and twelve days respectively.
 *
 * KNOWN LIMITATION, and it only ever errs toward over-reporting: the audit
 * transcript stores tool results in full since the move to agent_messages JSON
 * rows (2026-09-18); rows migrated from the old audit table were truncated at
 * 2000 characters while the model was given up to 6000, so a clipped turn may
 * show facts as ungrounded that the model could legitimately see. Those turns
 * are counted and reported separately rather than silently mixed in.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { checkGrounding, type ToolResultRecord } from '../src/modules/ai-agent/grounding.js';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const days = parseInt(process.argv[2] || '30', 10);

interface Turn {
  thread: string;
  at: Date;
  operatorText: string;
  reply: string;
  tools: ToolResultRecord[];
  trustedContext: string[];
  clipped: boolean;
}

interface Row {
  seq: number;
  role: string;
  content: any;
  actorPhone: string | null;
  actorName: string | null;
  createdAt: Date;
}

// A turn runs from a user row to the next FINAL assistant row — one with text
// and no tool calls, not a draft the guard sent back. Everything in between
// is the evidence the reply was written from: tool rows carry the results in
// full, serialised the way the model saw them (core/run.ts caps each at 6000
// characters on both sides). Rows migrated from the old audit table were
// truncated at 2000 and are marked clipped, since they may over-report.
async function collectTurns(): Promise<Turn[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const threads = await prisma.agentThread.findMany({ where: { kind: { in: ['whatsapp', 'chat'] } }, select: { id: true, title: true } });
  const turns: Turn[] = [];

  for (const thread of threads) {
    const rows: Row[] = await prisma.agentMessage.findMany({ where: { threadId: thread.id }, orderBy: { seq: 'asc' } });
    // Turns from before the transcript carried tool rows: the old audit table
    // migrated into agent_actions with no call id, so those are matched to
    // their turn by time, exactly as this script always did.
    const legacy = await prisma.agentAction.findMany({ where: { threadId: thread.id, callId: null, status: { in: ['done', 'failed'] } }, orderBy: { createdAt: 'asc' } });
    let open: { operatorText: string; trustedContext: string[]; tools: ToolResultRecord[]; clipped: boolean; at: Date } | null = null;
    for (const r of rows) {
      const c = r.content ?? {};
      if (r.role === 'user') {
        open = { operatorText: String(c.text ?? ''), trustedContext: [r.actorPhone, r.actorName].filter(Boolean) as string[], tools: [], clipped: false, at: r.createdAt };
      } else if (r.role === 'tool' && open) {
        for (const t of c.toolResults ?? []) {
          if (t.name === 'load_context') continue;
          const serialised = JSON.stringify(t.output);
          open.tools.push({ tool: t.name, result: serialised.length > 6000 ? serialised.slice(0, 6000) : serialised });
          if (t.output && typeof t.output === 'object' && 'raw' in t.output) open.clipped = true;
        }
      } else if (r.role === 'assistant' && open && c.text && !c.toolCalls?.length && !c.retracted) {
        if (!open.tools.length && legacy.length) {
          const from = open.at.getTime();
          const to = r.createdAt.getTime();
          for (const l of legacy) {
            const t = l.createdAt.getTime();
            if (t < from || t > to) continue;
            const serialised = JSON.stringify(l.output ?? { error: l.error });
            open.tools.push({ tool: l.tool, result: serialised });
            if (l.output && typeof l.output === 'object' && 'raw' in (l.output as object)) open.clipped = true;
          }
        }
        if (r.createdAt >= since) turns.push({ ...open, thread: thread.title, at: r.createdAt, reply: String(c.text) });
        open = null;
      }
    }
  }
  return turns.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function kl(d: Date): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(5, 16);
}

async function main() {
  const turns = await collectTurns();
  console.log(`\nReplaying the grounding guard over ${turns.length} assistant turns from the last ${days} days.\n`);

  let flagged = 0;
  let flaggedClipped = 0;
  const byKind = new Map<string, number>();
  const byDay = new Map<string, number>();

  for (const turn of turns) {
    const verdict = checkGrounding({
      reply: turn.reply,
      toolResults: turn.tools,
      operatorText: turn.operatorText,
      trustedContext: turn.trustedContext,
    });
    if (!verdict.violations.length) continue;

    flagged++;
    if (turn.clipped) flaggedClipped++;
    const day = kl(turn.at).slice(0, 5);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);

    console.log(`${'-'.repeat(74)}`);
    console.log(
      `${kl(turn.at)}  ${turn.thread}${turn.clipped ? '  \x1b[33m[payload clipped in audit — may over-report]\x1b[0m' : ''}`
    );
    console.log(`  operator: ${turn.operatorText.replace(/\n/g, ' ').slice(0, 90)}`);
    console.log(`  tools:    ${verdict.toolsRan.join(', ') || '\x1b[31mNONE\x1b[0m'}`);
    for (const v of verdict.violations) {
      byKind.set(`${v.kind}:${v.entityType}`, (byKind.get(`${v.kind}:${v.entityType}`) ?? 0) + 1);
      console.log(`  \x1b[31m${v.kind}\x1b[0m ${v.detail.slice(0, 140)}`);
    }
    console.log(`  reply:    ${turn.reply.replace(/\n/g, ' ').slice(0, 140)}`);
  }

  const rate = turns.length ? ((flagged / turns.length) * 100).toFixed(1) : '0.0';
  console.log(`\n${'='.repeat(74)}`);
  console.log(`${flagged} of ${turns.length} turns flagged (${rate}%)`);
  if (flaggedClipped) console.log(`${flaggedClipped} of those had a clipped payload and may be audit artefacts`);
  if (byKind.size) {
    console.log('\nby kind:');
    for (const [kind, n] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${kind}`);
    }
  }
  if (byDay.size) {
    console.log('\nby day:');
    for (const [day, n] of [...byDay.entries()].sort()) console.log(`  ${day}  ${'#'.repeat(Math.min(n, 40))} ${n}`);
  }
  console.log('='.repeat(74));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
