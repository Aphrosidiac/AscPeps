import type { AgentTool } from '../tool-kit.js';
import { clampLimit, truncate } from '../tool-kit.js';

// Store settings, email outbox, and the agent's own operator/group allowlists.
//
// Settings are the sharpest edge here. `emails_enabled` and
// `online_payment_enabled` are live switches on customer-facing behaviour —
// flipping the first starts sending real mail to real customers, and flipping
// the second changes how people can pay at checkout. Both are marked
// destructive so they require an explicit yes rather than happening because a
// sentence was read a certain way.

// Settings whose value changes what customers experience, rather than just
// what an admin sees.
const CUSTOMER_FACING_SETTINGS = new Set(['emails_enabled', 'online_payment_enabled', 'payment_gateway']);

export const opsTools: AgentTool[] = [
  {
    name: 'get_settings',
    description:
      'All store settings — including emails_enabled (whether transactional email actually sends), online_payment_enabled, payment_gateway, shipping fee and store contact details.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ prisma }) => {
      const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
      return rows.map((s) => ({
        key: s.key,
        value: s.value,
        customerFacing: CUSTOMER_FACING_SETTINGS.has(s.key),
      }));
    },
  },

  {
    name: 'update_setting',
    description:
      'Change one store setting. Settings that affect customers (emails_enabled, online_payment_enabled, payment_gateway) require confirmation because they change live behaviour immediately.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string', description: 'Booleans are the strings "true" / "false".' },
      },
      required: ['key', 'value'],
    },
    summarize: async ({ prisma }, input) => {
      const current = await prisma.setting.findUnique({ where: { key: input.key } });
      const from = current ? `"${current.value}"` : '(not set)';
      const extra =
        input.key === 'emails_enabled' && input.value === 'true'
          ? ' — this starts sending real order confirmations and receipts to real customers'
          : input.key === 'online_payment_enabled'
            ? ' — this changes how customers can pay at checkout'
            : '';
      return `change setting "${input.key}" from ${from} to "${input.value}"${extra}`;
    },
    run: async ({ prisma, revalidate }, input) => {
      const key = String(input.key).trim();
      const value = String(input.value);
      const before = await prisma.setting.findUnique({ where: { key } });
      const row = await prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      revalidate(['settings']);
      return { key: row.key, from: before?.value ?? null, to: row.value };
    },
  },

  {
    name: 'email_outbox_status',
    description:
      'Transactional email health: how many are pending, sent, delivered, bounced or failed, plus the most recent failures and why.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['PENDING', 'SENT', 'FAILED', 'DELIVERED', 'BOUNCED', 'COMPLAINED'] }, limit: { type: 'number' } },
    },
    run: async ({ prisma }, input) => {
      const grouped = await prisma.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } });
      const enabled = await prisma.setting.findUnique({ where: { key: 'emails_enabled' } });
      const recent = await prisma.emailOutbox.findMany({
        where: input.status ? { status: input.status } : { status: { in: ['FAILED', 'BOUNCED'] } },
        include: { order: { select: { orderNumber: true } } },
        orderBy: { createdAt: 'desc' },
        take: clampLimit(input.limit, 15),
      });
      return {
        emailsEnabled: enabled?.value === 'true',
        warning:
          enabled?.value === 'true'
            ? undefined
            : 'emails_enabled is OFF — nothing is being sent to customers, queued mail just accumulates.',
        counts: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])),
        recent: recent.map((e) => ({
          order: e.order.orderNumber,
          type: e.type,
          to: e.toEmail,
          status: e.status,
          attempts: e.attempts,
          sentAt: e.sentAt,
          lastError: e.lastError ? truncate(e.lastError, 200) : null,
        })),
      };
    },
  },

  {
    name: 'retry_failed_emails',
    description: 'Reset every FAILED email back to pending so the worker tries again.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: {} },
    summarize: async ({ prisma }) => {
      const n = await prisma.emailOutbox.count({ where: { status: 'FAILED' } });
      return `retry ${n} failed email(s) — these go to real customer addresses`;
    },
    run: async ({ prisma }) => {
      const res = await prisma.emailOutbox.updateMany({
        where: { status: 'FAILED' },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
      });
      return { requeued: res.count };
    },
  },

  // ---- the agent's own access control -------------------------------------
  //
  // Deliberately exposed as tools so the allowlist can be managed from
  // WhatsApp, but note `manage_operator` is destructive: granting access is
  // handing someone the ability to change prices and move money, and it must
  // never happen as a side effect of a loosely-worded request.

  {
    name: 'list_operators',
    description: 'Who is allowed to command the agent, and whether each can make changes or only read.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ prisma }) => {
      const [operators, groups] = await Promise.all([
        prisma.whatsAppOperator.findMany({ orderBy: { name: 'asc' } }),
        prisma.whatsAppGroup.findMany({ orderBy: { subject: 'asc' } }),
      ]);
      return {
        operators: operators.map((o) => ({
          phone: o.phone,
          name: o.name,
          active: o.active,
          access: o.canWrite ? 'full (can make changes)' : 'read-only',
        })),
        groups: groups.map((g) => ({ subject: g.subject, jid: g.groupJid, active: g.active, requireMention: g.requireMention })),
      };
    },
  },

  {
    name: 'manage_operator',
    description:
      'Grant, revoke or change someone\'s access to the agent. Granting full access lets that person change prices, delete orders and move money through this agent, so it always confirms first.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Malaysian number in any format.' },
        name: { type: 'string' },
        action: { type: 'string', enum: ['grant', 'revoke', 'set_readonly', 'set_full'] },
      },
      required: ['phone', 'action'],
    },
    summarize: async (_ctx, input) => {
      const what: Record<string, string> = {
        grant: 'GRANT full agent access (can change prices, delete orders, move money) to',
        revoke: 'REVOKE all agent access from',
        set_readonly: 'restrict to read-only access',
        set_full: 'GRANT full write access to',
      };
      return `${what[input.action]} ${input.name ? `${input.name} ` : ''}${input.phone}`;
    },
    run: async ({ prisma }, input) => {
      // Same normalizer the inbound path uses — an operator row whose phone is
      // stored in a different shape would simply never match and would look
      // like the grant silently failed.
      const { normalizePhone } = await import('../../../utils/phone.js');
      const phone = normalizePhone(String(input.phone));

      if (input.action === 'revoke') {
        await prisma.whatsAppOperator.updateMany({ where: { phone }, data: { active: false } });
        return { phone, access: 'revoked' };
      }
      const canWrite = input.action !== 'set_readonly';
      const row = await prisma.whatsAppOperator.upsert({
        where: { phone },
        create: { phone, name: input.name ?? phone, active: true, canWrite },
        update: { active: true, canWrite, ...(input.name ? { name: input.name } : {}) },
      });
      return { phone: row.phone, name: row.name, active: row.active, access: row.canWrite ? 'full' : 'read-only' };
    },
  },

  {
    name: 'manage_group',
    description:
      'Turn the agent on or off in a specific WhatsApp group. Use the admin dashboard to see which groups the connected number is in — this tool needs the group JID.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        groupJid: { type: 'string', description: 'e.g. 120363...@g.us' },
        subject: { type: 'string', description: 'Group name, for display.' },
        action: { type: 'string', enum: ['enable', 'disable'] },
        requireMention: { type: 'boolean', description: 'Only respond when mentioned. Default true.' },
      },
      required: ['groupJid', 'action'],
    },
    summarize: async (_ctx, input) =>
      `${input.action === 'enable' ? 'ENABLE' : 'disable'} the agent in group ${input.subject ?? input.groupJid}${
        input.action === 'enable' ? ' — every allowlisted operator in that group will be able to command it' : ''
      }`,
    run: async ({ prisma }, input) => {
      const row = await prisma.whatsAppGroup.upsert({
        where: { groupJid: input.groupJid },
        create: {
          groupJid: input.groupJid,
          subject: input.subject ?? input.groupJid,
          active: input.action === 'enable',
          requireMention: input.requireMention !== false,
        },
        update: {
          active: input.action === 'enable',
          ...(input.subject ? { subject: input.subject } : {}),
          ...(input.requireMention !== undefined ? { requireMention: input.requireMention } : {}),
        },
      });
      return { groupJid: row.groupJid, subject: row.subject, active: row.active, requireMention: row.requireMention };
    },
  },
];
