import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AffiliateError,
  CODE_PATTERN,
  adjustBalance,
  affiliateBalance,
  cancelPayout,
  commissionTarget,
  getAffiliateSettings,
  isReservedCode,
  markPayoutPaid,
  normaliseCode,
  oneLine,
  pct,
  rateProblem,
  requestPayout,
  ringgit,
  suggestCode,
  syncAffiliateOrders,
  AFFILIATE_SETTING_KEYS,
  type AffiliateSettings,
} from '../../utils/affiliate.js';
import { normalizePhone } from '../../utils/phone.js';
import { notifyAffiliateTeam } from '../../utils/affiliate-notify.js';
import { mailAffiliate } from '../../utils/affiliate-mail.js';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { notifyRevalidate } from '../../utils/revalidate.js';
import { changeState } from './affiliate-changes.js';

/**
 * Ascend Affiliate, both sides: what an affiliate sees and does on
 * affiliate.ascendpeptides.my, and what the team does in Admin → Affiliates.
 * The money rules live in utils/affiliate.ts; this file only shapes requests.
 */

function fail(err: unknown): never {
  if (err instanceof AffiliateError) throw { statusCode: err.statusCode, message: err.message };
  throw err;
}

/** The programme as the public sees it (landing page, popups, join form). */
export function publicProgramme(s: AffiliateSettings) {
  return {
    enabled: s.enabled,
    customerDiscountPct: s.customerDiscountPct,
    commission: pct(s.defaultRateBps),
    commissionBps: s.defaultRateBps,
    holdDays: s.holdDays,
  };
}

export async function getProgramme(fastify: FastifyInstance) {
  return publicProgramme(await getAffiliateSettings(fastify.prisma));
}

const AFFILIATE_PUBLIC = {
  id: true,
  status: true,
  rateBps: true,
  fullName: true,
  phone: true,
  channel: true,
  bankName: true,
  bankAccountName: true,
  bankAccountNumber: true,
  approvedAt: true,
  createdAt: true,
  discountCode: { select: { code: true, discountValue: true } },
} as const;

function shapeAffiliate<T extends { rateBps: number; discountCode: { code: string; discountValue: number } }>(a: T) {
  const { discountCode, ...rest } = a;
  return { ...rest, code: discountCode.code, customerDiscountPct: discountCode.discountValue, commission: pct(a.rateBps) };
}

// ── The affiliate's side ────────────────────────────────────────────────────

export async function getMyAffiliate(fastify: FastifyInstance, memberId: string) {
  const settings = await getAffiliateSettings(fastify.prisma);
  const affiliate = await fastify.prisma.affiliate.findUnique({ where: { memberId }, select: AFFILIATE_PUBLIC });
  if (!affiliate) return { programme: publicProgramme(settings), affiliate: null, balance: null, openPayout: null };
  await syncAffiliateOrders(fastify.prisma, (await fastify.prisma.order.findMany({ where: { affiliateId: affiliate.id }, select: { id: true } })).map((o) => o.id));
  const [balance, openPayout, monthOrders, changes] = await Promise.all([
    affiliateBalance(fastify.prisma, affiliate.id),
    fastify.prisma.affiliatePayout.findFirst({
      where: { affiliateId: affiliate.id, status: 'REQUESTED' },
      select: { id: true, amount: true, availableAt: true, createdAt: true },
    }),
    fastify.prisma.order.count({
      where: { affiliateId: affiliate.id, paymentStatus: 'PAID', deletedAt: null, isTest: false, paidAt: { gte: startOfMonthMyt() } },
    }),
    changeState(fastify, affiliate.id),
  ]);
  return { programme: publicProgramme(settings), affiliate: shapeAffiliate(affiliate), balance, openPayout, paidOrdersThisMonth: monthOrders, ...changes };
}

/** Midnight on the 1st, Malaysia time, as a UTC instant. */
function startOfMonthMyt(now = new Date()): Date {
  const myt = new Date(now.getTime() + 8 * 3_600_000);
  return new Date(Date.UTC(myt.getUTCFullYear(), myt.getUTCMonth(), 1) - 8 * 3_600_000);
}

const codeSchema = z.string().trim().transform(normaliseCode).refine((c) => CODE_PATTERN.test(c), {
  message: 'Use 4–16 letters and numbers.',
});

export async function checkCode(fastify: FastifyInstance, raw: string, exceptAffiliateId?: string, opts: { team?: boolean } = {}) {
  const { releaseFrom: _, ...answer } = await resolveCode(fastify, raw, exceptAffiliateId, opts);
  return answer;
}

/** Whether a code can be had; `releaseFrom` is the rejected application still holding it. */
async function resolveCode(fastify: FastifyInstance, raw: string, exceptAffiliateId?: string, opts: { team?: boolean } = {}) {
  const parsed = codeSchema.safeParse(raw);
  if (!parsed.success) return { code: normaliseCode(raw), available: false, reason: 'Use 4–16 letters and numbers.', releaseFrom: null };
  const taken = await fastify.prisma.discountCode.findUnique({
    where: { code: parsed.data },
    select: { id: true, affiliate: { select: { id: true, status: true } } },
  });
  const mine = !!taken?.affiliate && taken.affiliate.id === exceptAffiliateId;
  if (!mine && !opts.team && isReservedCode(parsed.data)) {
    return { code: parsed.data, available: false, reason: 'That code is reserved. Try another.', releaseFrom: null };
  }
  // A rejected application can't use its code, so it shouldn't hold it either.
  if (taken?.affiliate?.status === 'REJECTED' && !mine) return { code: parsed.data, available: true, reason: null, releaseFrom: taken.id };
  return { code: parsed.data, available: !taken || mine, reason: taken && !mine ? 'That code is taken.' : null, releaseFrom: null };
}

/** Gives a rejected application a throwaway code, so its old one can be claimed. */
async function releaseCode(tx: Prisma.TransactionClient, discountCodeId: string | null) {
  if (!discountCodeId) return;
  await tx.discountCode.update({ where: { id: discountCodeId }, data: { code: `RJ${crypto.randomBytes(5).toString('hex').toUpperCase()}` } });
}

export async function suggestMyCode(fastify: FastifyInstance, name: string) {
  return { code: await suggestCode(fastify.prisma, name || 'Ascend') };
}

const joinSchema = z.object({
  fullName: z.string().transform(oneLine).pipe(z.string().min(2).max(80)),
  phone: z.string().trim().min(8).max(20),
  channel: z.string().transform(oneLine).pipe(z.string().max(200)).optional().nullable(),
  code: z.string().trim().min(1).max(30),
  // Optional at join (onboarding's payout step can be skipped). Sent with the
  // application, so the team approves them with it; later changes go through
  // a change request (affiliate-changes.ts).
  bankName: z.string().transform(oneLine).pipe(z.string().max(80)).optional().nullable(),
  bankAccountName: z.string().transform(oneLine).pipe(z.string().max(80)).optional().nullable(),
  bankAccountNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/[ -]/g, ''))
    .refine((v) => v === '' || /^\d{6,24}$/.test(v), 'Account number: numbers only, as on your statement.')
    .optional()
    .nullable(),
  acceptTerms: z.literal(true),
});

export async function joinProgramme(fastify: FastifyInstance, member: { id: string; email: string }, body: unknown) {
  const data = joinSchema.parse(body);
  const settings = await getAffiliateSettings(fastify.prisma);
  if (!settings.enabled) throw { statusCode: 400, message: 'The affiliate programme is not open right now.' };
  if (await fastify.prisma.affiliate.findUnique({ where: { memberId: member.id }, select: { id: true } })) {
    throw { statusCode: 400, message: 'You have already applied.' };
  }
  let phone: string;
  try {
    phone = normalizePhone(data.phone);
  } catch {
    throw { statusCode: 400, message: 'Enter a Malaysian mobile number.' };
  }
  const check = await resolveCode(fastify, data.code);
  if (!check.available) throw { statusCode: 400, message: check.reason ?? 'That code is not available.' };
  const bank = { bankName: data.bankName?.trim() || null, bankAccountName: data.bankAccountName?.trim() || null, bankAccountNumber: data.bankAccountNumber || null };
  const filled = Object.values(bank).filter(Boolean).length;
  if (filled > 0 && filled < 3) throw { statusCode: 400, message: 'Fill in the bank, the account holder name and the account number — or skip it for now.' };

  const affiliate = await fastify.prisma.$transaction(async (tx) => {
    await releaseCode(tx, check.releaseFrom);
    const code = await tx.discountCode.create({
      data: {
        code: check.code,
        description: `Affiliate · ${data.fullName}`,
        discountType: 'PERCENTAGE',
        discountValue: settings.customerDiscountPct,
        // Store checkout only: Group Buy prices are already cut to the bone.
        scope: 'STORE',
        // Live once the team approves the affiliate.
        isActive: false,
      },
    });
    return tx.affiliate.create({
      data: {
        memberId: member.id,
        rateBps: settings.defaultRateBps,
        discountCodeId: code.id,
        fullName: data.fullName,
        phone,
        channel: data.channel || null,
        ...bank,
      },
      select: AFFILIATE_PUBLIC,
    });
  });
  void notifyAffiliateTeam(
    fastify,
    `🤝 *New affiliate application*\n${data.fullName} · ${phone}\n${member.email}\nCode ${check.code}${data.channel ? `\nShares on: ${data.channel}` : ''}${bank.bankName ? `\nBank: ${bank.bankName} ····${bank.bankAccountNumber!.slice(-4)} (${bank.bankAccountName})` : '\nNo bank details yet'}\n\nApprove in Admin → Affiliates.`
  );
  await mailAffiliate(fastify, affiliate.id, { kind: 'applied', hasBank: Boolean(bank.bankName) });
  return { affiliate: shapeAffiliate(affiliate) };
}

// Only the code, and only while waiting for approval. Their details (bank,
// name, WhatsApp, where they share) are changed by request: affiliate-changes.ts.
const updateMineSchema = z.object({
  code: z.string().trim().min(1).max(30),
});

export async function updateMyAffiliate(fastify: FastifyInstance, memberId: string, body: unknown) {
  const data = updateMineSchema.parse(body);
  const a = await fastify.prisma.affiliate.findUnique({ where: { memberId }, select: { id: true, status: true, discountCodeId: true } });
  if (!a) throw { statusCode: 404, message: 'You have not joined yet.' };
  await fastify.prisma.$transaction(async (tx) => {
    if (data.code !== undefined) {
      // Changing a code people already have would break every link and post
      // they shared, so it is only theirs to change while waiting for approval.
      // Read again inside the transaction: the team may have just approved it.
      await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${a.id} FOR UPDATE`;
      const now = await tx.affiliate.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
      if (now.status !== 'APPLIED') throw { statusCode: 400, message: 'Your code is live. Ask us if it really has to change.' };
      const check = await resolveCode(fastify, data.code, a.id);
      if (!check.available) throw { statusCode: 400, message: check.reason ?? 'That code is not available.' };
      await releaseCode(tx, check.releaseFrom);
      await tx.discountCode.update({ where: { id: a.discountCodeId }, data: { code: check.code } });
    }
  });
  return getMyAffiliate(fastify, memberId);
}

async function myAffiliateId(fastify: FastifyInstance, memberId: string): Promise<string> {
  const a = await fastify.prisma.affiliate.findUnique({ where: { memberId }, select: { id: true } });
  if (!a) throw { statusCode: 404, message: 'You have not joined yet.' };
  return a.id;
}

/** The orders bought with the code. No customer details — only what they earned. */
export async function listAffiliateOrders(fastify: FastifyInstance, affiliateId: string, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const where = { affiliateId, deletedAt: null, isTest: false };
  const [rows, total] = await Promise.all([
    fastify.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true, orderNumber: true, createdAt: true, paidAt: true, status: true, paymentStatus: true,
        total: true, shippingFee: true, refundedAmount: true, affiliateRateBps: true, affiliateCommission: true,
        affiliateId: true, isTest: true, deletedAt: true,
      },
    }),
    fastify.prisma.order.count({ where }),
  ]);
  const { heldOrders } = await affiliateBalance(fastify.prisma, affiliateId);
  return paginatedResponse(
    rows.map((o) => {
      const earned = o.affiliateCommission;
      const hold = heldOrders.find((h) => h.orderNumber === o.orderNumber);
      const ifPaid = commissionTarget({ ...o, paymentStatus: 'PAID', refundedAmount: 0 });
      const state =
        o.status === 'CANCELLED' ? 'CANCELLED'
          : o.paymentStatus === 'UNPAID' ? 'AWAITING_PAYMENT'
          : o.paymentStatus === 'FAILED' ? 'NOT_PAID'
          : o.refundedAmount >= o.total && o.total > 0 ? 'REFUNDED'
          : o.refundedAmount > 0 ? 'PART_REFUNDED'
          : hold ? 'IN_HOLD'
          : 'EARNED';
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        placedAt: o.createdAt,
        paidAt: o.paidAt,
        goods: Math.max(0, o.total - o.shippingFee),
        rate: pct(o.affiliateRateBps ?? 0),
        commission: state === 'AWAITING_PAYMENT' ? ifPaid : earned,
        state,
        // When its commission can be asked for, while it is still waiting.
        readyAt: hold?.readyAt ?? null,
      };
    }),
    total,
    page,
    limit
  );
}

export async function listMyOrders(fastify: FastifyInstance, memberId: string, query: Record<string, string>) {
  return listAffiliateOrders(fastify, await myAffiliateId(fastify, memberId), query);
}

export async function listAffiliateEntries(fastify: FastifyInstance, affiliateId: string, take = 100) {
  const rows = await fastify.prisma.affiliateEntry.findMany({
    where: { affiliateId },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, kind: true, amount: true, note: true, createdAt: true, order: { select: { orderNumber: true } } },
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind, amount: r.amount, note: r.note, at: r.createdAt, orderNumber: r.order?.orderNumber ?? null }));
}

export async function listMyEntries(fastify: FastifyInstance, memberId: string) {
  return { entries: await listAffiliateEntries(fastify, await myAffiliateId(fastify, memberId)) };
}

const PAYOUT_SELECT = {
  id: true, status: true, amount: true, paidAmount: true, availableAt: true, createdAt: true, paidAt: true,
  reference: true, cancelReason: true, bankName: true, bankAccountName: true, bankAccountNumber: true,
} as const;

/**
 * The store's sizes, best sellers first, for the Products page: units on paid
 * orders (not deleted, cancelled or test), included supplies left out so a
 * free Bac Water with every vial doesn't top the list. Only the order goes
 * out — never the counts, which are the business's own figures.
 */
export async function bestSellerOrder(fastify: FastifyInstance) {
  const rows = await fastify.prisma.orderItem.groupBy({
    by: ['variantId'],
    where: {
      parentItemId: null,
      order: { paymentStatus: 'PAID', status: { not: 'CANCELLED' }, deletedAt: null, isTest: false },
    },
    _sum: { quantity: true },
  });
  return {
    variantIds: rows
      .filter((r) => (r._sum.quantity ?? 0) > 0)
      .sort((x, y) => (y._sum.quantity ?? 0) - (x._sum.quantity ?? 0))
      .map((r) => r.variantId),
  };
}

export async function listMyPayouts(fastify: FastifyInstance, memberId: string) {
  const affiliateId = await myAffiliateId(fastify, memberId);
  const payouts = await fastify.prisma.affiliatePayout.findMany({ where: { affiliateId }, orderBy: { createdAt: 'desc' }, select: PAYOUT_SELECT });
  return { payouts };
}

export async function requestMyPayout(fastify: FastifyInstance, memberId: string) {
  const affiliateId = await myAffiliateId(fastify, memberId);
  const payout = await requestPayout(fastify.prisma, affiliateId).catch(fail);
  const a = await fastify.prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId }, select: { fullName: true, discountCode: { select: { code: true } } } });
  void notifyAffiliateTeam(
    fastify,
    `💸 *Affiliate payout to transfer*\n${a.fullName} (${a.discountCode.code}) · ${ringgit(payout.amount)}\nTo ${payout.bankName} ····${payout.bankAccountNumber.slice(-4)} (${payout.bankAccountName})\nTransfer it, then mark it paid in Marketing → Affiliates.`
  );
  await mailAffiliate(fastify, affiliateId, {
    kind: 'payoutRequested',
    amount: payout.amount,
    bankName: payout.bankName,
    last4: payout.bankAccountNumber.slice(-4),
  });
  return { payout };
}

// ── The team's side ─────────────────────────────────────────────────────────

export async function adminListAffiliates(fastify: FastifyInstance, query: Record<string, string>) {
  await syncAffiliateOrders(fastify.prisma);
  const status = ['APPLIED', 'ACTIVE', 'PAUSED', 'REJECTED'].includes(query.status) ? (query.status as 'APPLIED') : undefined;
  const search = query.search?.trim();
  const affiliates = await fastify.prisma.affiliate.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { member: { email: { contains: search, mode: 'insensitive' } } },
              { discountCode: { code: { contains: search.toUpperCase() } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    select: { ...AFFILIATE_PUBLIC, member: { select: { email: true } } },
  });
  const ids = affiliates.map((a) => a.id);
  const [sums, open, orderCounts] = await Promise.all([
    fastify.prisma.affiliateEntry.groupBy({ by: ['affiliateId', 'kind'], where: { affiliateId: { in: ids } }, _sum: { amount: true } }),
    fastify.prisma.affiliatePayout.groupBy({ by: ['affiliateId'], where: { affiliateId: { in: ids }, status: 'REQUESTED' }, _sum: { amount: true } }),
    fastify.prisma.order.groupBy({
      by: ['affiliateId'],
      where: { affiliateId: { in: ids }, paymentStatus: { in: ['PAID', 'REFUNDED'] }, deletedAt: null, isTest: false, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { total: true, shippingFee: true, refundedAmount: true },
    }),
  ]);
  const counts = await fastify.prisma.affiliate.groupBy({ by: ['status'], _count: { _all: true } });
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    affiliates: affiliates.map((a) => {
      const mine = sums.filter((s) => s.affiliateId === a.id);
      const sum = (k?: string) => mine.filter((s) => !k || s.kind === k).reduce((t, s) => t + (s._sum.amount ?? 0), 0);
      const oc = orderCounts.find((o) => o.affiliateId === a.id);
      return {
        ...shapeAffiliate(a),
        email: a.member.email,
        balance: sum(),
        // After refunds, as the affiliate's own portal shows it.
        earned: sum('COMMISSION') + sum('REVERSAL'),
        paidOut: -sum('PAYOUT'),
        requested: open.find((o) => o.affiliateId === a.id)?._sum.amount ?? 0,
        paidOrders: oc?._count._all ?? 0,
        // Goods, like commission: shipping left out.
        sales: Math.max(0, (oc?._sum.total ?? 0) - (oc?._sum.shippingFee ?? 0) - (oc?._sum.refundedAmount ?? 0)),
      };
    }),
  };
}

export async function adminGetAffiliate(fastify: FastifyInstance, id: string) {
  const a = await fastify.prisma.affiliate.findUnique({
    where: { id },
    select: { ...AFFILIATE_PUBLIC, adminNote: true, approvedBy: true, member: { select: { email: true, emailVerified: true } } },
  });
  if (!a) throw { statusCode: 404, message: 'Affiliate not found' };
  await syncAffiliateOrders(fastify.prisma, (await fastify.prisma.order.findMany({ where: { affiliateId: id }, select: { id: true } })).map((o) => o.id));
  const [balance, orders, entries, payouts, changes] = await Promise.all([
    affiliateBalance(fastify.prisma, id),
    listAffiliateOrders(fastify, id, { limit: '100' }),
    listAffiliateEntries(fastify, id, 200),
    fastify.prisma.affiliatePayout.findMany({ where: { affiliateId: id }, orderBy: { createdAt: 'desc' }, select: { ...PAYOUT_SELECT, paidBy: true } }),
    changeState(fastify, id),
  ]);
  const { member, ...rest } = a;
  return {
    affiliate: { ...shapeAffiliate(rest), email: member.email, emailVerified: member.emailVerified },
    balance,
    orders: orders.data,
    entries,
    payouts,
    changeRequest: changes.changeRequest,
  };
}

const adminPatchSchema = z.object({
  status: z.enum(['APPLIED', 'ACTIVE', 'PAUSED', 'REJECTED']).optional(),
  rateBps: z.number().int().min(0).max(5000).optional(),
  adminNote: z.string().trim().max(1000).nullable().optional(),
  code: z.string().trim().min(1).max(30).optional(),
  // The code the admin was looking at when they pressed Approve.
  expectedCode: z.string().trim().min(1).max(30).optional(),
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(8).max(20).optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankAccountName: z.string().trim().max(80).nullable().optional(),
  bankAccountNumber: z.string().trim().regex(/^[0-9 -]{6,24}$/, 'Numbers only').transform((v) => v.replace(/[ -]/g, '')).nullable().optional(),
});

const BANK_KEYS = ['bankName', 'bankAccountName', 'bankAccountNumber'] as const;

export async function adminUpdateAffiliate(fastify: FastifyInstance, id: string, body: unknown, actor: string | null) {
  const data = adminPatchSchema.parse(body);
  const a = await fastify.prisma.affiliate.findUnique({ where: { id }, select: { id: true, status: true, discountCodeId: true, rateBps: true, approvedAt: true } });
  if (!a) throw { statusCode: 404, message: 'Affiliate not found' };
  const settings = await getAffiliateSettings(fastify.prisma);
  // A new rate, or an old one going live again: either way it has to fit the
  // budget as it is now (the settings check skips rejected affiliates).
  if (data.rateBps !== undefined || (data.status === 'ACTIVE' && a.status !== 'ACTIVE')) {
    const problem = rateProblem(data.rateBps ?? a.rateBps, settings);
    if (problem) throw { statusCode: 400, message: problem };
  }
  const patch: Record<string, unknown> = {};
  for (const k of ['rateBps', 'adminNote', 'fullName', 'bankName', 'bankAccountName', 'bankAccountNumber'] as const) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (data.phone !== undefined) {
    try {
      patch.phone = normalizePhone(data.phone);
    } catch {
      throw { statusCode: 400, message: 'Enter a Malaysian mobile number.' };
    }
  }
  if (data.status !== undefined && data.status !== a.status) {
    patch.status = data.status;
    if (data.status === 'ACTIVE' && !a.approvedAt) {
      patch.approvedAt = new Date();
      patch.approvedBy = actor;
    }
  }
  await fastify.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${id} FOR UPDATE`;
    // Approving what was on screen: an applicant can still change their code
    // until this moment, and it goes live with the approval.
    if (data.expectedCode !== undefined) {
      const { code } = await tx.discountCode.findUniqueOrThrow({ where: { id: a.discountCodeId }, select: { code: true } });
      if (code !== data.expectedCode) throw { statusCode: 409, message: `They changed their code to ${code}. Check it, then approve.` };
    }
    if (data.code !== undefined) {
      const check = await resolveCode(fastify, data.code, a.id, { team: true });
      if (!check.available) throw { statusCode: 400, message: check.reason ?? 'That code is not available.' };
      await releaseCode(tx, check.releaseFrom);
      await tx.discountCode.update({ where: { id: a.discountCodeId }, data: { code: check.code } });
    }
    if (Object.keys(patch).length) await tx.affiliate.update({ where: { id }, data: patch });
    // Same as an approved change request: a waiting payout goes where the
    // details now say, because the team transfers from the payout's own line.
    if (BANK_KEYS.some((k) => k in patch)) {
      const bank = await tx.affiliate.findUniqueOrThrow({ where: { id }, select: { bankName: true, bankAccountName: true, bankAccountNumber: true } });
      const waiting = await tx.affiliatePayout.count({ where: { affiliateId: id, status: 'REQUESTED' } });
      if (waiting) {
        if (!bank.bankName || !bank.bankAccountName || !bank.bankAccountNumber) {
          throw { statusCode: 400, message: 'A payout is waiting on these bank details. Fill them all in, or cancel the payout first.' };
        }
        await tx.affiliatePayout.updateMany({
          where: { affiliateId: id, status: 'REQUESTED' },
          data: { bankName: bank.bankName, bankAccountName: bank.bankAccountName, bankAccountNumber: bank.bankAccountNumber },
        });
      }
    }
    // The code is live exactly while the affiliate is active.
    const status = (patch.status as string | undefined) ?? a.status;
    await tx.discountCode.update({ where: { id: a.discountCodeId }, data: { isActive: status === 'ACTIVE' } });
  });
  // Tell them where they stand. Going live the first time is "approved",
  // after that it is "live again"; a rejection reads as one only before they
  // were ever in.
  if (patch.status === 'ACTIVE') await mailAffiliate(fastify, id, { kind: a.approvedAt ? 'reactivated' : 'approved' });
  else if (patch.status === 'PAUSED' && a.status === 'ACTIVE') await mailAffiliate(fastify, id, { kind: 'paused' });
  else if (patch.status === 'REJECTED' && a.status === 'APPLIED') await mailAffiliate(fastify, id, { kind: 'rejected' });
  return adminGetAffiliate(fastify, id);
}

export async function adminAdjust(fastify: FastifyInstance, id: string, body: unknown, actor: string) {
  const { amount, note } = z.object({ amount: z.number().int(), note: z.string().trim().min(1).max(300) }).parse(body);
  await adjustBalance(fastify.prisma, id, amount, note, actor).catch(fail);
  return adminGetAffiliate(fastify, id);
}

export async function adminListPayouts(fastify: FastifyInstance, query: Record<string, string>) {
  const status = ['REQUESTED', 'PAID', 'CANCELLED'].includes(query.status) ? (query.status as 'REQUESTED') : 'REQUESTED';
  const payouts = await fastify.prisma.affiliatePayout.findMany({
    where: { status },
    orderBy: status === 'REQUESTED' ? { createdAt: 'asc' } : { updatedAt: 'desc' },
    take: 200,
    select: { ...PAYOUT_SELECT, paidBy: true, affiliateId: true, affiliate: { select: { fullName: true, phone: true, discountCode: { select: { code: true } } } } },
  });
  // What each would pay now: the smaller of the ask and what is out of its
  // hold today, with any refund since booked first (the same sweep marking it
  // paid runs).
  if (status === 'REQUESTED' && payouts.length) await syncAffiliateOrders(fastify.prisma);
  const balances = new Map<string, number>();
  for (const id of new Set(payouts.map((p) => p.affiliateId))) balances.set(id, (await affiliateBalance(fastify.prisma, id)).payable);
  return {
    payouts: payouts.map(({ affiliate, ...p }) => ({
      ...p,
      name: affiliate.fullName,
      phone: affiliate.phone,
      code: affiliate.discountCode.code,
      payableNow: p.status === 'REQUESTED' ? Math.min(p.amount, balances.get(p.affiliateId) ?? 0) : null,
    })),
  };
}

export async function adminMarkPayoutPaid(fastify: FastifyInstance, id: string, body: unknown, actor: string) {
  const { reference, paidAt, expectedAmount } = z
    .object({ reference: z.string().trim().max(120).nullable().optional(), paidAt: z.coerce.date().optional(), expectedAmount: z.number().int().min(0).optional() })
    .parse(body ?? {});
  if (paidAt && paidAt.getTime() > Date.now() + 60 * 60_000) throw { statusCode: 400, message: 'The transfer date cannot be in the future.' };
  const result = await markPayoutPaid(fastify.prisma, id, { by: actor, reference: reference ?? null, paidAt, expected: expectedAmount }).catch(fail);
  const p = await fastify.prisma.affiliatePayout.findUniqueOrThrow({ where: { id }, include: { affiliate: { select: { fullName: true, discountCode: { select: { code: true } } } } } });
  const who = `${p.affiliate.fullName} (${p.affiliate.discountCode.code})`;
  void notifyAffiliateTeam(
    fastify,
    result.status === 'PAID'
      ? `✅ *Affiliate payout paid*\n${who} · ${ringgit(result.paidAmount)}${result.paidAmount < p.amount ? ` of ${ringgit(p.amount)} asked` : ''}\nTo ${p.bankName} ····${p.bankAccountNumber.slice(-4)}${p.reference ? ` · ref ${p.reference}` : ''}\nBy ${actor}`
      : `🚫 *Affiliate payout cancelled*\n${who} · ${ringgit(p.amount)} asked\n${result.note ?? ''}\nBy ${actor}`
  );
  await mailAffiliate(
    fastify,
    p.affiliateId,
    result.status === 'PAID'
      ? { kind: 'payoutPaid', amount: result.paidAmount, asked: p.amount, bankName: p.bankName, last4: p.bankAccountNumber.slice(-4), reference: p.reference, paidAt: p.paidAt ?? new Date() }
      : { kind: 'payoutCancelled', amount: p.amount, reason: result.note ?? 'Cancelled by the team.' }
  );
  return result;
}

export async function adminCancelPayout(fastify: FastifyInstance, id: string, body: unknown, actor = 'the team') {
  const { reason } = z.object({ reason: z.string().trim().min(2).max(300) }).parse(body);
  await cancelPayout(fastify.prisma, id, reason).catch(fail);
  const p = await fastify.prisma.affiliatePayout.findUniqueOrThrow({
    where: { id },
    select: { affiliateId: true, amount: true, affiliate: { select: { fullName: true, discountCode: { select: { code: true } } } } },
  });
  void notifyAffiliateTeam(fastify, `🚫 *Affiliate payout cancelled*\n${p.affiliate.fullName} (${p.affiliate.discountCode.code}) · ${ringgit(p.amount)}\nWhy: ${reason}\nBy ${actor}`);
  await mailAffiliate(fastify, p.affiliateId, { kind: 'payoutCancelled', amount: p.amount, reason });
  return { ok: true };
}

// ── Settings ────────────────────────────────────────────────────────────────

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  defaultRateBps: z.number().int().min(0).max(5000).optional(),
  customerDiscountPct: z.number().int().min(0).max(50).optional(),
  marginBudgetPct: z.number().int().min(0).max(50).optional(),
  holdDays: z.number().int().min(0).max(60).optional(),
  signupBonusEnabled: z.boolean().optional(),
  signupBonusPct: z.number().int().min(1).max(50).optional(),
});

export async function adminGetSettings(fastify: FastifyInstance) {
  return getAffiliateSettings(fastify.prisma);
}

export async function adminSaveSettings(fastify: FastifyInstance, body: unknown, actor = 'the team') {
  const data = settingsSchema.parse(body);
  const before = await getAffiliateSettings(fastify.prisma);
  const next = { ...before, ...data };
  const problem = rateProblem(next.defaultRateBps, next);
  if (problem) throw { statusCode: 400, message: problem };
  // Every active affiliate has to fit the budget too.
  const over = await fastify.prisma.affiliate.findMany({
    where: { status: { in: ['ACTIVE', 'APPLIED', 'PAUSED'] } },
    select: { fullName: true, rateBps: true },
  });
  const tooHigh = over.filter((a) => rateProblem(a.rateBps, next));
  if (tooHigh.length) {
    throw { statusCode: 400, message: `Lower these rates first, they would go over the budget: ${tooHigh.map((a) => `${a.fullName} ${pct(a.rateBps)}`).join(', ')}.` };
  }
  const K = AFFILIATE_SETTING_KEYS;
  const values: [string, string][] = [
    [K.enabled, String(next.enabled)],
    [K.defaultRateBps, String(next.defaultRateBps)],
    [K.customerDiscountPct, String(next.customerDiscountPct)],
    [K.marginBudgetPct, String(next.marginBudgetPct)],
    [K.holdDays, String(next.holdDays)],
    [K.signupBonusEnabled, String(next.signupBonusEnabled)],
    [K.signupBonusPct, String(next.signupBonusPct)],
  ];
  await fastify.prisma.$transaction([
    ...values.map(([key, value]) => fastify.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })),
    // A new customer discount applies to every affiliate code at once.
    fastify.prisma.discountCode.updateMany({ where: { affiliate: { isNot: null } }, data: { discountValue: next.customerDiscountPct } }),
  ]);
  // The store reads these in its layout (the popups), cached until told.
  notifyRevalidate();
  const onOff = (v: boolean) => (v ? 'on' : 'off');
  const changed = [
    next.enabled !== before.enabled && `Programme: ${onOff(before.enabled)} → ${onOff(next.enabled)}`,
    next.defaultRateBps !== before.defaultRateBps && `Commission for new affiliates: ${pct(before.defaultRateBps)} → ${pct(next.defaultRateBps)}`,
    next.customerDiscountPct !== before.customerDiscountPct && `Customer discount: ${before.customerDiscountPct}% → ${next.customerDiscountPct}%`,
    next.marginBudgetPct !== before.marginBudgetPct && `Margin budget: ${before.marginBudgetPct}% → ${next.marginBudgetPct}%`,
    next.holdDays !== before.holdDays && `Commission hold: ${before.holdDays} → ${next.holdDays} days`,
    next.signupBonusEnabled !== before.signupBonusEnabled && `Sign-up bonus: ${onOff(before.signupBonusEnabled)} → ${onOff(next.signupBonusEnabled)}`,
    next.signupBonusPct !== before.signupBonusPct && `Sign-up bonus: ${before.signupBonusPct}% → ${next.signupBonusPct}%`,
  ].filter(Boolean);
  if (changed.length) void notifyAffiliateTeam(fastify, `⚙️ *Affiliate settings changed*\n${changed.join('\n')}\nBy ${actor}`);
  return getAffiliateSettings(fastify.prisma);
}
