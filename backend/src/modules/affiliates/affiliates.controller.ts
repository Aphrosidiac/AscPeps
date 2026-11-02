import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AffiliateError,
  CODE_PATTERN,
  adjustBalance,
  affiliateBalance,
  cancelPayout,
  commissionTarget,
  getAffiliateSettings,
  markPayoutPaid,
  normaliseCode,
  pct,
  rateProblem,
  requestPayout,
  suggestCode,
  syncAffiliateOrders,
  AFFILIATE_SETTING_KEYS,
  type AffiliateSettings,
} from '../../utils/affiliate.js';
import { normalizePhone } from '../../utils/phone.js';
import { notifyAffiliateTeam } from '../../utils/affiliate-notify.js';
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

export async function checkCode(fastify: FastifyInstance, raw: string, exceptAffiliateId?: string) {
  const parsed = codeSchema.safeParse(raw);
  if (!parsed.success) return { code: normaliseCode(raw), available: false, reason: 'Use 4–16 letters and numbers.' };
  const taken = await fastify.prisma.discountCode.findUnique({
    where: { code: parsed.data },
    select: { id: true, affiliate: { select: { id: true } } },
  });
  const mine = taken?.affiliate?.id && taken.affiliate.id === exceptAffiliateId;
  return { code: parsed.data, available: !taken || !!mine, reason: taken && !mine ? 'That code is taken.' : null };
}

export async function suggestMyCode(fastify: FastifyInstance, name: string) {
  return { code: await suggestCode(fastify.prisma, name || 'Ascend') };
}

const joinSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(20),
  channel: z.string().trim().max(200).optional().nullable(),
  code: z.string().trim().min(1).max(30),
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
  const check = await checkCode(fastify, data.code);
  if (!check.available) throw { statusCode: 400, message: check.reason ?? 'That code is not available.' };

  const affiliate = await fastify.prisma.$transaction(async (tx) => {
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
      },
      select: AFFILIATE_PUBLIC,
    });
  });
  void notifyAffiliateTeam(
    fastify,
    `🤝 *New affiliate application*\n${data.fullName} · ${phone}\n${member.email}\nCode ${check.code}${data.channel ? `\nShares on: ${data.channel}` : ''}\n\nApprove in Admin → Affiliates.`
  );
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
      const now = await tx.affiliate.findUniqueOrThrow({ where: { id: a.id }, select: { status: true } });
      if (now.status !== 'APPLIED') throw { statusCode: 400, message: 'Your code is live. Ask us if it really has to change.' };
      const check = await checkCode(fastify, data.code, a.id);
      if (!check.available) throw { statusCode: 400, message: check.reason ?? 'That code is not available.' };
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
  return paginatedResponse(
    rows.map((o) => {
      const earned = o.affiliateCommission;
      const ifPaid = commissionTarget({ ...o, paymentStatus: 'PAID', refundedAmount: 0 });
      const state =
        o.status === 'CANCELLED' ? 'CANCELLED'
          : o.paymentStatus === 'UNPAID' ? 'AWAITING_PAYMENT'
          : o.paymentStatus === 'FAILED' ? 'NOT_PAID'
          : o.refundedAmount >= o.total && o.total > 0 ? 'REFUNDED'
          : o.refundedAmount > 0 ? 'PART_REFUNDED'
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
    `💸 *Affiliate payout requested*\n${a.fullName} (${a.discountCode.code}) · RM ${(payout.amount / 100).toFixed(2)}\nTo ${payout.bankName} ····${payout.bankAccountNumber.slice(-4)} (${payout.bankAccountName}), full number in Admin\nPayable from ${payout.availableAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}\n\nMark it paid in Admin → Affiliates → Payouts once the transfer is done.`
  );
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
      _sum: { total: true, refundedAmount: true },
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
        earned: sum('COMMISSION'),
        paidOut: -sum('PAYOUT'),
        requested: open.find((o) => o.affiliateId === a.id)?._sum.amount ?? 0,
        paidOrders: oc?._count._all ?? 0,
        sales: (oc?._sum.total ?? 0) - (oc?._sum.refundedAmount ?? 0),
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
  fullName: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().min(8).max(20).optional(),
  bankName: z.string().trim().max(80).nullable().optional(),
  bankAccountName: z.string().trim().max(80).nullable().optional(),
  bankAccountNumber: z.string().trim().regex(/^[0-9 -]{6,24}$/, 'Numbers only').transform((v) => v.replace(/[ -]/g, '')).nullable().optional(),
});

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
    if (data.code !== undefined) {
      const check = await checkCode(fastify, data.code, a.id);
      if (!check.available) throw { statusCode: 400, message: check.reason ?? 'That code is not available.' };
      await tx.discountCode.update({ where: { id: a.discountCodeId }, data: { code: check.code } });
    }
    if (Object.keys(patch).length) await tx.affiliate.update({ where: { id }, data: patch });
    // The code is live exactly while the affiliate is active.
    const status = (patch.status as string | undefined) ?? a.status;
    await tx.discountCode.update({ where: { id: a.discountCodeId }, data: { isActive: status === 'ACTIVE' } });
  });
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
    orderBy: status === 'REQUESTED' ? { availableAt: 'asc' } : { updatedAt: 'desc' },
    take: 200,
    select: { ...PAYOUT_SELECT, paidBy: true, affiliateId: true, affiliate: { select: { fullName: true, phone: true, discountCode: { select: { code: true } } } } },
  });
  const now = Date.now();
  // What each would pay now: the smaller of the ask and today's balance, with
  // any refund since booked first (the same sweep marking it paid runs).
  if (status === 'REQUESTED' && payouts.length) await syncAffiliateOrders(fastify.prisma);
  const balances = new Map<string, number>();
  for (const id of new Set(payouts.map((p) => p.affiliateId))) balances.set(id, (await affiliateBalance(fastify.prisma, id)).balance);
  return {
    payouts: payouts.map(({ affiliate, ...p }) => ({
      ...p,
      name: affiliate.fullName,
      phone: affiliate.phone,
      code: affiliate.discountCode.code,
      ready: p.status === 'REQUESTED' && p.availableAt.getTime() <= now,
      payableNow: p.status === 'REQUESTED' ? Math.max(0, Math.min(p.amount, balances.get(p.affiliateId) ?? 0)) : null,
    })),
  };
}

export async function adminMarkPayoutPaid(fastify: FastifyInstance, id: string, body: unknown, actor: string) {
  const { reference, paidAt, expectedAmount } = z
    .object({ reference: z.string().trim().max(120).nullable().optional(), paidAt: z.coerce.date().optional(), expectedAmount: z.number().int().min(0).optional() })
    .parse(body ?? {});
  if (paidAt && paidAt.getTime() > Date.now() + 60 * 60_000) throw { statusCode: 400, message: 'The transfer date cannot be in the future.' };
  return markPayoutPaid(fastify.prisma, id, { by: actor, reference: reference ?? null, paidAt, expected: expectedAmount }).catch(fail);
}

export async function adminCancelPayout(fastify: FastifyInstance, id: string, body: unknown) {
  const { reason } = z.object({ reason: z.string().trim().min(2).max(300) }).parse(body);
  await cancelPayout(fastify.prisma, id, reason).catch(fail);
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

export async function adminSaveSettings(fastify: FastifyInstance, body: unknown) {
  const data = settingsSchema.parse(body);
  const next = { ...(await getAffiliateSettings(fastify.prisma)), ...data };
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
  return getAffiliateSettings(fastify.prisma);
}
