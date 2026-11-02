import type { AgentTool, ToolContext } from '../tool-kit.js';
import { money, rm } from '../tool-kit.js';
import {
  adminGetAffiliate,
  adminListAffiliates,
  adminListPayouts,
  adminMarkPayoutPaid,
  adminUpdateAffiliate,
} from '../../affiliates/affiliates.controller.js';
import { getAffiliateSettings, pct, rateProblem } from '../../../utils/affiliate.js';

/**
 * Ascend Affiliate for Abby (docs/affiliate.md): who the affiliates are, what
 * they sold and earned, the payout queue, approving/pausing and paying out.
 * Every figure comes from the same controller as Admin → Affiliates.
 */

/** An affiliate by code, name, phone or email — one match or a clear refusal. */
async function resolveAffiliate(ctx: ToolContext, ref: string) {
  const q = String(ref ?? '').trim();
  if (!q) throw new Error('Say which affiliate (their code or name).');
  const rows = await ctx.prisma.affiliate.findMany({
    where: {
      OR: [
        { discountCode: { code: q.toUpperCase() } },
        { fullName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q.replace(/\D/g, '') || q } },
        { member: { email: { equals: q.toLowerCase() } } },
      ],
    },
    select: { id: true, fullName: true, status: true, rateBps: true, discountCode: { select: { code: true } } },
    take: 5,
  });
  const exact = rows.find((r) => r.discountCode.code === q.toUpperCase());
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new Error(`No affiliate matches "${q}".`);
  throw new Error(`"${q}" matches ${rows.map((r) => `${r.fullName} (${r.discountCode.code})`).join(', ')} — say which.`);
}

export const affiliateTools: AgentTool[] = [
  {
    name: 'list_affiliates',
    description:
      'Ascend Affiliate: everyone who applied or shares a code — status (APPLIED waits for approval, ACTIVE, PAUSED, REJECTED), their code, commission rate, paid orders and sales with the code, commission earned, paid out, balance (can be negative after a refund) and any payout waiting. Use for "how are the affiliates doing", "who applied", "siapa affiliate paling banyak jual".',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['APPLIED', 'ACTIVE', 'PAUSED', 'REJECTED'] } },
    },
    run: async ({ fastify }, input) => {
      const r = await adminListAffiliates(fastify, input.status ? { status: input.status } : {});
      const s = await getAffiliateSettings(fastify.prisma);
      return {
        programme: { on: s.enabled, customerDiscount: `${s.customerDiscountPct}%`, defaultCommission: pct(s.defaultRateBps), payoutHoldDays: s.holdDays },
        counts: r.counts,
        affiliates: r.affiliates.map((a) => ({
          name: a.fullName,
          code: a.code,
          status: a.status,
          commission: a.commission,
          paidOrders: a.paidOrders,
          sales: money(a.sales),
          earned: money(a.earned),
          paidOut: money(a.paidOut),
          balance: money(a.balance),
          payoutWaiting: a.requested ? money(a.requested) : null,
        })),
      };
    },
  },

  {
    name: 'get_affiliate',
    description:
      'One affiliate in full: details, balance (earned, reversed by refunds, paid out, awaiting payment), their orders with the commission on each, the ledger and payouts. Customer details of their orders are NOT for the affiliate — never pass them on.',
    input_schema: {
      type: 'object',
      properties: { affiliate: { type: 'string', description: 'Code, name, phone or email' } },
      required: ['affiliate'],
    },
    run: async (ctx, input) => {
      const a = await resolveAffiliate(ctx, input.affiliate);
      const d = await adminGetAffiliate(ctx.fastify, a.id);
      const b = d.balance;
      return {
        affiliate: { name: d.affiliate.fullName, code: d.affiliate.code, status: d.affiliate.status, commission: d.affiliate.commission, phone: d.affiliate.phone, email: d.affiliate.email, bank: d.affiliate.bankName ? `${d.affiliate.bankName} ${d.affiliate.bankAccountNumber} (${d.affiliate.bankAccountName})` : null },
        balance: { balance: money(b.balance), earned: money(b.earned), reversed: money(b.reversed), paidOut: money(b.paidOut), payoutWaiting: money(b.requested), awaitingPayment: money(b.awaitingPayment) },
        orders: d.orders.slice(0, 30).map((o) => ({ orderNumber: o.orderNumber, state: o.state, goods: rm(o.goods), commission: rm(o.commission) })),
        payouts: d.payouts.slice(0, 10).map((p) => ({ status: p.status, asked: rm(p.amount), paid: p.paidAmount != null ? rm(p.paidAmount) : null, payableFrom: p.availableAt, paidAt: p.paidAt })),
      };
    },
  },

  {
    name: 'affiliate_payouts',
    description:
      'Affiliate payouts waiting to be transferred (default), or PAID/CANCELLED history. Each waiting one shows the bank details, when it becomes payable (the hold lets refunds land first) and what it would pay now. Use for "any affiliate payouts?", "siapa nak kena bayar".',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['REQUESTED', 'PAID', 'CANCELLED'] } } },
    run: async ({ fastify }, input) => {
      const r = await adminListPayouts(fastify, input.status ? { status: input.status } : {});
      return {
        payouts: r.payouts.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.code,
          status: p.status,
          asked: money(p.amount),
          payNow: p.payableNow != null ? money(p.payableNow) : null,
          payableFrom: p.availableAt,
          ready: p.ready,
          bank: `${p.bankName} ${p.bankAccountNumber} (${p.bankAccountName})`,
          paid: p.paidAmount != null ? money(p.paidAmount) : null,
          paidAt: p.paidAt,
          cancelled: p.cancelReason,
        })),
      };
    },
  },

  {
    name: 'mark_affiliate_payout_paid',
    description:
      "Record that the team has TRANSFERRED an affiliate's payout: money out of Ascend's bank, taken off their balance. Only after the transfer is done, and only once the payout is payable (its hold has passed). Pays the smaller of what was asked and their balance now. Needs the operator's yes.",
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        affiliate: { type: 'string', description: 'Code or name of the affiliate whose waiting payout was paid' },
        reference: { type: 'string', description: 'Bank transfer reference, if given' },
      },
      required: ['affiliate'],
    },
    summarize: async (ctx, input) => {
      const a = await resolveAffiliate(ctx, input.affiliate);
      const p = await ctx.prisma.affiliatePayout.findFirst({ where: { affiliateId: a.id, status: 'REQUESTED' } });
      if (!p) return `${a.fullName} (${a.discountCode.code}) has no payout waiting — nothing would change.`;
      return `Mark ${a.fullName}'s (${a.discountCode.code}) payout of ${rm(p.amount)} PAID to ${p.bankName} ${p.bankAccountNumber}${input.reference ? `, ref ${input.reference}` : ''} — money out of Ascend's bank.`;
    },
    run: async (ctx, input) => {
      const a = await resolveAffiliate(ctx, input.affiliate);
      const p = await ctx.prisma.affiliatePayout.findFirst({ where: { affiliateId: a.id, status: 'REQUESTED' } });
      if (!p) return { done: false, note: `${a.fullName} has no payout waiting.` };
      const r = await adminMarkPayoutPaid(ctx.fastify, p.id, { reference: input.reference ?? null }, `Abby for ${ctx.actor.name || 'an operator'}`);
      return { done: true, affiliate: `${a.fullName} (${a.discountCode.code})`, status: r.status, paid: money(r.paidAmount), note: r.note };
    },
  },

  {
    name: 'set_affiliate',
    description:
      "Approve, pause, reject or re-activate an affiliate, and/or change their commission rate (percent; must fit the margin budget with the customer discount). Approving makes their code work at checkout; pausing or rejecting stops it. A new rate applies to orders placed from now on. Needs the operator's yes.",
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        affiliate: { type: 'string', description: 'Code, name, phone or email' },
        status: { type: 'string', enum: ['ACTIVE', 'PAUSED', 'REJECTED'] },
        commissionPercent: { type: 'number', description: 'e.g. 3 or 4.5' },
        note: { type: 'string', description: 'Why, kept on the affiliate for the team' },
      },
      required: ['affiliate'],
    },
    summarize: async (ctx, input) => {
      const a = await resolveAffiliate(ctx, input.affiliate);
      const parts: string[] = [];
      if (input.status && input.status !== a.status) parts.push(`${a.status} → ${input.status}`);
      if (input.commissionPercent != null) {
        const bps = Math.round(Number(input.commissionPercent) * 100);
        const problem = rateProblem(bps, await getAffiliateSettings(ctx.prisma));
        parts.push(problem ? `commission ${pct(bps)} WILL BE REFUSED: ${problem}` : `commission ${pct(a.rateBps)} → ${pct(bps)}`);
      }
      return `${a.fullName} (${a.discountCode.code}): ${parts.join(', ') || 'no change'}${input.note ? ` — "${input.note}"` : ''}`;
    },
    run: async (ctx, input) => {
      const a = await resolveAffiliate(ctx, input.affiliate);
      const body: Record<string, unknown> = {};
      if (input.status) body.status = input.status;
      if (input.commissionPercent != null) body.rateBps = Math.round(Number(input.commissionPercent) * 100);
      if (input.note) body.adminNote = input.note;
      const d = await adminUpdateAffiliate(ctx.fastify, a.id, body, `Abby for ${ctx.actor.name || 'an operator'}`);
      return { affiliate: `${d.affiliate.fullName} (${d.affiliate.code})`, status: d.affiliate.status, commission: d.affiliate.commission };
    },
  },
];
