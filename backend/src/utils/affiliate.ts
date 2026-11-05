/**
 * Ascend Affiliate — the money rules (docs/affiliate.md).
 *
 * Fakhrul's note, 2026-11-02: give up at most 10% of an order — 5% off for the
 * customer who uses the code, 3–5% commission for the affiliate. Payouts are
 * paid no sooner than 7 days after they are asked for, so refunds land first;
 * a refund after a payout takes the commission back anyway and the balance
 * goes negative.
 *
 * How that is kept honest:
 *
 *  - An order bought with an affiliate's code carries the affiliate and the
 *    rate AT CHECKOUT (orders.affiliateRateBps). Changing someone's rate
 *    later never moves an order already placed.
 *  - What an order should have earned is a pure function of the order
 *    (`commissionTarget`). `syncAffiliateOrders` compares that with what has
 *    been booked (orders.affiliateCommission) and writes the difference as a
 *    ledger entry — COMMISSION up, REVERSAL down. Run at the PAID transition,
 *    after an admin edit, and as a sweep before every money read, so a refund,
 *    cancel, delete or test-mark reached by ANY path is caught. Nothing reads
 *    the order's status and decides by hand.
 *  - A balance is never stored: it is the sum of the affiliate's entries.
 *    A payout is a negative entry; a reversal after it simply leaves the sum
 *    below zero until new commission covers it.
 *  - The commission is a cost of the order (utils/profit.ts), so the
 *    partners' split is worked on what is left after paying the affiliate.
 *
 * All amounts are integer cents; rates are basis points (500 = 5%).
 */
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizePhone } from './phone.js';

type Db = PrismaClient | Prisma.TransactionClient;

// ── Settings ────────────────────────────────────────────────────────────────

export const AFFILIATE_SETTING_KEYS = {
  enabled: 'affiliate_enabled',
  defaultRateBps: 'affiliate_default_rate_bps',
  customerDiscountPct: 'affiliate_customer_discount_pct',
  marginBudgetPct: 'affiliate_margin_budget_pct',
  holdDays: 'affiliate_payout_hold_days',
  signupBonusEnabled: 'signup_bonus_enabled',
  signupBonusPct: 'signup_bonus_pct',
} as const;

export interface AffiliateSettings {
  /** The whole programme: joining, codes at checkout, the affiliate popup. */
  enabled: boolean;
  /** What a newly approved affiliate earns. */
  defaultRateBps: number;
  /** What a customer gets off with an affiliate's code. */
  customerDiscountPct: number;
  /** Discount + commission may not exceed this. */
  marginBudgetPct: number;
  /** Days between asking for a payout and it being payable. */
  holdDays: number;
  /** One-time code for a new store account, and the sign-up popup offering it. */
  signupBonusEnabled: boolean;
  signupBonusPct: number;
}

export const AFFILIATE_DEFAULTS: AffiliateSettings = {
  enabled: false,
  defaultRateBps: 500,
  customerDiscountPct: 5,
  marginBudgetPct: 10,
  holdDays: 7,
  signupBonusEnabled: false,
  signupBonusPct: 10,
};

function intOr(v: string | undefined, fallback: number, min: number, max: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export async function getAffiliateSettings(db: Db): Promise<AffiliateSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: Object.values(AFFILIATE_SETTING_KEYS) } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const K = AFFILIATE_SETTING_KEYS;
  const d = AFFILIATE_DEFAULTS;
  return {
    enabled: get(K.enabled) === 'true',
    defaultRateBps: intOr(get(K.defaultRateBps), d.defaultRateBps, 0, 5000),
    customerDiscountPct: intOr(get(K.customerDiscountPct), d.customerDiscountPct, 0, 50),
    marginBudgetPct: intOr(get(K.marginBudgetPct), d.marginBudgetPct, 0, 50),
    holdDays: intOr(get(K.holdDays), d.holdDays, 0, 60),
    signupBonusEnabled: get(K.signupBonusEnabled) === 'true',
    signupBonusPct: intOr(get(K.signupBonusPct), d.signupBonusPct, 1, 50),
  };
}

/** Why a rate is refused, or null when it fits the margin budget. */
export function rateProblem(rateBps: number, s: Pick<AffiliateSettings, 'customerDiscountPct' | 'marginBudgetPct'>): string | null {
  if (!Number.isInteger(rateBps) || rateBps < 0) return 'Commission must be a whole number of basis points, 0 or more.';
  const budgetBps = s.marginBudgetPct * 100;
  const discountBps = s.customerDiscountPct * 100;
  if (discountBps + rateBps > budgetBps) {
    return `Commission ${pct(rateBps)} plus the ${s.customerDiscountPct}% customer discount is over the ${s.marginBudgetPct}% margin budget (most allowed: ${pct(Math.max(0, budgetBps - discountBps))}).`;
  }
  return null;
}

export function ringgit(cents: number): string {
  return `RM ${(cents / 100).toFixed(2)}`;
}

export function pct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2).replace(/\.?0+$/, '')}%`;
}

// ── Commission per order ────────────────────────────────────────────────────

export interface CommissionableOrder {
  affiliateId: string | null;
  affiliateRateBps: number | null;
  paymentStatus: string;
  status: string;
  isTest: boolean;
  deletedAt: Date | null;
  total: number;
  shippingFee: number;
  refundedAmount: number;
}

/**
 * What the order has earned its affiliate right now.
 *
 * The base is the goods after the discount — what the customer paid less
 * shipping — and a refund takes back the same share of it as it took of the
 * total (RM 21 back on an RM 210 order removes a tenth of the commission).
 * Nothing is earned until the order is paid, and nothing is kept on an order
 * that is cancelled, deleted or turned out to be a test.
 */
export function commissionTarget(o: CommissionableOrder): number {
  if (!o.affiliateId || !o.affiliateRateBps) return 0;
  if (o.paymentStatus !== 'PAID' && o.paymentStatus !== 'REFUNDED') return 0;
  // Refunded with no amount given means the whole of it came back.
  if (o.paymentStatus === 'REFUNDED' && o.refundedAmount <= 0) return 0;
  if (o.status === 'CANCELLED' || o.isTest || o.deletedAt) return 0;
  if (o.total <= 0) return 0;
  const goods = Math.max(0, o.total - o.shippingFee);
  const kept = Math.max(0, o.total - o.refundedAmount);
  // One rounding, at the end: goods × kept / total × rate.
  return Math.round((goods * kept * o.affiliateRateBps) / (o.total * 10_000));
}

const COMMISSION_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  affiliateId: true,
  affiliateRateBps: true,
  affiliateCommission: true,
  paymentStatus: true,
  status: true,
  isTest: true,
  deletedAt: true,
  total: true,
  shippingFee: true,
  refundedAmount: true,
} as const;

function reasonFor(o: CommissionableOrder, target: number, booked: number): string {
  if (target > booked) return booked === 0 ? 'Order paid' : 'Commission restored';
  if (o.deletedAt) return 'Order deleted';
  if (o.isTest) return 'Marked as a test order';
  if (o.status === 'CANCELLED') return 'Order cancelled';
  if (o.refundedAmount >= o.total) return 'Order refunded';
  if (o.refundedAmount > 0) return 'Order partly refunded';
  return 'Order no longer paid';
}

/**
 * Books the difference between what each order should have earned and what
 * it has, as ledger entries. Pass ids to sync just those; omit to sweep every
 * order that carries an affiliate. Idempotent and safe to run concurrently: an
 * order is only moved from the exact amount that was read, so two sweeps can
 * never book the same difference twice. Returns how many orders moved.
 */
export async function syncAffiliateOrders(db: PrismaClient, orderIds?: string[]): Promise<number> {
  if (orderIds && orderIds.length === 0) return 0;
  const orders = await db.order.findMany({
    where: { affiliateId: { not: null }, ...(orderIds ? { id: { in: orderIds } } : {}) },
    select: COMMISSION_ORDER_SELECT,
  });
  let moved = 0;
  for (const o of orders) {
    const target = commissionTarget(o);
    const diff = target - o.affiliateCommission;
    if (diff === 0) continue;
    const done = await db.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: o.id, affiliateCommission: o.affiliateCommission },
        data: { affiliateCommission: target },
      });
      if (count === 0) return false;
      await tx.affiliateEntry.create({
        data: {
          affiliateId: o.affiliateId as string,
          kind: diff > 0 ? 'COMMISSION' : 'REVERSAL',
          amount: diff,
          orderId: o.id,
          note: reasonFor(o, target, o.affiliateCommission),
        },
      });
      return true;
    });
    if (done) moved++;
  }
  return moved;
}

/** Never throws: for the PAID hooks, where the sweep is the safety net. */
export async function syncAffiliateOrdersQuietly(fastify: FastifyInstance, orderIds?: string[]): Promise<void> {
  try {
    await syncAffiliateOrders(fastify.prisma, orderIds);
  } catch (err) {
    fastify.log.warn({ err, orderIds }, 'affiliate commission not synced');
  }
}

// ── Checkout ────────────────────────────────────────────────────────────────

export interface AffiliateCodeInfo {
  affiliateId: string;
  rateBps: number;
}

/**
 * For a code that belongs to an affiliate: refuses it when the programme is
 * off, the affiliate is not active, or the buyer is the affiliate (same email
 * or same phone). Returns null for an ordinary code.
 */
export async function checkAffiliateCode(
  db: Db,
  discountCodeId: string,
  buyer: { email?: string | null; phone?: string | null }
): Promise<AffiliateCodeInfo | null> {
  const affiliate = await db.affiliate.findUnique({
    where: { discountCodeId },
    select: { id: true, status: true, rateBps: true, phone: true, member: { select: { email: true } } },
  });
  if (!affiliate) return null;
  const settings = await getAffiliateSettings(db);
  if (!settings.enabled || affiliate.status !== 'ACTIVE') {
    throw { statusCode: 404, message: 'Invalid discount code' };
  }
  const email = buyer.email ? mailbox(buyer.email) : null;
  const phone = buyer.phone ? subscriber(buyer.phone) : null;
  if ((email && email === mailbox(affiliate.member.email)) || (phone && phone === subscriber(affiliate.phone))) {
    throw { statusCode: 400, message: "Your own affiliate code can't be used on your own order" };
  }
  return { affiliateId: affiliate.id, rateBps: affiliate.rateBps };
}

/**
 * The inbox an address delivers to, so amir+shop@gmail.com and
 * a.mir@gmail.com are the affiliate's own amir@gmail.com.
 */
export function mailbox(raw: string): string {
  const [local = '', domain = ''] = raw.trim().toLowerCase().split('@');
  const bare = local.split('+')[0];
  const gmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return `${gmail ? bare.replace(/\./g, '') : bare}@${gmail ? 'gmail.com' : domain}`;
}

/** The number without its country code or trunk 0: +60 13-777 8899, 0137778899 and 137778899 all read 137778899. */
export function subscriber(raw: string): string {
  let digits: string;
  try {
    digits = normalizePhone(raw).replace(/\D/g, '');
  } catch {
    digits = raw.replace(/\D/g, '');
  }
  return digits.replace(/^0+/, '');
}

// ── Codes ───────────────────────────────────────────────────────────────────

export const CODE_PATTERN = /^[A-Z0-9]{4,16}$/;

// Codes that would read as Ascend's own, or as a generic offer. Only the team
// can give one out (adminUpdateAffiliate).
const RESERVED_WORDS = ['ASCEND', 'ADMIN', 'OFFICIAL', 'STAFF', 'SUPPORT'];
const RESERVED_CODES = new Set(['TEST', 'FREE', 'SALE', 'PROMO', 'DISCOUNT', 'WELCOME', 'AFFILIATE']);

export function isReservedCode(code: string): boolean {
  return RESERVED_CODES.has(code) || RESERVED_WORDS.some((w) => code.includes(w));
}

/**
 * Text an affiliate typed, on one line. These fields reach the team's WhatsApp
 * notices, where a line break would let them write lines of their own.
 */
export function oneLine(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * A free code to suggest at join: their initials and four random digits —
 * "Amir Hakim" → AH4827. Short to type and to read out, vague enough that
 * nobody's name is on every post (Fakhrul, 2026-11-03). Letters then digits,
 * so an O is never mistaken for a 0. They can still type their own.
 */
export async function suggestCode(db: Db, fullName: string): Promise<string> {
  const words = fullName.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)).padEnd(2, 'A');
  for (let attempt = 0; attempt < 30; attempt++) {
    // Four digits for the first tries, five once those keep colliding.
    const digits = attempt < 20 ? 1000 + Math.floor(Math.random() * 9000) : 10000 + Math.floor(Math.random() * 90000);
    const code = `${initials}${digits}`;
    if (!(await db.discountCode.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  return `${initials}${Date.now().toString().slice(-6)}`;
}

// ── Balance ─────────────────────────────────────────────────────────────────

export interface AffiliateBalance {
  /** Everything earned less reversals, payouts and adjustments. May be negative. */
  balance: number;
  /** Already asked for and not yet paid or cancelled. */
  requested: number;
  /** What a new payout request can ask for: balance less open requests, never below 0. */
  available: number;
  /** Commission booked to date (before reversals). */
  earned: number;
  reversed: number;
  paidOut: number;
  /** What unpaid orders with the code will earn if they are paid. */
  awaitingPayment: number;
  awaitingPaymentOrders: number;
}

export async function affiliateBalance(db: Db, affiliateId: string): Promise<AffiliateBalance> {
  const [sums, open, waiting] = await Promise.all([
    db.affiliateEntry.groupBy({ by: ['kind'], where: { affiliateId }, _sum: { amount: true } }),
    db.affiliatePayout.aggregate({ where: { affiliateId, status: 'REQUESTED' }, _sum: { amount: true } }),
    db.order.findMany({
      where: { affiliateId, paymentStatus: 'UNPAID', status: { not: 'CANCELLED' }, deletedAt: null, isTest: false },
      select: { total: true, shippingFee: true, affiliateRateBps: true },
    }),
  ]);
  const by = (k: string) => sums.find((s) => s.kind === k)?._sum.amount ?? 0;
  const balance = sums.reduce((s, r) => s + (r._sum.amount ?? 0), 0);
  const requested = open._sum.amount ?? 0;
  const awaitingPayment = waiting.reduce(
    (s, o) => s + Math.round((Math.max(0, o.total - o.shippingFee) * (o.affiliateRateBps ?? 0)) / 10_000),
    0
  );
  return {
    balance,
    requested,
    available: Math.max(0, balance - requested),
    earned: by('COMMISSION'),
    reversed: -by('REVERSAL'),
    paidOut: -by('PAYOUT'),
    awaitingPayment,
    awaitingPaymentOrders: waiting.length,
  };
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export class AffiliateError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

/** The affiliate asks for everything available. One open request at a time. */
export async function requestPayout(db: PrismaClient, affiliateId: string, now = new Date()) {
  await syncAffiliateOrders(db, await affiliateOrderIds(db, affiliateId));
  const settings = await getAffiliateSettings(db);
  return db.$transaction(async (tx) => {
    // Lock the affiliate row so two clicks can't open two requests.
    await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${affiliateId} FOR UPDATE`;
    const a = await tx.affiliate.findUniqueOrThrow({ where: { id: affiliateId } });
    if (a.status !== 'ACTIVE') throw new AffiliateError('Your affiliate account is not active.');
    if (!a.bankName || !a.bankAccountName || !a.bankAccountNumber) {
      throw new AffiliateError('Add your bank details before asking for a payout.');
    }
    const open = await tx.affiliatePayout.findFirst({ where: { affiliateId, status: 'REQUESTED' } });
    if (open) throw new AffiliateError('You already have a payout on its way.');
    const { available } = await affiliateBalance(tx, affiliateId);
    if (available <= 0) throw new AffiliateError('There is nothing to pay out yet.');
    return tx.affiliatePayout.create({
      data: {
        affiliateId,
        amount: available,
        availableAt: new Date(now.getTime() + settings.holdDays * 86_400_000),
        bankName: a.bankName,
        bankAccountName: a.bankAccountName,
        bankAccountNumber: a.bankAccountNumber,
      },
    });
  });
}

async function affiliateOrderIds(db: Db, affiliateId: string): Promise<string[]> {
  const rows = await db.order.findMany({ where: { affiliateId }, select: { id: true } });
  return rows.map((r) => r.id);
}

export interface PayResult {
  status: 'PAID' | 'CANCELLED';
  paidAmount: number;
  /** When less than asked for, or nothing: why. */
  note: string | null;
}

/**
 * The team paid it. Pays the smaller of what was asked and the balance now —
 * a refund inside the hold is not paid out — and cancels the request when
 * refunds took the balance to nothing. Refused before the hold ends.
 */
export async function markPayoutPaid(
  db: PrismaClient,
  payoutId: string,
  opts: { by: string; reference?: string | null; paidAt?: Date; now?: Date; /** What the team transferred; refused if the sum moved since. */ expected?: number }
): Promise<PayResult> {
  const now = opts.now ?? new Date();
  const first = await db.affiliatePayout.findUnique({ where: { id: payoutId }, select: { affiliateId: true } });
  if (!first) throw new AffiliateError('Payout not found.', 404);
  await syncAffiliateOrders(db, await affiliateOrderIds(db, first.affiliateId));

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${first.affiliateId} FOR UPDATE`;
    const p = await tx.affiliatePayout.findUniqueOrThrow({ where: { id: payoutId } });
    if (p.status !== 'REQUESTED') throw new AffiliateError(`This payout is already ${p.status.toLowerCase()}.`);
    // A paused affiliate's money waits: reactivate them, or cancel the request.
    const owner = await tx.affiliate.findUniqueOrThrow({ where: { id: p.affiliateId }, select: { status: true, fullName: true } });
    if (owner.status !== 'ACTIVE') {
      throw new AffiliateError(`${owner.fullName} is ${owner.status.toLowerCase()}: make them active again to pay this, or cancel it.`);
    }
    if (p.availableAt.getTime() > now.getTime()) {
      throw new AffiliateError(`Payable from ${p.availableAt.toISOString()} — the hold lets refunds land first.`);
    }
    const { balance } = await affiliateBalance(tx, p.affiliateId);
    const pay = Math.max(0, Math.min(p.amount, balance));
    // Before anything is recorded, a nothing-left cancellation included: if the
    // team moved a different sum, the record must not quietly say otherwise.
    if (opts.expected !== undefined && opts.expected !== pay) {
      throw new AffiliateError(`This now pays ${ringgit(pay)}, not ${ringgit(opts.expected)} — a refund landed since the page loaded. Check it again.`, 409);
    }
    if (pay === 0) {
      const note = 'Refunds since the request took the balance to nothing.';
      await tx.affiliatePayout.update({
        where: { id: p.id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: note },
      });
      return { status: 'CANCELLED' as const, paidAmount: 0, note };
    }
    const note = pay < p.amount ? `Paid ${ringgit(pay)} of ${ringgit(p.amount)} asked: refunds since the request.` : null;
    await tx.affiliatePayout.update({
      where: { id: p.id },
      data: { status: 'PAID', paidAmount: pay, paidAt: opts.paidAt ?? now, paidBy: opts.by, reference: opts.reference ?? null },
    });
    await tx.affiliateEntry.create({
      data: { affiliateId: p.affiliateId, kind: 'PAYOUT', amount: -pay, payoutId: p.id, note: note ?? 'Paid to bank', createdBy: opts.by },
    });
    return { status: 'PAID' as const, paidAmount: pay, note };
  });
}

export async function cancelPayout(db: PrismaClient, payoutId: string, reason: string, now = new Date()) {
  const first = await db.affiliatePayout.findUnique({ where: { id: payoutId }, select: { affiliateId: true } });
  if (!first) throw new AffiliateError('Payout not found.', 404);
  // The lock markPayoutPaid holds, so a cancel can't land between its check
  // and its write and leave a payout both paid and cancelled.
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM affiliates WHERE id = ${first.affiliateId} FOR UPDATE`;
    const { count } = await tx.affiliatePayout.updateMany({
      where: { id: payoutId, status: 'REQUESTED' },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
    });
    if (count === 0) throw new AffiliateError('Only a payout still waiting can be cancelled.');
  });
}

/** A hand correction by the team, either sign. */
export async function adjustBalance(db: PrismaClient, affiliateId: string, amount: number, note: string, by: string) {
  if (!Number.isInteger(amount) || amount === 0) throw new AffiliateError('Enter an amount other than zero.');
  if (Math.abs(amount) > 10_000_000) throw new AffiliateError('An adjustment is at most RM 100,000.');
  if (!note.trim()) throw new AffiliateError('Say why.');
  if (!(await db.affiliate.findUnique({ where: { id: affiliateId }, select: { id: true } }))) {
    throw new AffiliateError('Affiliate not found.', 404);
  }
  return db.affiliateEntry.create({ data: { affiliateId, kind: 'ADJUSTMENT', amount, note: note.trim(), createdBy: by } });
}
