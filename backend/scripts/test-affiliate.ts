/**
 * Ascend Affiliate's money rules (utils/affiliate.ts, docs/affiliate.md).
 *
 * Part 1 needs nothing: the commission sum, the margin budget, the cost.
 *
 * Part 2 writes to a database — DATABASE_URL must be a LOCAL one. It switches
 * the programme on, makes its own member, affiliate and orders through the
 * real checkout and admin paths, walks them through paid → payout → refund,
 * and removes everything it made (stock is put back) and restores the
 * settings it touched. Nothing is sent: order notices are off unless the local
 * database has them on, and the email worker is not running here.
 *
 *   npx tsx scripts/test-affiliate.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import { env } from '../src/config/env.js';
import {
  AFFILIATE_SETTING_KEYS,
  adjustBalance,
  affiliateBalance,
  cancelPayout,
  commissionTarget,
  mailbox,
  suggestCode,
  markPayoutPaid,
  rateProblem,
  requestPayout,
  subscriber,
  syncAffiliateOrders,
  type CommissionableOrder,
} from '../src/utils/affiliate.js';
import { costOrder } from '../src/utils/profit.js';
import { computeBank, loadBankInput } from '../src/utils/bank.js';
import { adminUpdateDiscount, validateDiscountCode } from '../src/modules/admin/admin-discounts.controller.js';
import { createOrder } from '../src/modules/orders/orders.controller.js';
import { adminSetOrderTest, adminUpdateOrder } from '../src/modules/admin/admin-orders.controller.js';
import { adminCancelPayout, adminUpdateAffiliate, joinProgramme, listAffiliateOrders, requestMyPayout } from '../src/modules/affiliates/affiliates.controller.js';
import { affiliateMailSamples, renderAffiliateEmail } from '../src/emails/affiliate.js';
import { mintSignupBonus } from '../src/modules/members/members.controller.js';
import { adminDecideChange, changeState, requestChange, withdrawChange } from '../src/modules/affiliates/affiliate-changes.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name} — ${e?.message ?? JSON.stringify(e)}`);
    fail++;
    failures.push(name);
  }
}

const eq = (actual: unknown, expected: unknown, msg = '') => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} got ${a}, expected ${b}`);
};

async function refused(fn: () => Promise<unknown>, match: RegExp) {
  try {
    await fn();
  } catch (e: any) {
    const m = e?.message ?? '';
    if (!match.test(m)) throw new Error(`refused for the wrong reason: "${m}"`);
    return;
  }
  throw new Error(`expected a refusal matching ${match}`);
}

const base: CommissionableOrder = {
  affiliateId: 'a',
  affiliateRateBps: 500,
  paymentStatus: 'PAID',
  status: 'CONFIRMED',
  isTest: false,
  deletedAt: null,
  total: 20_000 + 1_000 - 1_000, // RM200 goods, RM10 shipping, RM10 off
  shippingFee: 1_000,
  refundedAmount: 0,
};

function part1() {
  console.log('— affiliate emails render');
  const ctx = { name: 'Amir', code: 'AH87123', rate: '5%', customerDiscountPct: 5, portalUrl: 'https://affiliate.example.test', shareUrl: 'https://shop.example.test/?ref=AH87123' };
  for (const [name, mail] of affiliateMailSamples()) {
    check(`${name}: subject, greeting, no holes`, () => {
      const { subject, html } = renderAffiliateEmail(mail, ctx, {});
      if (!subject || !html.includes('Hi Amir,')) throw new Error('no subject or greeting');
      const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
      for (const hole of ['undefined', 'NaN', '[object', 'null']) if (text.includes(hole)) throw new Error(`"${hole}" in the text`);
      if (mail.kind !== 'rejected' && !html.includes('https://affiliate.example.test')) throw new Error('no link to the portal');
      if (['approved', 'paused', 'reactivated', 'applied'].includes(mail.kind) && !html.includes('AH87123')) throw new Error('no code');
    });
  }
  check('the team\'s reason is escaped', () => {
    const { html } = renderAffiliateEmail({ kind: 'changeRejected', fields: ['Name'], reason: '<script>x</script>' }, ctx, {});
    if (html.includes('<script>x')) throw new Error('raw HTML in the reason');
  });

  console.log('\n— commission, budget, cost');

  check('5% of the goods after discount, shipping left out', () => eq(commissionTarget(base), 950));
  check('nothing before payment', () => eq(commissionTarget({ ...base, paymentStatus: 'UNPAID' }), 0));
  check('nothing on a failed payment', () => eq(commissionTarget({ ...base, paymentStatus: 'FAILED' }), 0));
  check('nothing on a cancelled, deleted or test order', () => {
    eq(commissionTarget({ ...base, status: 'CANCELLED' }), 0);
    eq(commissionTarget({ ...base, deletedAt: new Date() }), 0);
    eq(commissionTarget({ ...base, isTest: true }), 0);
  });
  check('a full refund takes all of it back', () => eq(commissionTarget({ ...base, paymentStatus: 'REFUNDED', refundedAmount: base.total }), 0));
  check('a part refund takes back the same share', () => eq(commissionTarget({ ...base, refundedAmount: 2_000 }), 855));
  check('no affiliate, no commission', () => eq(commissionTarget({ ...base, affiliateId: null }), 0));
  check('3% is 3%', () => eq(commissionTarget({ ...base, affiliateRateBps: 300 }), 570));

  check('one inbox, however it is written', () => {
    eq(['Amir+shop@Gmail.com', 'a.mir@googlemail.com', ' amir@gmail.com '].map(mailbox), ['amir@gmail.com', 'amir@gmail.com', 'amir@gmail.com']);
    eq([mailbox('a.mir@ascend.my'), mailbox('amir+x@ascend.my')], ['a.mir@ascend.my', 'amir@ascend.my']);
  });
  check('one phone, however it is written', () =>
    eq(['+60 13-777 8899', '60137778899', '0137778899', '137778899'].map(subscriber), Array(4).fill('137778899')));

  const s = { customerDiscountPct: 5, marginBudgetPct: 10 };
  check('5% + 5% fits a 10% budget', () => eq(rateProblem(500, s), null));
  check('5.5% + 5% is refused', () => {
    if (!rateProblem(550, s)?.includes('most allowed: 5%')) throw new Error(String(rateProblem(550, s)));
  });

  check('commission is an order cost', () => {
    const c = costOrder({ total: 20_000, items: [{ quantity: 1, unitCost: 10_000 }], extraCosts: [], affiliateCommission: 950 });
    eq([c.cost, c.profit, c.affiliateCommission], [10_950, 9_050, 950]);
  });
  check('an order without one is unchanged', () => {
    const c = costOrder({ total: 20_000, items: [{ quantity: 1, unitCost: 10_000 }], extraCosts: [] });
    eq([c.cost, c.profit], [10_000, 10_000]);
  });
}

async function part2() {
  if (/43\.134|ascend-vps|prod/i.test(env.DATABASE_URL) || !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
    console.log('\n— database part skipped: DATABASE_URL is not a local database');
    return;
  }
  console.log('\n— database (local): checkout → paid → payout → refund');
  const prisma = new PrismaClient({ adapter: new PrismaPg(env.DATABASE_URL) });
  // Email is off here (no Resend key), so mailAffiliate logs instead of
  // sending: that log is what the email checks read.
  const mails: { kind: string; to: string; subject: string }[] = [];
  const mailErrors: unknown[] = [];
  const quiet = {
    info: (o: any, msg?: string) => { if (msg?.includes('affiliate email')) mails.push({ kind: o.kind, to: o.to, subject: o.subject }); },
    warn: () => {},
    error: (o: any, msg?: string) => { if (msg?.includes('affiliate email')) mailErrors.push(o?.err ?? o); },
    debug: () => {},
  };
  const fastify = { prisma, log: quiet } as unknown as FastifyInstance;
  const stamp = Date.now().toString(36);

  const keys = Object.values(AFFILIATE_SETTING_KEYS);
  const savedSettings = await prisma.setting.findMany({ where: { key: { in: keys } } });
  const setSetting = (key: string, value: string) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });

  const memberIds: string[] = [];
  const orderIds: string[] = [];
  const codeIds: string[] = [];
  let affiliateId = '';

  // A plain, in-stock product the checkout will sell.
  const variant = await prisma.productVariant.findFirst({
    where: { stock: { gt: 20 }, active: true, product: { active: true, addOnOnly: false, noShipping: false } },
    select: { id: true },
    orderBy: { stock: 'desc' },
  });
  if (!variant) throw new Error('no in-stock variant in this database');

  const member = await prisma.member.create({
    data: { email: `aff-${stamp}@example.test`, passwordHash: 'x', displayName: 'Aff Test', emailVerified: true },
  });
  memberIds.push(member.id);
  const affPhone = `0137${stamp.replace(/\D/g, '').padEnd(6, '1').slice(0, 6)}`;

  const buy = async (suffix: string, extra: Record<string, unknown> = {}) => {
    const r: any = await createOrder(fastify, {
      customerName: `Buyer ${suffix}`,
      phone: `0198${stamp.replace(/\D/g, '').padEnd(5, '2').slice(0, 5)}${suffix.length}`,
      email: `buyer-${suffix}-${stamp}@example.test`,
      address: '1 Test St',
      city: 'Shah Alam',
      state: 'Selangor',
      postcode: '40000',
      paymentMethod: 'WHATSAPP',
      items: [{ variantId: variant.id, quantity: 2 }],
      ...extra,
    });
    const order = r.order ?? r;
    orderIds.push(order.id);
    return order as { id: string; orderNumber: string; total: number; shippingFee: number; discountAmount: number; subtotal: number };
  };

  try {
    await setSetting(AFFILIATE_SETTING_KEYS.enabled, 'true');
    await setSetting(AFFILIATE_SETTING_KEYS.defaultRateBps, '500');
    await setSetting(AFFILIATE_SETTING_KEYS.customerDiscountPct, '5');
    await setSetting(AFFILIATE_SETTING_KEYS.marginBudgetPct, '10');
    await setSetting(AFFILIATE_SETTING_KEYS.holdDays, '3');
    let code = '';
    await check('join: APPLIED, code made but not live', async () => {
      const r = await joinProgramme(fastify, { id: member.id, email: member.email }, {
        fullName: 'Aff Test', phone: affPhone, code: `TST${stamp}`.slice(0, 16), acceptTerms: true,
      });
      affiliateId = (r.affiliate as any).id;
      code = r.affiliate.code;
      const dc = await prisma.discountCode.findUniqueOrThrow({ where: { code } });
      codeIds.push(dc.id);
      eq([r.affiliate.status, dc.isActive, dc.discountValue, dc.scope], ['APPLIED', false, 5, 'STORE']);
    });

    await check('an unapproved code does nothing at checkout', () =>
      refused(() => validateDiscountCode(fastify, code, 10_000, { email: 'someone@example.test' }), /no longer active/)
    );

    await check('approve: code goes live at the default rate', async () => {
      const d = await adminUpdateAffiliate(fastify, affiliateId, { status: 'ACTIVE' }, 'test');
      const dc = await prisma.discountCode.findUniqueOrThrow({ where: { code } });
      eq([d.affiliate.status, d.affiliate.rateBps, dc.isActive], ['ACTIVE', 500, true]);
    });

    await check('a rate over the budget is refused', () =>
      refused(() => adminUpdateAffiliate(fastify, affiliateId, { rateBps: 600 }, 'test'), /margin budget/)
    );

    await check('their own code is refused by email', () =>
      refused(() => validateDiscountCode(fastify, code, 10_000, { email: member.email.toUpperCase() }), /own affiliate code/)
    );
    await check('…and by phone', () =>
      refused(() => validateDiscountCode(fastify, code, 10_000, { email: 'other@example.test', phone: `+6${affPhone}` }), /own affiliate code/)
    );

    let o1!: Awaited<ReturnType<typeof buy>>;
    await check('checkout with the code: 5% off, affiliate and rate stamped', async () => {
      o1 = await buy('one', { discountCode: code.toLowerCase() });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
      eq([row.affiliateId, row.affiliateRateBps, row.discountAmount, row.affiliateCommission], [affiliateId, 500, Math.round(o1.subtotal * 0.05), 0]);
    });

    const goods1 = () => o1.total - o1.shippingFee;
    await check('unpaid: nothing earned, shown as awaiting payment', async () => {
      await syncAffiliateOrders(prisma, [o1.id]);
      const b = await affiliateBalance(prisma, affiliateId);
      eq([b.balance, b.awaitingPayment, b.awaitingPaymentOrders], [0, Math.round(goods1() * 0.05), 1]);
    });

    await check('marked paid: one COMMISSION entry, booked on the order', async () => {
      await adminUpdateOrder(fastify, o1.id, { paymentStatus: 'PAID' }, 'test');
      await syncAffiliateOrders(prisma); // a second sweep books nothing more
      const e = await prisma.affiliateEntry.findMany({ where: { orderId: o1.id } });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
      eq([e.length, e[0]?.kind, e[0]?.amount, row.affiliateCommission], [1, 'COMMISSION', Math.round(goods1() * 0.05), Math.round(goods1() * 0.05)]);
    });

    await check('a later rate change leaves the placed order alone', async () => {
      await adminUpdateAffiliate(fastify, affiliateId, { rateBps: 300 }, 'test');
      await syncAffiliateOrders(prisma, [o1.id]);
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
      eq([row.affiliateRateBps, row.affiliateCommission], [500, Math.round(goods1() * 0.05)]);
      await adminUpdateAffiliate(fastify, affiliateId, { rateBps: 500 }, 'test');
    });

    await check('no payout without bank details', () => refused(() => requestPayout(prisma, affiliateId), /bank details/));
    await prisma.affiliate.update({ where: { id: affiliateId }, data: { bankName: 'Maybank', bankAccountName: 'AFF TEST', bankAccountNumber: '112233445566' } });

    const c1 = Math.round(goods1() * 0.05);
    let payoutId = '';
    const t0 = new Date();
    await check('payout asked: the whole balance, payable after 3 days', async () => {
      const p = await requestPayout(prisma, affiliateId, t0);
      payoutId = p.id;
      eq([p.amount, p.availableAt.getTime() - t0.getTime(), p.bankAccountNumber], [c1, 3 * 86_400_000, '112233445566']);
      const b = await affiliateBalance(prisma, affiliateId);
      eq([b.balance, b.requested, b.available], [c1, c1, 0]);
    });
    await check('one open request at a time', () => refused(() => requestPayout(prisma, affiliateId), /already have a payout/));
    await check('not payable inside the hold', () =>
      refused(() => markPayoutPaid(prisma, payoutId, { by: 'test', now: new Date(t0.getTime() + 2 * 86_400_000) }), /Payable from/)
    );
    await check('paid after the hold: PAYOUT entry, balance zero', async () => {
      const r = await markPayoutPaid(prisma, payoutId, { by: 'test', reference: 'TRX1', now: new Date(t0.getTime() + 3 * 86_400_000 + 60_000) });
      eq([r.status, r.paidAmount], ['PAID', c1]);
      eq((await affiliateBalance(prisma, affiliateId)).balance, 0);
    });
    await check("…and it is money out of Ascend's bank", async () => {
      const bank = computeBank(await loadBankInput(fastify));
      if (!bank.started) return; // no opening balance in this database: nothing to check
      const m = bank.movements.find((x) => x.key === `AFFILIATE:${payoutId}`);
      eq([m?.source, m?.amount], ['AFFILIATE', -c1]);
    });

    await check('refunded after the payout: reversed, balance goes negative', async () => {
      await adminUpdateOrder(fastify, o1.id, { paymentStatus: 'REFUNDED' }, 'test');
      const b = await affiliateBalance(prisma, affiliateId);
      const rev = await prisma.affiliateEntry.findFirst({ where: { orderId: o1.id, kind: 'REVERSAL' } });
      eq([rev?.amount, rev?.note, b.balance, b.available], [-c1, 'Order refunded', -c1, 0]);
    });

    let o2!: Awaited<ReturnType<typeof buy>>;
    await check('new commission pays the debt off first', async () => {
      o2 = await buy('two', { discountCode: code });
      await adminUpdateOrder(fastify, o2.id, { paymentStatus: 'PAID' }, 'test');
      const c2 = Math.round((o2.total - o2.shippingFee) * 0.05);
      eq((await affiliateBalance(prisma, affiliateId)).balance, c2 - c1);
    });

    await check('a test-mark takes it back, unmarking restores it', async () => {
      const before = (await affiliateBalance(prisma, affiliateId)).balance;
      const c2 = Math.round((o2.total - o2.shippingFee) * 0.05);
      await adminSetOrderTest(fastify, o2.id, { isTest: true });
      eq((await affiliateBalance(prisma, affiliateId)).balance, before - c2, 'marked:');
      await adminSetOrderTest(fastify, o2.id, { isTest: false });
      eq((await affiliateBalance(prisma, affiliateId)).balance, before, 'unmarked:');
    });

    let o3!: Awaited<ReturnType<typeof buy>>;
    await check('a refund inside the hold is not paid out', async () => {
      o3 = await buy('three', { discountCode: code });
      await adminUpdateOrder(fastify, o3.id, { paymentStatus: 'PAID' }, 'test');
      const t = new Date();
      const p = await requestPayout(prisma, affiliateId, t);
      // Half of order three comes back while the payout waits.
      await adminUpdateOrder(fastify, o3.id, { refundedAmount: Math.round(o3.total / 2) }, 'test');
      const now = (await affiliateBalance(prisma, affiliateId)).balance;
      const r = await markPayoutPaid(prisma, p.id, { by: 'test', now: new Date(t.getTime() + 4 * 86_400_000) });
      eq([r.status, r.paidAmount, (await affiliateBalance(prisma, affiliateId)).balance], ['PAID', Math.min(p.amount, now), now - Math.min(p.amount, now)]);
      if (!(r.paidAmount < p.amount)) throw new Error('should have paid less than asked');
    });

    await check("a paused affiliate's payout waits", async () => {
      await adjustBalance(prisma, affiliateId, 500, 'test credit', 'test');
      const t = new Date();
      const p = await requestPayout(prisma, affiliateId, t);
      await adminUpdateAffiliate(fastify, affiliateId, { status: 'PAUSED' }, 'test');
      await refused(() => markPayoutPaid(prisma, p.id, { by: 'test', now: new Date(t.getTime() + 4 * 86_400_000) }), /paused/);
      await cancelPayout(prisma, p.id, 'test');
      await adminUpdateAffiliate(fastify, affiliateId, { status: 'ACTIVE' }, 'test');
      await adjustBalance(prisma, affiliateId, -500, 'test credit back', 'test');
    });

    await check('mark paid is refused when the sum moved since the page loaded', async () => {
      await adjustBalance(prisma, affiliateId, 700, 'test credit', 'test');
      const t = new Date();
      const p = await requestPayout(prisma, affiliateId, t);
      const later = new Date(t.getTime() + 4 * 86_400_000);
      await refused(() => markPayoutPaid(prisma, p.id, { by: 'test', now: later, expected: p.amount + 1 }), /now pays/);
      await cancelPayout(prisma, p.id, 'test');
      await adjustBalance(prisma, affiliateId, -700, 'test credit back', 'test');
    });

    await check('joining with half the bank details is refused', async () => {
      const m = await prisma.member.create({ data: { email: `aff-bank-${stamp}@example.test`, passwordHash: 'x', displayName: 'Bank Test', emailVerified: true } });
      memberIds.push(m.id);
      await refused(
        () => joinProgramme(fastify, { id: m.id, email: m.email }, { fullName: 'Bank Test', phone: '0137001234', code: `BT${stamp}`.slice(0, 12), bankName: 'Maybank', acceptTerms: true }),
        /Fill in the bank/
      );
      eq(await prisma.affiliate.count({ where: { memberId: m.id } }), 0);
    });

    await check('suggested codes are initials and digits, not a name', async () => {
      const codes = await Promise.all(['Amir Hakim', 'siti nur aminah', 'Ravi', "Nur'aisyah bt. Ali", ''].map((n) => suggestCode(prisma, n)));
      for (const c of codes) if (!/^[A-Z]{2}\d{4,6}$/.test(c)) throw new Error(`bad shape: ${c}`);
      eq(codes.slice(0, 3).map((c) => c.slice(0, 2)), ['AH', 'SN', 'RA']);
    });

    await check('details change by request: nothing moves until approved, one request at a time', async () => {
      const a = await prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId } });
      const base = { fullName: a.fullName, phone: a.phone, channel: a.channel, bankName: a.bankName, bankAccountName: a.bankAccountName, bankAccountNumber: a.bankAccountNumber };
      await requestChange(fastify, member.id, { ...base, bankName: 'CIMB Bank', bankAccountNumber: '7000 1234 5678' });
      eq((await prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId } })).bankName, 'Maybank', 'not yet:');
      // Sent again before the team answers: replaces it, carrying everything wanted now.
      await requestChange(fastify, member.id, { ...base, bankName: 'CIMB Bank', bankAccountNumber: '700012345678', channel: '@aff.test' });
      const pending = await prisma.affiliateChangeRequest.findMany({ where: { affiliateId, status: 'PENDING' } });
      eq([pending.length, pending[0].changes], [1, { channel: '@aff.test', bankName: 'CIMB Bank', bankAccountNumber: '700012345678' }]);
      await refused(() => requestChange(fastify, member.id, { ...base, bankName: null, bankAccountName: null, bankAccountNumber: null }), /not removed/);
      await refused(() => requestChange(fastify, member.id, { ...base, bankAccountName: null }), /Fill in the bank/);
      // A payout waiting when it is approved goes to the new account.
      await adjustBalance(prisma, affiliateId, 300, 'test credit', 'test');
      const p = await requestPayout(prisma, affiliateId);
      await adminDecideChange(fastify, pending[0].id, { decision: 'approve' }, 'test');
      const after = await prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId } });
      const payout = await prisma.affiliatePayout.findUniqueOrThrow({ where: { id: p.id } });
      eq([after.bankName, after.bankAccountNumber, after.channel, payout.bankName, payout.bankAccountNumber], ['CIMB Bank', '700012345678', '@aff.test', 'CIMB Bank', '700012345678']);
      await refused(() => adminDecideChange(fastify, pending[0].id, { decision: 'approve' }, 'test'), /already approved/);
      await cancelPayout(prisma, p.id, 'test');
      await adjustBalance(prisma, affiliateId, -300, 'test credit back', 'test');
      // Rejected: nothing moves, they see why. Withdrawn: gone.
      await requestChange(fastify, member.id, { ...base, fullName: 'Someone Else', bankName: 'CIMB Bank', bankAccountNumber: '700012345678', channel: '@aff.test' });
      const r = await prisma.affiliateChangeRequest.findFirstOrThrow({ where: { affiliateId, status: 'PENDING' } });
      await adminDecideChange(fastify, r.id, { decision: 'reject', reason: 'Name does not match the account' }, 'test');
      eq([(await prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId } })).fullName, (await changeState(fastify, affiliateId)).lastRejected?.rejectReason], [a.fullName, 'Name does not match the account']);
      await requestChange(fastify, member.id, { ...base, phone: '0137000000', bankName: 'CIMB Bank', bankAccountNumber: '700012345678', channel: '@aff.test' });
      await withdrawChange(fastify, member.id);
      eq(await prisma.affiliateChangeRequest.count({ where: { affiliateId, status: 'PENDING' } }), 0);
      await prisma.affiliate.update({ where: { id: affiliateId }, data: base });
    });

    await check('the discounts page cannot edit an affiliate code', async () => {
      const a = await prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId }, select: { discountCodeId: true } });
      await refused(() => adminUpdateDiscount(fastify, a.discountCodeId, { discountValue: 50 }), /affiliate code/);
    });

    await check("the affiliate's order list shows no customer details", async () => {
      const r = await listAffiliateOrders(fastify, affiliateId, {});
      const keys = Object.keys(r.data[0] ?? {});
      for (const k of ['customerName', 'phone', 'email', 'address']) if (keys.includes(k)) throw new Error(`exposes ${k}`);
      eq(r.data.map((o) => o.state).sort(), ['EARNED', 'PART_REFUNDED', 'REFUNDED']);
    });

    await check('the order cost carries the commission', async () => {
      const row = await prisma.order.findUniqueOrThrow({ where: { id: o2.id }, select: { total: true, affiliateCommission: true } });
      const c = costOrder({ total: row.total, items: [{ quantity: 1, unitCost: 0 }], extraCosts: [], affiliateCommission: row.affiliateCommission });
      eq(c.cost, row.affiliateCommission);
    });

    await check("Abby: set_affiliate changes the rate, mark_affiliate_payout_paid pays a ready payout", async () => {
      const { affiliateTools } = await import('../src/modules/ai-agent/tools/affiliates.tools.js');
      const ctx = { fastify, prisma, actor: { phone: '', name: 'Test', canWrite: true } } as any;
      const tool = (n: string) => affiliateTools.find((t) => t.name === n)!;
      await tool('set_affiliate').run(ctx, { affiliate: code, commissionPercent: 4 });
      eq((await prisma.affiliate.findUniqueOrThrow({ where: { id: affiliateId } })).rateBps, 400, 'rate:');
      await tool('set_affiliate').run(ctx, { affiliate: code, commissionPercent: 5 });
      await adjustBalance(prisma, affiliateId, 1_000, 'test top-up', 'test');
      await setSetting(AFFILIATE_SETTING_KEYS.holdDays, '0');
      const p = await requestPayout(prisma, affiliateId);
      const r: any = await tool('mark_affiliate_payout_paid').run(ctx, { affiliate: code, reference: 'ABBY1' });
      const row = await prisma.affiliatePayout.findUniqueOrThrow({ where: { id: p.id } });
      eq([r.status, row.status, row.reference, row.paidBy], ['PAID', 'PAID', 'ABBY1', 'Abby for Test']);
      await setSetting(AFFILIATE_SETTING_KEYS.holdDays, '3');
    });

    await check('affiliate emails: one at each step, to their account email', async () => {
      // Asking for a payout and the team cancelling it, through the same
      // calls the portal and the admin make.
      await adjustBalance(prisma, affiliateId, 500, 'test credit', 'test');
      const { payout } = await requestMyPayout(fastify, member.id);
      await adminCancelPayout(fastify, payout.id, { reason: 'Wrong account name' });
      await adjustBalance(prisma, affiliateId, -500, 'test credit back', 'test');
      eq(mails.map((m) => m.kind), ['applied', 'approved', 'paused', 'reactivated', 'changeApproved', 'changeRejected', 'payoutPaid', 'payoutRequested', 'payoutCancelled']);
      eq([...new Set(mails.map((m) => m.to))], [member.email]);
      eq(mailErrors.length, 0, 'errors:');
    });

    await check('a rejected application gets one email', async () => {
      const m = await prisma.member.create({ data: { email: `aff-rej-${stamp}@example.test`, passwordHash: 'x', displayName: 'Rej', emailVerified: true } });
      memberIds.push(m.id);
      const r = await joinProgramme(fastify, { id: m.id, email: m.email }, { fullName: 'Rej Test', phone: '0137009876', code: `RJ${stamp}`.slice(0, 12), acceptTerms: true });
      const id = (r.affiliate as any).id;
      const dc = await prisma.discountCode.findUniqueOrThrow({ where: { code: r.affiliate.code } });
      codeIds.push(dc.id);
      const before = mails.length;
      await adminUpdateAffiliate(fastify, id, { status: 'REJECTED' }, 'test');
      eq(mails.slice(before).map((x) => [x.kind, x.to]), [['rejected', m.email]]);
      await prisma.affiliate.delete({ where: { id } });
    });

    await check('order emails still queue for an order with an affiliate code', async () => {
      // Sending switched on for a moment, with a key that cannot send: the
      // outbox rows are what matters, and the worker is not running here.
      const savedKey = process.env.RESEND_API_KEY;
      const savedSwitch = await prisma.setting.findUnique({ where: { key: 'emails_enabled' } });
      process.env.RESEND_API_KEY = 're_test_not_a_real_key';
      await setSetting('emails_enabled', 'true');
      try {
        const o = await buy('mail', { discountCode: code });
        await adminUpdateOrder(fastify, o.id, { paymentStatus: 'PAID' }, 'test');
        const rows = await prisma.emailOutbox.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } });
        eq(rows.map((r) => [r.type, r.toEmail]), [['ORDER_CONFIRMATION', `buyer-mail-${stamp}@example.test`], ['PAYMENT_RECEIPT', `buyer-mail-${stamp}@example.test`]]);
      } finally {
        if (savedKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = savedKey;
        if (savedSwitch) await setSetting('emails_enabled', savedSwitch.value);
        else await prisma.setting.deleteMany({ where: { key: 'emails_enabled' } });
      }
    });

    await check('programme off: codes stop working', async () => {
      await setSetting(AFFILIATE_SETTING_KEYS.enabled, 'false');
      await refused(() => validateDiscountCode(fastify, code, 10_000, { email: 'other@example.test' }), /no longer active/);
      await setSetting(AFFILIATE_SETTING_KEYS.enabled, 'true');
    });

    await check('sign-up bonus: off mints nothing, on mints one bound single-use code', async () => {
      const m2 = await prisma.member.create({ data: { email: `bonus-${stamp}@example.test`, passwordHash: 'x', displayName: 'Bonus', emailVerified: true } });
      memberIds.push(m2.id);
      await setSetting(AFFILIATE_SETTING_KEYS.signupBonusEnabled, 'false');
      eq(await mintSignupBonus(fastify, m2.id), null, 'off:');
      await setSetting(AFFILIATE_SETTING_KEYS.signupBonusEnabled, 'true');
      await setSetting(AFFILIATE_SETTING_KEYS.signupBonusPct, '10');
      const c = await mintSignupBonus(fastify, m2.id);
      if (c) codeIds.push(c.id);
      eq([c?.discountValue, c?.maxUses, c?.boundEmail], [10, 1, m2.email]);
      eq(await mintSignupBonus(fastify, m2.id), null, 'second time:');
      await refused(() => validateDiscountCode(fastify, c!.code, 10_000, { email: 'someone-else@example.test' }), /different email/);
      // The same inbox again, as an alias: no second code.
      const m3 = await prisma.member.create({ data: { email: `bonus-${stamp}+again@example.test`, passwordHash: 'x', displayName: 'Bonus', emailVerified: true } });
      memberIds.push(m3.id);
      eq(await mintSignupBonus(fastify, m3.id), null, 'alias:');
    });
  } finally {
    // Put back the stock checkout took, then remove everything made here.
    const items = await prisma.orderItem.findMany({ where: { orderId: { in: orderIds } }, select: { variantId: true, quantity: true, preorderQty: true } });
    for (const i of items) {
      const took = i.quantity - (i.preorderQty ?? 0);
      if (took > 0) await prisma.productVariant.update({ where: { id: i.variantId }, data: { stock: { increment: took } } });
    }
    await prisma.affiliateEntry.deleteMany({ where: { affiliateId } });
    await prisma.affiliateChangeRequest.deleteMany({ where: { affiliateId } });
    await prisma.affiliatePayout.deleteMany({ where: { affiliateId } });
    await prisma.$executeRawUnsafe(`DELETE FROM email_outbox WHERE "orderId" = ANY($1)`, orderIds);
    await prisma.$executeRawUnsafe(`DELETE FROM payment_events WHERE "orderId" = ANY($1)`, orderIds);
    await prisma.$executeRawUnsafe(`DELETE FROM order_profit_shares WHERE "orderId" = ANY($1)`, orderIds);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds }, parentItemId: { not: null } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (affiliateId) await prisma.affiliate.delete({ where: { id: affiliateId } }).catch(() => {});
    await prisma.member.deleteMany({ where: { id: { in: memberIds } } });
    await prisma.discountCode.deleteMany({ where: { id: { in: codeIds } } });
    await prisma.setting.deleteMany({ where: { key: { in: keys } } });
    for (const s of savedSettings) await setSetting(s.key, s.value);
    await prisma.$disconnect();
  }
}

part1();
await part2();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
