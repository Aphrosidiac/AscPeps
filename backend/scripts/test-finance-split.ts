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

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
