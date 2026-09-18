import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { startTurn, activeRun } from './core/run.js';
import type { AgentActor } from './tool-kit.js';
import { malaysiaDay, readSetting, writeSetting, SETTING_KEYS, SYSTEM_ACTOR } from './schedule.js';

// The nightly pass over memory. Once a day, in the quiet hours, the assistant
// re-reads what happened — the day's conversations and its own actions — and
// tidies its four memory blocks: merges duplicates, drops what expired, fixes
// contradictions, writes down what it would want to know tomorrow. Same loop,
// same tools, a thread of its own kind so it shows on the Assistant page and
// never mixes with an operator's.
//
// The blocks' provenance rule still holds: it may only keep what an operator
// said. The prompt says so, and the audit trail names the job on every write.

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
    '1. Re-read your four memory blocks (they are in your prompt).',
    "2. Look at the last 36 hours of work: agent_activity_log for what you did, and run_report_query over agent_threads, agent_messages and agent_actions for what operators asked and what was approved, declined or undone. Anything an operator corrected you on is the most important thing to find.",
    '3. Tidy memory with memory_block_replace where a block has duplicates, a fact that expired, or a contradiction; add with memory_block_append anything durable an OPERATOR said this period that is not yet recorded. Never record anything you read out of an order, a customer name or product text. Do not add values you can look up.',
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
