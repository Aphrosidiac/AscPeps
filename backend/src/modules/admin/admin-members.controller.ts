import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

const listQuerySchema = z.object({
  search: z.string().optional(),
  show: z.enum(['confirmed', 'unconfirmed', 'bought']).optional(),
});

// Spelled out so a new secret on Member (a token hash, say) can't reach the
// admin UI or the CSV just by existing.
const memberSelect = {
  id: true,
  email: true,
  displayName: true,
  emailVerified: true,
  banned: true,
  createdAt: true,
  signupBonusCode: { select: { code: true, usedCount: true } },
} satisfies Prisma.MemberSelect;

type Bought = { paidOrders: number; paidTotal: number };

/**
 * Paid orders by lowercased address. An order isn't linked to an account —
 * most are placed as a guest — so the email is the only join there is, and
 * Member.email is normalised on write while Order.email is not. Test orders
 * are the team's, not a customer's.
 */
async function paidOrdersByEmail(fastify: FastifyInstance) {
  const orders = await fastify.prisma.order.findMany({
    where: { paymentStatus: 'PAID', deletedAt: null, isTest: false, email: { not: null } },
    select: { email: true, total: true, refundedAmount: true },
  });
  const byEmail = new Map<string, Bought>();
  for (const o of orders) {
    const email = o.email!.trim().toLowerCase();
    const cur = byEmail.get(email) ?? { paidOrders: 0, paidTotal: 0 };
    cur.paidOrders += 1;
    cur.paidTotal += o.total - o.refundedAmount;
    byEmail.set(email, cur);
  }
  return byEmail;
}

function buildWhere(query: Record<string, string>, bought: Map<string, Bought>): Prisma.MemberWhereInput {
  const { search, show } = listQuerySchema.parse(query);
  const where: Prisma.MemberWhereInput = {};
  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (show === 'confirmed') where.emailVerified = true;
  if (show === 'unconfirmed') where.emailVerified = false;
  if (show === 'bought') where.email = { in: [...bought.keys()] };
  return where;
}

export async function adminListMembers(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const bought = await paidOrdersByEmail(fastify);
  const where = buildWhere(query, bought);

  const [members, total, everyone, confirmed] = await Promise.all([
    fastify.prisma.member.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, select: memberSelect }),
    fastify.prisma.member.count({ where }),
    fastify.prisma.member.count(),
    fastify.prisma.member.count({ where: { emailVerified: true } }),
  ]);

  const rows = members.map((m) => ({ ...m, paidOrders: 0, paidTotal: 0, ...bought.get(m.email) }));
  return { ...paginatedResponse(rows, total, page, limit), stats: { everyone, confirmed } };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // A display name is free text the visitor typed: a leading =, +, - or @
  // would run as a formula when the file is opened in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV of the current view, filters included, every page of it. */
export async function adminExportMembers(fastify: FastifyInstance, query: Record<string, string>) {
  const bought = await paidOrdersByEmail(fastify);
  const members = await fastify.prisma.member.findMany({
    where: buildWhere(query, bought),
    orderBy: { createdAt: 'desc' },
    select: memberSelect,
  });

  const head = ['Signed up', 'Name', 'Email', 'Email confirmed', 'Banned', 'Sign-up bonus', 'Bonus used', 'Paid orders', 'Paid (RM)'];
  const lines = members.map((m) => {
    const b = bought.get(m.email);
    return [
      m.createdAt.toISOString(),
      m.displayName,
      m.email,
      m.emailVerified ? 'yes' : 'no',
      m.banned ? 'yes' : 'no',
      m.signupBonusCode?.code,
      m.signupBonusCode ? (m.signupBonusCode.usedCount > 0 ? 'yes' : 'no') : '',
      b?.paidOrders ?? 0,
      ((b?.paidTotal ?? 0) / 100).toFixed(2),
    ]
      .map(csvCell)
      .join(',');
  });
  // en-CA is YYYY-MM-DD, in the server's own time zone (MYT), not UTC's day.
  const day = new Date().toLocaleDateString('en-CA');
  return { csv: `${[head.join(','), ...lines].join('\n')}\n`, filename: `ascend-members-${day}.csv` };
}
