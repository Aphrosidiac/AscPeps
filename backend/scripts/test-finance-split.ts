/**
 * The order-split and partner-balance arithmetic.
 *
 * No database, no network. This exists because the capital column was
 * originally modelled as a charge — subtracted from the person who paid it —
 * which is the exact opposite of what it is, and nothing caught it. The
 * direction of every term in `owed` is asserted here now.
 *
 * The invariant that matters most: when the people on a split funded the whole
 * order, what they take home between them equals the order's REVENUE. The costs
 * flow back to whoever paid them and the profit splits by percentage; nothing
 * evaporates.
 *
 *   npx tsx scripts/test-finance-split.ts
 */
import { computeFinance } from '../src/utils/finance.js';
import { allocate, costOrder } from '../src/utils/profit.js';
import { computeBank, bankFlows } from '../src/utils/bank.js';
import { ruleAt, type SplitRule } from '../src/utils/split-rules.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name} — ${e?.message}`);
    fail++;
    failures.push(name);
  }
}

const eq = (actual: unknown, expected: unknown, msg = '') => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg} got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
};

const PARTNERS = [
  { id: 'p_fakhrul', name: 'Fakhrul', active: true },
  { id: 'p_asyraf', name: 'Asyraf', active: true },
  { id: 'p_investors', name: 'Investors', active: true },
];

/** The real-world case: RM145 in, RM60 of costs, Fakhrul paid for all of it. */
const ORDER = {
  id: 'o1',
  total: 14_500,
  items: [{ quantity: 1, unitCost: 6_000 }],
  extraCosts: [],
  profitShares: [
    { partnerId: 'p_fakhrul', shareBps: 3_000, capitalAmount: 6_000 },
    { partnerId: 'p_asyraf', shareBps: 3_000, capitalAmount: 0 },
    { partnerId: 'p_investors', shareBps: 4_000, capitalAmount: 0 },
  ],
};

const run = (over: Partial<Parameters<typeof computeFinance>[0]> = {}) =>
  computeFinance({ partners: PARTNERS, orders: [ORDER], expenses: [], funding: [], payouts: [], ...over });

const byName = (s: ReturnType<typeof computeFinance>, name: string) =>
  s.partners.find((p) => p.name === name)!;

// ------------------------------------------------------------------ the order

check('profit is revenue less costs', () => {
  eq(costOrder(ORDER).profit, 8_500);
});

check('profit splits by percentage, capital does not', () => {
  const cuts = allocate(8_500, [3_000, 3_000, 4_000]);
  eq(cuts, [2_550, 2_550, 3_400]);
  eq(cuts.reduce((a, b) => a + b, 0), 8_500, 'cuts must sum to the profit exactly:');
});

check('the person who funded the order gets it back ON TOP of their cut', () => {
  const s = run();
  // The bug this file exists for: this was 2550 − 6000 = −3450.
  eq(byName(s, 'Fakhrul').earned + byName(s, 'Fakhrul').capitalFronted, 8_550);
});

check('take-home across the split equals the order revenue', () => {
  // Costs go back to whoever paid them, profit splits by share. Nothing is
  // created and nothing disappears — the whole RM145 is accounted for.
  const s = run();
  const takeHome = s.partners.reduce((sum, p) => sum + p.earned + p.capitalFronted, 0);
  eq(takeHome, ORDER.total);
});

check('people who funded nothing take home their profit cut only', () => {
  const s = run();
  eq([byName(s, 'Asyraf').owed, byName(s, 'Investors').owed], [2_550, 3_400]);
});

// ------------------------------------------------------------------ balances

check('capital fronted increases what someone is owed', () => {
  eq(byName(run(), 'Fakhrul').owed, 8_550);
});

check('capital counts even before the order is costed', () => {
  // Profit is unknowable until every line is priced, but the money already left
  // their pocket — withholding it would understate what they are owed.
  const uncosted = { ...ORDER, items: [{ quantity: 1, unitCost: null }] };
  const s = computeFinance({ partners: PARTNERS, orders: [uncosted], expenses: [], funding: [], payouts: [] });
  eq(byName(s, 'Fakhrul').earned, 0, 'uncosted order must not pay profit:');
  eq(byName(s, 'Fakhrul').capitalFronted, 6_000);
  eq(byName(s, 'Fakhrul').owed, 6_000);
});

check('paying someone out reduces what they are owed', () => {
  const s = run({ payouts: [{ partnerId: 'p_fakhrul', amount: 8_550 }] });
  eq(byName(s, 'Fakhrul').owed, 0);
});

check('company spending never lands on a person', () => {
  const s = run({ expenses: [{ id: 'e1', amount: 5_000 }] });
  eq(byName(s, 'Fakhrul').owed, 8_550, 'a company expense moved a partner balance:');
  eq(s.companySpend, 5_000);
  eq(s.netProfit, 3_500, 'company spend must come off company profit:');
});

check('an advance is owed back, a contribution is not', () => {
  const s = run({
    funding: [
      { id: 'f1', partnerId: 'p_asyraf', type: 'ADVANCE', amount: 1_000, repayments: [] },
      { id: 'f2', partnerId: 'p_investors', type: 'CONTRIBUTION', amount: 9_999, repayments: [] },
    ],
  });
  eq(byName(s, 'Asyraf').owed, 3_550, 'advance should be added to owed:');
  eq(byName(s, 'Investors').owed, 3_400, 'contribution must stay out of owed:');
  eq(byName(s, 'Investors').contributed, 9_999);
});

check('a repaid advance stops being owed', () => {
  const s = run({
    funding: [{ id: 'f1', partnerId: 'p_asyraf', type: 'ADVANCE', amount: 1_000, repayments: [{ amount: 1_000 }] }],
  });
  eq(byName(s, 'Asyraf').owed, 2_550);
});

check('a share pointing at a deleted partner lands nowhere', () => {
  const orphan = {
    ...ORDER,
    profitShares: [{ partnerId: 'p_gone', shareBps: 10_000, capitalAmount: 6_000 }],
  };
  const s = computeFinance({ partners: PARTNERS, orders: [orphan], expenses: [], funding: [], payouts: [] });
  eq(s.partners.every((p) => p.owed === 0), true, 'an unknown partner was silently paid:');
  eq(s.grossOrderProfit, 8_500, 'the order profit itself should still count:');
});

// ------------------------------------------------------------ Ascend's bank
// docs/ascend-bank-plan.md. Ascend is a partner whose share stays in the bank;
// a shared order is settled; old capital is owed once, through its advance.

const BANK_PARTNERS = [
  { id: 'p_fakhrul', name: 'Fakhrul', active: true },
  { id: 'p_asywa', name: 'Asywa', active: true },
  { id: 'p_ascend', name: 'Ascend', active: true, kind: 'COMPANY' as const },
];
/** RM145 in, RM60 of costs paid by the bank, split 35 / 45 / 20. */
const NOV = {
  id: 'o_nov',
  total: 14_500,
  items: [{ quantity: 1, unitCost: 6_000 }],
  extraCosts: [],
  profitShares: [
    { partnerId: 'p_fakhrul', shareBps: 3_500, capitalAmount: 0 },
    { partnerId: 'p_asywa', shareBps: 4_500, capitalAmount: 0 },
    { partnerId: 'p_ascend', shareBps: 2_000, capitalAmount: 0 },
  ],
};
const bankRun = (over: Partial<Parameters<typeof computeFinance>[0]> = {}) =>
  computeFinance({ partners: BANK_PARTNERS, orders: [NOV], expenses: [], funding: [], payouts: [], ...over });

check("Ascend's share is kept, not owed to anyone", () => {
  const s = bankRun();
  eq(s.ascend?.retained, 1_700, 'Ascend keeps 20% of RM85:');
  eq(s.partners.map((p) => p.name).sort(), ['Asywa', 'Fakhrul'], 'Ascend must not be listed as a person:');
  eq(byName(s, 'Fakhrul').owed + byName(s, 'Asywa').owed + (s.ascend?.retained ?? 0), 8_500, 'the profit is fully accounted for:');
});

check('a shared order is settled — earned stays, owed goes', () => {
  const s = bankRun({ orders: [{ ...NOV, shared: true }] });
  eq(byName(s, 'Asywa').earned, 3_825);
  eq(byName(s, 'Asywa').toShare, 0);
  eq(byName(s, 'Asywa').owed, 0);
});

check("a share-out's payouts do not come off what is owed a second time", () => {
  const s = bankRun({ orders: [{ ...NOV, shared: true }], payouts: [{ partnerId: 'p_asywa', amount: 3_825, runId: 'r1' }] });
  eq(byName(s, 'Asywa').owed, 0);
  eq(byName(s, 'Asywa').paidOut, 3_825);
});

check('a payment on account (no share-out) does reduce what is owed', () => {
  const s = bankRun({ payouts: [{ partnerId: 'p_asywa', amount: 1_000 }] });
  eq(byName(s, 'Asywa').owed, 3_825 - 1_000);
});

check('capital on a hand-shared order is not owed again', () => {
  const old = { ...ORDER, shared: true };
  const s = computeFinance({ partners: PARTNERS, orders: [old], expenses: [], funding: [], payouts: [] });
  eq(byName(s, 'Fakhrul').capitalFronted, 6_000, 'history stays visible:');
  eq(byName(s, 'Fakhrul').owed, 0);
});

check('capital moved into an advance is owed once, through the advance', () => {
  const moved = {
    ...ORDER,
    profitShares: ORDER.profitShares.map((x) => (x.capitalAmount ? { ...x, capitalFundingId: 'f_cap' } : x)),
  };
  const s = computeFinance({
    partners: PARTNERS,
    orders: [moved],
    expenses: [],
    funding: [{ id: 'f_cap', partnerId: 'p_fakhrul', type: 'ADVANCE', amount: 6_000, repayments: [{ amount: 2_000 }] }],
    payouts: [],
  });
  eq(byName(s, 'Fakhrul').capitalOwed, 0);
  eq(byName(s, 'Fakhrul').owed, 2_550 + 4_000, 'their cut plus the RM40 of the advance still unpaid:');
});

const START = new Date('2026-10-20T16:00:00Z');
const bankInput = {
  entries: [
    { id: 'e0', kind: 'OPENING' as const, occurredAt: START, amount: 100_000, description: 'Opening' },
    { id: 'e1', kind: 'MONEY_OUT' as const, occurredAt: new Date('2026-10-22T03:00:00Z'), amount: 500, description: 'Bank charges' },
  ],
  orders: [
    { id: 'o_old', orderNumber: 'ASC2610/0001', paidAt: new Date('2026-10-01T03:00:00Z'), updatedAt: START, total: 14_500, gatewayFee: 100, refundedAmount: 0, paymentMethod: 'BILLPLZ', customerName: 'A' },
    { id: 'o_a', orderNumber: 'ASC2610/0047', paidAt: new Date('2026-10-21T03:00:00Z'), updatedAt: START, total: 72_000, gatewayFee: 100, refundedAmount: 0, paymentMethod: 'BILLPLZ', customerName: 'B' },
    { id: 'o_b', orderNumber: 'ASC2610/0050', paidAt: new Date('2026-10-21T05:00:00Z'), updatedAt: new Date('2026-10-23T05:00:00Z'), total: 32_000, gatewayFee: 0, refundedAmount: 32_000, paymentMethod: 'WHATSAPP', customerName: 'C' },
    { id: 'o_btc', orderNumber: 'ASC2610/0051', paidAt: new Date('2026-10-21T06:00:00Z'), updatedAt: START, total: 50_000, gatewayFee: 0, refundedAmount: 0, paymentMethod: 'CRYPTO', customerName: 'D' },
  ],
  funding: [
    { id: 'f1', partnerName: 'Asywa', type: 'CONTRIBUTION', amount: 20_000, occurredAt: new Date('2026-10-22T01:00:00Z'), description: 'Capital', throughBank: true, expenseId: null },
    { id: 'f_cap', partnerName: 'Asywa', type: 'ADVANCE', amount: 568_900, occurredAt: START, description: 'Capital fronted before the bank', throughBank: false, expenseId: null },
  ],
  expenses: [
    { id: 'x1', occurredAt: new Date('2026-10-22T02:00:00Z'), amount: 30_000, description: 'YL,C', category: 'Stock', paidByPartnerId: null },
    { id: 'x2', occurredAt: new Date('2026-10-22T02:00:00Z'), amount: 7_000, description: 'Ads', category: 'Ads', paidByPartnerId: 'p_asywa' },
  ],
  payouts: [{ id: 'po1', partnerName: 'Fakhrul', amount: 10_000, occurredAt: new Date('2026-10-24T01:00:00Z'), note: null, runId: 'r1' }],
  repayments: [],
  checks: [],
};

check('the bank: opening + net sales + capital − stock − refunds − payouts − charges', () => {
  const b = computeBank(bankInput);
  // 1000 + 719 + 320 − 320 (refund) + 200 − 300 − 5 − 100
  eq(b.balance, 100_000 + 71_900 + 32_000 - 32_000 + 20_000 - 30_000 - 500 - 10_000);
});

check('the bank leaves out what never touched it', () => {
  const keys = computeBank(bankInput).movements.map((m) => m.key);
  eq(keys.includes('SALE:o_old'), false, 'paid before the bank started:');
  eq(keys.includes('SALE:o_btc'), false, 'crypto settles to a wallet:');
  eq(keys.includes('CAPITAL:f_cap'), false, 'capital moved at the cutover:');
  eq(keys.includes('EXPENSE:x2'), false, 'paid from a partner\'s own pocket:');
});

check('a period starts from the opening balance, which is not money in', () => {
  const b = computeBank(bankInput);
  const f = bankFlows(b.movements, null, null);
  eq(f.opening, 100_000);
  eq(f.closing, b.balance);
  eq(f.moneyIn, 71_900 + 32_000 + 20_000);
});

check('an order gets the split in effect when it was paid', () => {
  const rule = (id: string, from: string): SplitRule => ({ id, effectiveFrom: new Date(from), note: null, createdBy: null, createdAt: new Date(from), shares: [] });
  const rules = [rule('v2', '2026-10-31T16:00:00Z'), rule('v1', '1970-01-01T00:00:00Z')];
  eq(ruleAt(rules, new Date('2026-10-31T15:59:59Z'))?.id, 'v1', '31 Oct 23:59 MYT:');
  eq(ruleAt(rules, new Date('2026-10-31T16:00:00Z'))?.id, 'v2', '1 Nov 00:00 MYT:');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
