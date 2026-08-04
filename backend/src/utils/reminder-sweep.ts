/**
 * Firing due reminders.
 *
 * Runs on an interval from server.ts, the same shape as the transactional
 * email outbox: find what is due, try to deliver it, record the outcome. A
 * reminder is a ROW, not an OS cron entry — see the comment on AgentReminder
 * in schema.prisma for why.
 *
 * The important property is that nothing is lost to downtime. A reminder that
 * came due while WhatsApp was disconnected is still PENDING when the worker
 * comes back and goes out late, which is what someone who asked to be reminded
 * actually wants — silently dropping it would leave them believing they had
 * been covered.
 */
import type { FastifyInstance } from 'fastify';
import { sendWhatsAppMessage, targetFromChatKey, type SendTarget } from './whatsapp-send.js';
import { describeReminderTime } from './reminder-time.js';

/** Give up after this many failed sends and mark the reminder FAILED. */
const MAX_ATTEMPTS = 6;

/** Nothing older than this is worth delivering unprompted. */
const TOO_LATE_MS = 24 * 60 * 60_000;

/** 1, 2, 4, 8, 16, capped at 30 minutes. */
function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 30) * 60_000;
}

/**
 * @param send injectable so tests can drive the whole lifecycle without a live
 *   WhatsApp socket. The default is the real sender; nothing in production
 *   passes this.
 */
export async function processDueReminders(
  fastify: FastifyInstance,
  send: (target: SendTarget, message: string) => Promise<void> = sendWhatsAppMessage
): Promise<void> {
  const now = new Date();

  const due = await fastify.prisma.agentReminder.findMany({
    where: { status: 'PENDING', dueAt: { lte: now }, nextAttemptAt: { lte: now } },
    orderBy: { dueAt: 'asc' },
    // A backlog is drained a batch at a time rather than all at once: each send
    // is a real WhatsApp message, and firing hundreds in one tick would look
    // like the bot spamming.
    take: 10,
  });
  if (!due.length) return;

  for (const reminder of due) {
    // A reminder that is more than a day stale is no longer useful and would
    // arrive as a confusing message about something long past. Settle it as
    // FAILED with the reason visible rather than sending it or deleting it.
    if (now.getTime() - reminder.dueAt.getTime() > TOO_LATE_MS) {
      await fastify.prisma.agentReminder.update({
        where: { id: reminder.id },
        data: {
          status: 'FAILED',
          lastError: `Not delivered within 24h of being due (${describeReminderTime(reminder.dueAt)}).`,
        },
      });
      fastify.log.warn({ reminderId: reminder.id }, 'reminder expired undelivered');
      continue;
    }

    const text = `⏰ *Reminder*\n\n${reminder.message}\n\n_Set by ${reminder.createdByName} for ${describeReminderTime(reminder.dueAt)}._`;

    try {
      await send(targetFromChatKey(reminder.targetChatKey), text);
      await fastify.prisma.agentReminder.update({
        where: { id: reminder.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      fastify.log.info({ reminderId: reminder.id, to: reminder.targetLabel }, 'reminder sent');
    } catch (err: any) {
      const attempts = reminder.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await fastify.prisma.agentReminder.update({
        where: { id: reminder.id },
        data: {
          attempts,
          lastError: String(err?.message ?? err).slice(0, 500),
          ...(giveUp
            ? { status: 'FAILED' as const }
            : { nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) }),
        },
      });
      fastify.log.error(
        { err, reminderId: reminder.id, attempts, giveUp },
        giveUp ? 'reminder failed permanently' : 'reminder send failed, will retry'
      );
    }
  }
}
