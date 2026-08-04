import type { AgentTool } from '../tool-kit.js';
import { clampLimit, truncate } from '../tool-kit.js';
import { describeReminderTime, parseReminderTime } from '../../../utils/reminder-time.js';
import { normalizePhone } from '../../../utils/phone.js';

// "Remind me about X at Y."
//
// A reminder is stored as a row and fired by the sweep in
// utils/reminder-sweep.ts — see the comment on AgentReminder in schema.prisma
// for why that rather than an OS cron entry per reminder.
//
// WHERE A REMINDER CAN BE SENT is the part worth reading before changing
// anything here. The agent's standing rule is that it cannot message
// customers: the only thing that ever reaches one is a transactional email.
// A tool that puts arbitrary text on a schedule to an arbitrary number would
// quietly delete that guarantee and turn the agent into a way to spam people
// from a business number. So a target must be either:
//
//   - the conversation the request was made in (default), or
//   - an operator already on the allowlist, by name or number.
//
// An unknown number is refused with a message that says so. If reminding a
// customer is ever genuinely wanted it should be a deliberate, separate
// decision — not something that arrives as a side effect of this tool.

async function resolveTarget(
  ctx: Parameters<AgentTool['run']>[0],
  to: string | undefined
): Promise<{ chatKey: string; label: string }> {
  const origin = ctx.origin;
  const here = origin
    ? { chatKey: origin.chatKey, label: origin.label }
    : { chatKey: `dm:${ctx.actor.phone}`, label: `${ctx.actor.name} (DM)` };

  const raw = String(to ?? '').trim();
  if (!raw || /^(here|this chat|this group|same place|us)$/i.test(raw)) return here;

  // "me" always means the requester's own DM, even when asked from a group —
  // that is the whole point of saying "me" rather than "here".
  if (/^(me|myself|my dm)$/i.test(raw)) {
    return { chatKey: `dm:${ctx.actor.phone}`, label: `${ctx.actor.name} (DM)` };
  }

  const digits = raw.replace(/[^0-9+]/g, '');
  const operators = await ctx.prisma.whatsAppOperator.findMany({ where: { active: true } });

  if (digits.length >= 8) {
    const phone = normalizePhone(digits);
    const match = operators.find((o: any) => o.phone === phone);
    if (!match) {
      throw new Error(
        `${raw} is not one of the allowlisted operators, and reminders can only be sent to an operator or to the chat they were set in — never to a customer. Add them under Agent → Operators first if they should receive reminders.`
      );
    }
    return { chatKey: `dm:${match.phone}`, label: `${match.name} (${match.phone})` };
  }

  // By name.
  const byName = operators.filter((o: any) => o.name.toLowerCase().includes(raw.toLowerCase()));
  if (byName.length === 1) {
    return { chatKey: `dm:${byName[0].phone}`, label: `${byName[0].name} (${byName[0].phone})` };
  }
  if (byName.length > 1) {
    throw new Error(`"${raw}" matches ${byName.length} operators: ${byName.map((o: any) => o.name).join(', ')}. Which one?`);
  }
  throw new Error(
    `No active operator called "${raw}". Reminders go to the current chat or to an allowlisted operator — say "here", "me", or an operator's name or number.`
  );
}

export const reminderTools: AgentTool[] = [
  {
    name: 'set_reminder',
    description:
      'Schedule a reminder message to be sent later over WhatsApp. Use whenever someone asks to be reminded, nudged, or to follow something up at a time. By default it goes back to THIS conversation (the same group or DM the request came from); pass `to` only if they ask for it somewhere else. Reminders can only go to the current chat or to an allowlisted operator — never to a customer.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description:
            'What the reminder should say, written as the finished sentence the operator will receive — e.g. "Chase Jordan for the RM145 transfer on ASC2607/0036". Include the detail; the reminder arrives with no other context.',
        },
        when: {
          type: 'string',
          description:
            'When to send it, in Malaysia time. Accepts "in 2 hours", "tomorrow 3pm", "tonight", "2026-08-05 14:00", "5 Aug 9am", or a bare time like "6pm".',
        },
        to: {
          type: 'string',
          description:
            'Optional. "here" (default) sends it back to this chat, "me" to the requester\'s own DM, or an allowlisted operator\'s name or number. Never a customer.',
        },
        orderRef: {
          type: 'string',
          description: 'Optional order number to attach the reminder to, so it shows up against that order.',
        },
        topic: { type: 'string', description: 'Optional short subject, e.g. "restock" or "payment chase".' },
      },
      required: ['message', 'when'],
    },
    run: async (ctx, input) => {
      const { prisma, actor } = ctx;
      const dueAt = parseReminderTime(String(input.when));
      const target = await resolveTarget(ctx, input.to);

      let orderId: string | null = null;
      let orderNumber: string | null = null;
      if (input.orderRef) {
        const order = await prisma.order.findFirst({
          where: {
            OR: [
              { id: String(input.orderRef) },
              { orderNumber: { equals: String(input.orderRef), mode: 'insensitive' } },
            ],
          },
        });
        if (!order) throw new Error(`No order found matching "${input.orderRef}".`);
        orderId = order.id;
        orderNumber = order.orderNumber;
      }

      const reminder = await prisma.agentReminder.create({
        data: {
          message: String(input.message).trim(),
          topic: input.topic ? String(input.topic).trim() : null,
          orderId,
          dueAt,
          targetChatKey: target.chatKey,
          targetLabel: target.label,
          createdByPhone: actor.phone,
          createdByName: actor.name,
          createdInChatKey: ctx.origin?.chatKey ?? `dm:${actor.phone}`,
        },
      });

      return {
        reminderId: reminder.id,
        message: reminder.message,
        when: describeReminderTime(dueAt),
        firesInMinutes: Math.round((dueAt.getTime() - Date.now()) / 60_000),
        goesTo: target.label,
        order: orderNumber,
        topic: reminder.topic,
        note: 'Saved. It will be sent automatically at that time — nothing else is needed. Use cancel_reminder to call it off.',
      };
    },
  },

  {
    name: 'list_reminders',
    description:
      'Reminders that are set, or that already went out. Use for "what reminders do I have", "what am I being reminded about", or to find one before cancelling it.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'SENT', 'CANCELLED', 'FAILED'],
          description: 'Default PENDING — the ones that have not fired yet.',
        },
        mine: { type: 'boolean', description: 'Only reminders this operator set. Default false (everyone\'s).' },
        orderRef: { type: 'string', description: 'Only reminders attached to this order.' },
        limit: { type: 'number' },
      },
    },
    run: async ({ prisma, actor }, input) => {
      const where: any = { status: input.status ?? 'PENDING' };
      if (input.mine) where.createdByPhone = actor.phone;
      if (input.orderRef) {
        const order = await prisma.order.findFirst({
          where: {
            OR: [
              { id: String(input.orderRef) },
              { orderNumber: { equals: String(input.orderRef), mode: 'insensitive' } },
            ],
          },
        });
        if (!order) throw new Error(`No order found matching "${input.orderRef}".`);
        where.orderId = order.id;
      }

      const rows = await prisma.agentReminder.findMany({
        where,
        orderBy: { dueAt: 'asc' },
        take: clampLimit(input.limit, 20),
        include: { order: { select: { orderNumber: true, customerName: true } } },
      });

      return {
        count: rows.length,
        reminders: rows.map((r: any) => ({
          reminderId: r.id,
          message: truncate(r.message, 160),
          when: describeReminderTime(r.dueAt),
          status: r.status,
          goesTo: r.targetLabel,
          setBy: r.createdByName,
          order: r.order?.orderNumber ?? null,
          topic: r.topic,
          sentAt: r.sentAt,
          // Only meaningful on a FAILED row; null everywhere else.
          problem: r.status === 'FAILED' ? r.lastError : null,
        })),
      };
    },
  },

  {
    name: 'cancel_reminder',
    description:
      'Call off a reminder that has not fired yet. Find it with list_reminders first if you do not have its id.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        reminderId: { type: 'string', description: 'From list_reminders or set_reminder.' },
      },
      required: ['reminderId'],
    },
    run: async ({ prisma }, input) => {
      const reminder = await prisma.agentReminder.findUnique({ where: { id: String(input.reminderId) } });
      if (!reminder) throw new Error(`No reminder with id ${input.reminderId}.`);
      if (reminder.status !== 'PENDING') {
        // Nothing to cancel, and saying so plainly is better than reporting a
        // success that changed nothing.
        throw new Error(
          `That reminder is already ${reminder.status.toLowerCase()}${
            reminder.sentAt ? ` (sent ${describeReminderTime(reminder.sentAt)})` : ''
          } — there is nothing to cancel.`
        );
      }
      await prisma.agentReminder.update({
        where: { id: reminder.id },
        data: { status: 'CANCELLED' },
      });
      return {
        reminderId: reminder.id,
        cancelled: true,
        was: { message: truncate(reminder.message, 160), when: describeReminderTime(reminder.dueAt), goesTo: reminder.targetLabel },
      };
    },
  },
];
