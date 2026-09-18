import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { sendWhatsAppMessage } from '../../utils/whatsapp-send.js';
import { startTurn, awaitTurn, activeRun } from './core/run.js';
import { agentModelSettings } from './core/models.js';
import type { AgentActor } from './tool-kit.js';
import { malaysiaDay, readSetting, writeSetting, SETTING_KEYS, SYSTEM_ACTOR } from './schedule.js';

// The morning brief. Once a day, after the configured hour, the assistant
// writes what needs the operators today — in its own thread, read-only in
// practice because the prompt says so — and the text goes to the WhatsApp DM
// of every active operator with the brief switched on (chosen per operator
// on the Routines panel). The send is the harness's, not the model's: no
// destructive tool is involved, so nothing waits for an approval nobody is
// awake to give, and the recipients are the allowlist, never a customer.

const DEFAULT_HOUR = 8;
const KEEP_THREADS = 14;

export async function maybeDigest(fastify: FastifyInstance, now = new Date()): Promise<boolean> {
  if ((await readSetting(fastify, SETTING_KEYS.digest)) !== 'true') return false;
  if (!env.OPENROUTER_API_KEY) return false;
  const hourSetting = Number(await readSetting(fastify, SETTING_KEYS.digestHour));
  const at = Number.isFinite(hourSetting) && hourSetting >= 0 && hourSetting <= 23 ? hourSetting : DEFAULT_HOUR;
  const { day, hour } = malaysiaDay(now);
  if (hour < at) return false;
  if ((await readSetting(fastify, SETTING_KEYS.digestLast)) === day) return false;
  await writeSetting(fastify, SETTING_KEYS.digestLast, day);
  await runDigest(fastify, SYSTEM_ACTOR, day);
  return true;
}

// Starts the brief and returns as soon as its thread exists — the Assistant
// page opens it and watches it being written — then, once the run ends,
// sends the text. Resolves with what was sent when awaited to the end.
export async function runDigest(fastify: FastifyInstance, by: AgentActor, day = malaysiaDay().day): Promise<{ threadId: string; sent: number; recipients: number; text: string }> {
  const { threadId, finished } = await startDigest(fastify, by, day);
  return { threadId, ...(await finished) };
}

export async function startDigest(fastify: FastifyInstance, by: AgentActor, day = malaysiaDay().day): Promise<{ threadId: string; finished: Promise<{ sent: number; recipients: number; text: string }> }> {
  // A manual run counts as today's, so the scheduler does not send a second.
  await writeSetting(fastify, SETTING_KEYS.digestLast, day);
  const thread = await fastify.prisma.agentThread.create({ data: { kind: 'digest', title: `Morning brief · ${day}`, model: (await agentModelSettings(fastify)).model, createdBy: by.name } });
  const prompt = [
    `Write the morning brief for ${day}, to be sent as one WhatsApp message to the operators.`,
    'Read core/ in your memory for how the operators want things; open procedures/ files only if one is about the brief. Check: orders placed since yesterday morning and any still unpaid or unshipped (list_orders), low or sold-out stock (list_low_stock), the email outbox (email_outbox_status), pending reminders (list_reminders), and yesterday\'s numbers (dashboard_stats). Load other areas only if something there needs attention.',
    'Then write ONLY the message, nothing before or after it: under 1200 characters, plain text (no markdown, no headings, no tables), short lines, the most urgent thing first, each item on one line with what is needed. If nothing needs attention, say so in one line. Do not change anything and do not set reminders.',
  ].join('\n');
  try {
    await startTurn(fastify, thread.id, prompt, { actor: by, channel: 'web', origin: { kind: 'web', chatKey: `web:${thread.id}`, label: 'the morning brief' } });
  } catch (err) {
    fastify.log.error({ err }, 'morning brief could not start');
    return { threadId: thread.id, finished: Promise.resolve({ sent: 0, recipients: 0, text: '' }) };
  }
  return { threadId: thread.id, finished: deliverDigest(fastify, thread.id) };
}

async function deliverDigest(fastify: FastifyInstance, threadId: string): Promise<{ sent: number; recipients: number; text: string }> {
  const outcome = await awaitTurn(threadId);
  const text = outcome.text.trim();
  const old = await fastify.prisma.agentThread.findMany({ where: { kind: 'digest' }, orderBy: { createdAt: 'desc' }, skip: KEEP_THREADS, select: { id: true } });
  for (const t of old) if (!activeRun(t.id)) await fastify.prisma.agentThread.delete({ where: { id: t.id } }).catch(() => {});
  if (!text) return { sent: 0, recipients: 0, text: '' };

  // Operators' DMs and allowlisted groups, each switched on individually on
  // the Routines panel. Both sets are subsets of where the agent may already
  // speak, so the brief can never reach anyone the allowlist does not.
  const [operators, groups] = await Promise.all([
    fastify.prisma.whatsAppOperator.findMany({ where: { active: true, morningBrief: true }, select: { phone: true, name: true } }),
    fastify.prisma.whatsAppGroup.findMany({ where: { active: true, morningBrief: true }, select: { groupJid: true, subject: true } }),
  ]);
  const targets = [...operators.map((o) => ({ to: { phone: o.phone }, name: o.name })), ...groups.map((g) => ({ to: { jid: g.groupJid }, name: `group ${g.subject}` }))];
  let sent = 0;
  for (const t of targets) {
    try {
      await sendWhatsAppMessage(t.to, text.slice(0, 3500));
      sent++;
    } catch (err) {
      fastify.log.error({ err, to: t.name }, 'morning brief could not be sent');
    }
  }
  fastify.log.info({ threadId, sent, recipients: targets.length }, 'morning brief');
  return { sent, recipients: targets.length, text };
}
