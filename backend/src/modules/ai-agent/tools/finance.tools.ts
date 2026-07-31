import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate, rm, toCents } from '../tool-kit.js';
import {
  createExpense,
  createFunding,
  createPayout,
  createRepayment,
  deleteExpense,
  deleteFunding,
  deletePayout,
  deleteRepayment,
  getFinanceOverview,
  getPartnerDetail,
  listExpenses,
  saveFinancePartners,
} from '../../admin/admin-finance.controller.js';

// Finance tools move real money between real people, so every one of them
// delegates to admin-finance.controller.ts — the balance maths ("owed = earned
// + capital fronted on orders + advances outstanding − profit paid out") lives
// there and must have exactly one implementation.
//
// The distinction the tool descriptions work hardest to protect is
// CONTRIBUTION vs ADVANCE. A contribution is capital that is never repaid and
// never appears in "owed"; an advance is a debt. Recording one as the other
// silently corrupts what the business thinks it owes its partners, and nothing
// downstream will flag it.

async function resolvePartner(prisma: any, ref: string) {
  const raw = String(ref).trim();
  const p = await prisma.partner.findFirst({
    where: { OR: [{ id: raw }, { name: { equals: raw, mode: 'insensitive' } }, { name: { contains: raw, mode: 'insensitive' } }] },
  });
  if (!p) {
    const all = await prisma.partner.findMany({ select: { name: true } });
    throw new Error(`No partner matching "${ref}". Known partners: ${all.map((x: any) => x.name).join(', ') || '(none yet)'}.`);
  }
  return p;
}

export const financeTools: AgentTool[] = [
  {
    name: 'finance_overview',
    description:
      'The money picture: lifetime earnings per person, what each is owed right now, company spending, and capital put in. Start here for any "how are we doing" or "what do I owe" question.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ fastify }) => {
      const o: any = await getFinanceOverview(fastify);
      return o;
    },
  },

  {
    name: 'get_partner',
    description:
      'One person\'s full finance record: what they have earned, capital they fronted to cover order costs, money they put in (contributions and advances), advances still outstanding, and profit paid out to them.',
    input_schema: {
      type: 'object',
      properties: { partnerRef: { type: 'string', description: 'Partner name or id.' } },
      required: ['partnerRef'],
    },
    run: async ({ fastify, prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      return getPartnerDetail(fastify, p.id);
    },
  },

  {
    name: 'save_partners',
    description:
      'Create partners, rename them, deactivate them, or edit their notes. Send the full list of partners you want to exist — omitted existing partners are left alone only if you include them, so read the current list first with finance_overview.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        partners: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Omit to create a new partner.' },
              name: { type: 'string' },
              active: { type: 'boolean' },
              notes: { type: 'string' },
            },
            required: ['name', 'active'],
          },
        },
      },
      required: ['partners'],
    },
    run: async ({ fastify }, input) => saveFinancePartners(fastify, { partners: input.partners }),
  },

  {
    name: 'list_expenses',
    description: 'Company spending — ads, software, equipment, stock bought ahead of demand. Not order-level costs.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    run: async ({ fastify }, input) => {
      const query: Record<string, string> = {};
      if (input.category) query.category = input.category;
      if (input.from) query.from = parseDate(input.from, false)!.toISOString();
      if (input.to) query.to = parseDate(input.to, true)!.toISOString();
      query.limit = String(clampLimit(input.limit, 30));
      return listExpenses(fastify, query);
    },
  },

  {
    name: 'record_expense',
    description:
      'Record company spending. Amount in RINGGIT. If a partner paid for it out of their own pocket, name them in paidByPartner AND say whether that was a CONTRIBUTION (they never want it back) or an ADVANCE (the company owes them) — getting that wrong misstates what the business owes.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        amountRm: { type: 'number' },
        category: { type: 'string', description: 'e.g. Ads, Software, Equipment, Stock, Shipping.' },
        description: { type: 'string' },
        occurredAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        paidByPartner: { type: 'string', description: 'Partner name, only if a person fronted the cash.' },
        paidByFundingType: {
          type: 'string',
          enum: ['CONTRIBUTION', 'ADVANCE'],
          description: 'Required when paidByPartner is set. ADVANCE creates a debt to that person; CONTRIBUTION does not.',
        },
        receiptUrl: { type: 'string' },
      },
      required: ['amountRm', 'category', 'description'],
    },
    run: async ({ fastify, prisma }, input) => {
      let paidByPartnerId: string | null = null;
      if (input.paidByPartner) {
        if (!input.paidByFundingType) {
          throw new Error(
            'When a partner fronted the cash you must also say whether it was a CONTRIBUTION (never repaid) or an ADVANCE (a debt the company owes them).'
          );
        }
        paidByPartnerId = (await resolvePartner(prisma, input.paidByPartner)).id;
      }
      const row: any = await createExpense(fastify, {
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        category: input.category,
        description: input.description,
        amount: toCents(input.amountRm),
        paidByPartnerId,
        paidByFundingType: paidByPartnerId ? input.paidByFundingType : null,
        receiptUrl: input.receiptUrl ?? null,
      });
      return { expenseId: row.id, amount: money(row.amount), category: row.category, occurredAt: row.occurredAt };
    },
  },

  {
    name: 'delete_expense',
    description: 'Remove a company expense. Also removes the funding record if a partner had fronted it.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: { expenseId: { type: 'string' } }, required: ['expenseId'] },
    summarize: async ({ prisma }, input) => {
      const e = await prisma.companyExpense.findUnique({ where: { id: input.expenseId } });
      if (!e) throw new Error(`No expense with id ${input.expenseId}.`);
      return `delete the ${rm(e.amount)} expense "${e.description}" (${e.category})`;
    },
    run: async ({ fastify }, input) => {
      await deleteExpense(fastify, input.expenseId);
      return { deleted: true, expenseId: input.expenseId };
    },
  },

  {
    name: 'record_funding',
    description:
      'Record money a partner put into the business. type CONTRIBUTION = capital, never repaid, never counted in "owed". type ADVANCE = a debt the company must return, tracked until repaid. Ask which one if the instruction is ambiguous — do not guess.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        partnerRef: { type: 'string' },
        type: { type: 'string', enum: ['CONTRIBUTION', 'ADVANCE'] },
        amountRm: { type: 'number' },
        description: { type: 'string' },
        occurredAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      },
      required: ['partnerRef', 'type', 'amountRm', 'description'],
    },
    run: async ({ fastify, prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      const row: any = await createFunding(fastify, {
        partnerId: p.id,
        type: input.type,
        amount: toCents(input.amountRm),
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        description: input.description,
      });
      return {
        fundingId: row.id,
        partner: p.name,
        type: row.type,
        amount: money(row.amount),
        note:
          row.type === 'ADVANCE'
            ? `The company now owes ${p.name} ${rm(row.amount)} until repaid.`
            : `Recorded as capital — this does not create a debt.`,
      };
    },
  },

  {
    name: 'record_repayment',
    description:
      'Repay part or all of a specific ADVANCE. Partial repayment is normal — outstanding is derived from the advance minus its repayments. Get fundingId from get_partner.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        fundingId: { type: 'string' },
        amountRm: { type: 'number' },
        occurredAt: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['fundingId', 'amountRm'],
    },
    run: async ({ fastify }, input) => {
      const row: any = await createRepayment(fastify, {
        fundingId: input.fundingId,
        amount: toCents(input.amountRm),
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        note: input.note ?? null,
      });
      return { repaymentId: row.id, amount: money(row.amount), fundingId: input.fundingId };
    },
  },

  {
    name: 'record_payout',
    description:
      'Pay out profit a partner has earned. This is NOT the same as repaying an advance — a payout distributes earnings, a repayment settles a debt. Use record_repayment for the latter.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        partnerRef: { type: 'string' },
        amountRm: { type: 'number' },
        occurredAt: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['partnerRef', 'amountRm'],
    },
    summarize: async ({ prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      return `record a profit payout of ${rm(toCents(input.amountRm))} to ${p.name}`;
    },
    run: async ({ fastify, prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      const row: any = await createPayout(fastify, {
        partnerId: p.id,
        amount: toCents(input.amountRm),
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        note: input.note ?? null,
      });
      return { payoutId: row.id, partner: p.name, amount: money(row.amount) };
    },
  },

  {
    name: 'delete_finance_record',
    description: 'Remove a funding, repayment or payout record that was entered by mistake.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['funding', 'repayment', 'payout'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
    },
    summarize: async ({ prisma }, input) => {
      const table: any = { funding: prisma.partnerFunding, repayment: prisma.partnerRepayment, payout: prisma.profitPayout };
      const row = await table[input.kind].findUnique({ where: { id: input.id } });
      if (!row) throw new Error(`No ${input.kind} with id ${input.id}.`);
      return `delete the ${rm(row.amount)} ${input.kind} record dated ${new Date(row.occurredAt).toISOString().slice(0, 10)}`;
    },
    run: async ({ fastify }, input) => {
      if (input.kind === 'funding') await deleteFunding(fastify, input.id);
      else if (input.kind === 'repayment') await deleteRepayment(fastify, input.id);
      else await deletePayout(fastify, input.id);
      return { deleted: true, kind: input.kind, id: input.id };
    },
  },
];
