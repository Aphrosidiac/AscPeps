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
 * After rollout it is a monitor. `agent_messages` and `agent_tool_calls`
 * already record what was asked, what ran and what was said, so the next NEW
 * failure class is visible here the day it appears — instead of on the day an
 * operator happens to notice and push back, which for the two incidents this
 * guard was built from took three minutes and twelve days respectively.
 *
 * KNOWN LIMITATION, and it only ever errs toward over-reporting: the audit
 * table truncates `result` at 2000 characters (runTool, agent.service.ts) while
 * the model itself was given up to 6000. A turn whose payload was clipped may
 * show facts as ungrounded that the model could legitimately see. Those turns
 * are counted and reported separately rather than silently mixed in.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { checkGrounding, type ToolResultRecord } from '../src/modules/ai-agent/grounding.js';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

/** Matches the truncation cap in runTool's audit write. */
const AUDIT_RESULT_CAP = 2000;

const days = parseInt(process.argv[2] || '30', 10);

interface Turn {
  conversation: string;
  at: Date;
  operatorText: string;
  reply: string;
  tools: ToolResultRecord[];
  trustedContext: string[];
  clipped: boolean;
}

async function collectTurns(): Promise<Turn[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const conversations = await prisma.agentConversation.findMany({ select: { id: true, title: true } });
  const turns: Turn[] = [];

  for (const convo of conversations) {
    const messages = await prisma.agentMessage.findMany({
      where: { conversationId: convo.id, createdAt: { gte: since } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const calls = await prisma.agentToolCall.findMany({
      where: { conversationId: convo.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;

      // The turn opens at the most recent user message before this reply. Tool
      // calls in that window are the evidence the reply was written from.
      let opened = new Date(msg.createdAt.getTime() - 120_000);
      let operatorText = '';
      const trustedContext: string[] = [];
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === 'user') {
          opened = messages[j].createdAt;
          operatorText = messages[j].content;
          // The system prompt names the operator and their number, so the
          // agent knows both without a tool call. Mirrors what handleMessage
          // passes as trustedContext at runtime.
          if (messages[j].senderPhone) trustedContext.push(messages[j].senderPhone!);
          if (messages[j].senderName) trustedContext.push(messages[j].senderName!);
          break;
        }
      }

      const window = calls.filter((c) => c.createdAt >= opened && c.createdAt <= msg.createdAt);
      turns.push({
        conversation: convo.title,
        at: msg.createdAt,
        operatorText,
        reply: msg.content,
        tools: window.map((c) => ({ tool: c.toolName, result: c.result })),
        trustedContext,
        clipped: window.some((c) => c.result.length >= AUDIT_RESULT_CAP),
      });
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
      `${kl(turn.at)}  ${turn.conversation}${turn.clipped ? '  \x1b[33m[payload clipped in audit — may over-report]\x1b[0m' : ''}`
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
