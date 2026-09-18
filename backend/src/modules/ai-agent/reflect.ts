import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { startTurn, activeRun } from './core/run.js';
import type { AgentActor } from './tool-kit.js';
import { malaysiaDay, readSetting, writeSetting, SETTING_KEYS, SYSTEM_ACTOR } from './schedule.js';

// The nightly pass over memory. Once a day, in the quiet hours, the assistant
// re-reads what happened — what operators said, what it did, what was
// approved or undone — and tidies its memory directory: merges duplicates,
// drops what expired, moves detail out of core/, writes down what it would
// want to know tomorrow. Same loop, same tools, a thread of its own kind so it
// shows on the Assistant page and never mixes with an operator's.
//
// The trust rule still holds here. Its only source for NEW facts is
// list_operator_messages, whose output is operator-authored and therefore
// trusted; everything else it reads is data, and a write copied from it is
// refused like any other. The audit trail names the job on every write.

const HOUR = 3;
const KEEP_THREADS = 14;

export async function maybeReflect(fastify: FastifyInstance, now = new Date()): Promise<boolean> {
  if ((await readSetting(fastify, SETTING_KEYS.reflect)) !== 'true') return false;
  if (!env.OPENROUTER_API_KEY) return false;
  const { day, hour } = malaysiaDay(now);
  if (hour < HOUR) return false;
  if ((await readSetting(fastify, SETTING_KEYS.reflectLast)) === day) return false;
  await writeSetting(fastify, SETTING_KEYS.reflectLast, day);
  await runReflection(fastify, SYSTEM_ACTOR, day);
  return true;
}

export async function runReflection(fastify: FastifyInstance, by: AgentActor, day = malaysiaDay().day): Promise<string> {
  await writeSetting(fastify, SETTING_KEYS.reflectLast, day);
  const thread = await fastify.prisma.agentThread.create({ data: { kind: 'reflect', title: `Nightly reflection · ${day}`, model: env.OPENROUTER_MODEL, createdBy: by.name } });
  const prompt = [
    `It is the nightly reflection for ${day}. Nobody is waiting on you; take the steps in order and keep the writing short.`,
    '',
    '1. Read your memory: core/ is in your prompt; view the directory and open any file that a recent conversation touched.',
    '2. Read what operators SAID recently with list_operator_messages (hours: 36). That is the only source you may record new facts from. agent_activity_log and run_report_query tell you what you did and what was approved, declined or undone — read them to spot corrections, but never copy their text into memory. Anything an operator corrected you on is the most important thing to find.',
    '3. Consolidate: merge duplicate lines, drop what has expired or was corrected, move detail out of core/ into clients/, suppliers/ or procedures/ files, and add what an operator said this period that is durable and not yet recorded. Keep core/ to standing facts under its cap. log.md holds at most the last 14 dated entries; add one line for today.',
    '4. Do not change anything else — no orders, no products, no settings — and do not set reminders.',
    '5. End with a five-line note of what changed in memory, or "Nothing to change" if so.',
  ].join('\n');
  try {
    await startTurn(fastify, thread.id, prompt, { actor: by, channel: 'web', origin: { kind: 'web', chatKey: `web:${thread.id}`, label: 'the nightly reflection' } });
  } catch (err) {
    fastify.log.error({ err }, 'nightly reflection could not start');
  }
  // Old reflections are noise on the page.
  const old = await fastify.prisma.agentThread.findMany({ where: { kind: 'reflect' }, orderBy: { createdAt: 'desc' }, skip: KEEP_THREADS, select: { id: true } });
  for (const t of old) if (!activeRun(t.id)) await fastify.prisma.agentThread.delete({ where: { id: t.id } }).catch(() => {});
  return thread.id;
}
