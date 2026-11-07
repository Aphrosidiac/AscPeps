/**
 * The Analytics page's sums (utils/analytics-model.ts, utils/forecast.ts).
 * Needs nothing: no database, no env. `npm run test:analytics`.
 */
import assert from 'node:assert/strict';
import { compoundMonthlyGrowth, forecastLanding, forecastMonthly } from '../src/utils/forecast.js';
import { computeAnalytics, mytParts, type AnalyticsOrder, type AnalyticsItem } from '../src/utils/analytics-model.js';
import { costOrder } from '../src/utils/profit.js';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

const item = (over: Partial<AnalyticsItem> = {}): AnalyticsItem => ({
  variantId: 'v1',
  quantity: 1,
  unitPrice: 10_000,
  unitCost: 4_000,
  parentItemId: null,
  variant: { code: 'RETA10', size: '10mg', product: { name: 'Retatrutide', addOnOnly: false } },
  ...over,
});

let serial = 0;
const order = (at: string, over: Partial<AnalyticsOrder> = {}): AnalyticsOrder => ({
  id: `o${++serial}`,
  customerName: 'Aina',
  phone: '0123456789',
  state: 'Selangor',
  createdAt: new Date(at),
  paidAt: new Date(at),
  shippedAt: null,
  deliveredAt: null,
  total: 10_000,
  discountAmount: 0,
  refundedAmount: 0,
  gatewayFee: 0,
  affiliateCommission: 0,
  stockRestored: false,
  status: 'CONFIRMED',
  paymentStatus: 'PAID',
  paymentMethod: 'BILLPLZ',
  paymentGateway: 'billplz',
  paymentFailureReason: null,
  isPreorder: false,
  groupBuyId: null,
  discountCode: null,
  affiliate: null,
  items: [item()],
  extraCosts: [],
  profitShares: [],
  ...over,
});

const NOW = new Date('2026-11-07T04:00:00Z'); // 12:00 MYT, 7 Nov
const report = (orders: AnalyticsOrder[], extra: { expenses?: Parameters<typeof computeAnalytics>[0]['expenses']; variants?: Parameters<typeof computeAnalytics>[0]['variants'] } = {}) =>
  computeAnalytics({ orders, expenses: extra.expenses ?? [], variants: extra.variants ?? [], now: NOW });

console.log('months');

test('an order at 23:30 UTC on the last of the month belongs to the next month in MYT', () => {
  assert.equal(mytParts(new Date('2026-09-30T23:30:00Z')).month, '2026-10');
  const r = report([order('2026-09-30T23:30:00Z')]);
  assert.deepEqual(r.months.map((m) => m.month), ['2026-11', '2026-10']);
  assert.equal(r.months[1].revenue, 10_000);
});

test('months run newest first and a month with no orders still appears', () => {
  const r = report([order('2026-08-10T04:00:00Z'), order('2026-10-10T04:00:00Z')]);
  assert.deepEqual(r.months.map((m) => m.month), ['2026-11', '2026-10', '2026-09', '2026-08']);
  assert.equal(r.months[2].orders.placed, 0);
});

test('revenue and profit are exactly what costOrder says', () => {
  const o = order('2026-10-10T04:00:00Z', { gatewayFee: 150, affiliateCommission: 500, extraCosts: [{ amount: 800 }] });
  const m = report([o]).months[1];
  const c = costOrder(o);
  assert.equal(m.revenue, c.revenue);
  assert.equal(m.pnl.contribution, c.profit);
  assert.equal(m.pnl.contribution, m.pnl.costedRevenue - m.pnl.itemCost - m.pnl.extraCost - m.pnl.gatewayFees - m.pnl.affiliateCommissions);
});

test('an uncosted order counts in revenue and is kept out of profit', () => {
  const m = report([order('2026-10-10T04:00:00Z'), order('2026-10-11T04:00:00Z', { items: [item({ unitCost: null })] })]).months[1];
  assert.equal(m.revenue, 20_000);
  assert.equal(m.pnl.costedRevenue, 10_000);
  assert.equal(m.pnl.uncostedOrders, 1);
  assert.equal(m.pnl.uncostedRevenue, 10_000);
  assert.equal(m.pnl.marginPct, 60);
});

test('a refund reverses revenue and keeps the order', () => {
  const m = report([order('2026-10-10T04:00:00Z', { paymentStatus: 'REFUNDED', refundedAmount: 4_000 })]).months[1];
  assert.equal(m.revenue, 6_000);
  assert.equal(m.refunded, 4_000);
  assert.equal(m.orders.paid, 1);
  assert.equal(m.orders.refunded, 1);
});

test('unpaid and failed orders never reach revenue', () => {
  const m = report([
    order('2026-10-10T04:00:00Z', { paymentStatus: 'UNPAID' }),
    order('2026-10-10T05:00:00Z', { paymentStatus: 'FAILED', paymentFailureReason: 'Declined' }),
  ]).months[1];
  assert.equal(m.revenue, 0);
  assert.equal(m.orders.placed, 2);
  assert.equal(m.orders.failed, 1);
  assert.deepEqual(m.failureReasons, [{ reason: 'Declined', count: 1 }]);
  assert.equal(m.payments[0].failed, 1);
  assert.equal(m.payments[0].orders, 0);
});

test('the running month compares against the same days last month, not all of it', () => {
  const r = report([
    order('2026-10-03T04:00:00Z'),
    order('2026-10-20T04:00:00Z', { total: 50_000 }),
    order('2026-11-03T04:00:00Z'),
  ]);
  assert.equal(r.months[0].partial, true);
  assert.equal(r.months[0].compare.revenue, 10_000);
  assert.equal(r.months[0].compare.sameDays, true);
  assert.equal(r.months[1].compare.sameDays, false);
});

test('included supplies are not sold products', () => {
  const m = report([order('2026-10-10T04:00:00Z', {
    items: [item(), item({ variantId: 'swab', parentItemId: 'x', unitPrice: 0, unitCost: null, variant: { code: 'SWAB', size: null, product: { name: 'Swab', addOnOnly: true } } })],
  })]).months[1];
  assert.equal(m.products.length, 1);
  assert.equal(m.units, 1);
});

test('operating spend reaches net, stock bought does not', () => {
  const m = report([order('2026-10-10T04:00:00Z')], {
    expenses: [
      { occurredAt: new Date('2026-10-05T04:00:00Z'), category: 'Marketing', amount: 1_000, kind: 'OPERATING' },
      { occurredAt: new Date('2026-10-05T04:00:00Z'), category: 'Stock', amount: 9_000, kind: 'INVENTORY' },
    ],
  }).months[1];
  assert.equal(m.pnl.operatingSpend, 1_000);
  assert.equal(m.pnl.inventoryBought, 9_000);
  assert.equal(m.pnl.netAfterSpend, 6_000 - 1_000);
  assert.equal(m.marketing.costPerNewCustomerCents, 1_000);
  assert.equal(m.marketing.returnOnSpend, 10);
});

console.log('periods');

const between = (orders: AnalyticsOrder[], from: string, to: string) =>
  computeAnalytics({ orders, expenses: [], variants: [], now: NOW, period: { from, to } });

test('any span reports its own days, against the same length before it', () => {
  const p = between([
    order('2026-10-22T04:00:00Z'),
    order('2026-10-29T04:00:00Z', { total: 30_000 }),
    order('2026-11-02T04:00:00Z', { total: 20_000 }),
  ], '2026-10-29', '2026-11-05').period!;
  assert.equal(p.revenue, 50_000);
  assert.equal(p.daily.length, 8);
  assert.equal(p.compare.label, 'previous 8 days');
  assert.equal(p.compare.revenue, 10_000);
  assert.equal(p.compare.sameDays, true);
});

test('the same order is in the right span at the MYT day boundary', () => {
  const late = order('2026-10-28T16:30:00Z'); // 00:30 on 29 Oct in Malaysia
  assert.equal(between([late], '2026-10-29', '2026-10-29').period!.orders.paid, 1);
  assert.equal(between([late], '2026-10-28', '2026-10-28').period!.orders.paid, 0);
});

test('a whole calendar month reads as that month', () => {
  const r = between([order('2026-09-10T04:00:00Z'), order('2026-10-10T04:00:00Z')], '2026-10-01', '2026-10-31');
  assert.equal(r.period!.month, '2026-10');
  assert.equal(r.period!.compare.label, 'September');
  assert.equal(r.period!.revenue, r.months.find((m) => m.month === '2026-10')!.revenue);
});

test('the running month reached by dates still compares like for like', () => {
  const p = between([order('2026-10-03T04:00:00Z'), order('2026-10-20T04:00:00Z'), order('2026-11-03T04:00:00Z')], '2026-11-01', '2026-11-30').period!;
  assert.equal(p.partial, true);
  assert.equal(p.compare.revenue, 10_000);
});

test('a span cannot run past today, and the product ranking follows it', () => {
  const r = between([order('2026-08-10T04:00:00Z'), order('2026-11-01T04:00:00Z')], '2026-08-01', '2026-08-31');
  assert.equal(r.products.window, 'August 2026');
  assert.equal(r.products.rows[0].units, 1);
  const future = between([], '2026-11-02', '2027-02-01').period!;
  assert.equal(future.to, '2026-11-07');
});

test('"all" starts at the first order, not at the date asked for', () => {
  const p = between([order('2026-09-10T04:00:00Z')], '2000-01-01', '2026-11-07').period!;
  assert.equal(p.from, '2026-09-10');
  assert.equal(p.daily.length, 59);
});

test('a span of several months is not mistaken for its first month', () => {
  const p = between([order('2026-08-10T04:00:00Z'), order('2026-10-10T04:00:00Z')], '2026-08-01', '2026-11-07').period!;
  assert.equal(p.revenue, 20_000);
  assert.equal(p.label, '1 Aug 2026 to 7 Nov 2026');
});

test('seven days that happen to start on the 1st stay seven days, against the seven before', () => {
  const p = between([order('2026-10-28T04:00:00Z'), order('2026-11-03T04:00:00Z')], '2026-11-01', '2026-11-07').period!;
  assert.equal(p.partial, false);
  assert.equal(p.compare.label, 'previous 7 days');
  assert.equal(p.compare.revenue, 10_000);
});

console.log('customers');

test('the same phone written two ways is one customer, returning the second month', () => {
  const r = report([order('2026-09-10T04:00:00Z', { phone: '+60 12-345 6789' }), order('2026-10-10T04:00:00Z', { phone: '0123456789' })]);
  assert.equal(r.customers.total, 1);
  assert.equal(r.customers.repeat, 1);
  const october = r.months.find((m) => m.month === '2026-10')!;
  assert.equal(october.customers.newBuyers, 0);
  assert.equal(october.customers.returningBuyers, 1);
  assert.equal(r.customers.medianGapDays, 30);
});

test('cohort retention reads month by month, and the running month stays blank', () => {
  const r = report([
    order('2026-09-10T04:00:00Z', { phone: '0111111111' }),
    order('2026-09-11T04:00:00Z', { phone: '0122222222' }),
    order('2026-10-10T04:00:00Z', { phone: '0111111111' }),
    order('2026-11-02T04:00:00Z', { phone: '0111111111' }),
  ]);
  assert.deepEqual(r.customers.cohorts[0].retention, [100, 50, null]);
});

test('segments cover every customer exactly once', () => {
  const r = report([
    order('2026-10-30T04:00:00Z', { phone: '0100000001' }),
    order('2026-08-20T04:00:00Z', { phone: '0100000002' }),
    order('2026-03-20T04:00:00Z', { phone: '0100000003' }),
    order('2026-03-20T04:00:00Z', { phone: '0100000004' }),
    order('2026-04-20T04:00:00Z', { phone: '0100000004' }),
  ]);
  const by = Object.fromEntries(r.customers.segments.map((s) => [s.key, s.customers]));
  assert.equal(by.new, 1);
  assert.equal(by.promising, 1);
  assert.equal(by.lapsed, 1);
  assert.equal(by.at_risk, 1);
  assert.equal(r.customers.segments.reduce((s, x) => s + x.customers, 0), r.customers.total);
  assert.equal(r.customers.atRisk.length, 1);
});

test('a repeat customer past their own gap is due to reorder', () => {
  const r = report([
    order('2026-08-08T04:00:00Z'),
    order('2026-09-07T04:00:00Z'),
    order('2026-10-07T04:00:00Z'),
  ]);
  assert.equal(r.customers.dueToReorder.length, 1);
  assert.equal(r.customers.dueToReorder[0].expectedGapDays, 30);
  assert.equal(r.customers.dueToReorder[0].basis, 'own');
});

test('a second order in the same period is returning revenue, even from a new customer', () => {
  const m = report([
    order('2026-10-02T04:00:00Z', { total: 10_000 }),
    order('2026-10-20T04:00:00Z', { total: 30_000 }),
    order('2026-10-21T04:00:00Z', { phone: '0177777777', total: 20_000 }),
  ]).months[1];
  assert.equal(m.customers.buyers, 2);
  assert.equal(m.customers.newBuyers, 2);
  assert.equal(m.customers.returningBuyers, 1);
  assert.equal(m.customers.newRevenue, 30_000);
  assert.equal(m.customers.returningRevenue, 30_000);
  assert.equal(m.customers.returningSharePct, 50);
});

test('a fully refunded order does not count as a buyer', () => {
  const m = report([order('2026-10-02T04:00:00Z', { paymentStatus: 'REFUNDED', refundedAmount: 10_000 })]).months[1];
  assert.equal(m.customers.buyers, 0);
  assert.equal(m.orders.paid, 1);
});

console.log('products and stock');

test('ABC: the product that crosses 80% is still an A', () => {
  const line = (id: string, revenue: number) => order('2026-10-20T04:00:00Z', {
    total: revenue,
    items: [item({ variantId: id, unitPrice: revenue, variant: { code: id, size: null, product: { name: id, addOnOnly: false } } })],
  });
  const r = report([line('a', 7_000), line('b', 2_000), line('c', 600), line('d', 400)]);
  assert.deepEqual(r.products.rows.map((p) => p.abc), ['A', 'A', 'B', 'C']);
});

test('stock cover reads demand from the last 60 days, group buys excluded', () => {
  const r = report(
    [
      order('2026-10-20T04:00:00Z', { items: [item({ quantity: 30 })] }),
      order('2026-10-21T04:00:00Z', { groupBuyId: 'gb1', items: [item({ quantity: 500 })] }),
    ],
    { variants: [{ id: 'v1', code: 'RETA10', size: '10mg', stock: 13, supplierCost: 3_000, product: { name: 'Retatrutide', addOnOnly: false } }] },
  );
  const row = r.products.stock[0];
  assert.equal(row.dailyDemand, 0.65);
  assert.equal(row.coverDays, 20);
  assert.equal(row.status, 'low');
  assert.equal(row.reorderUnits, 17); // 45 days × 0.65 = 29.25 → 30, less 13 on hand
  assert.equal(row.reorderCost, 17 * 4_000); // last paid cost beats the supplier list
  assert.equal(r.forecast.stockouts.length, 1);
});

test('stock nobody bought for 60 days is flagged, whatever its cover says', () => {
  const r = report([], { variants: [{ id: 'v9', code: 'X', size: null, stock: 40, supplierCost: 1_000, product: { name: 'X', addOnOnly: false } }] });
  assert.equal(r.products.stock[0].status, 'dead');
  assert.equal(r.products.stockValue, 40_000);
});

test('bought together needs two orders and reports lift', () => {
  const second = item({ variantId: 'v2', variant: { code: 'MOTS', size: null, product: { name: 'MOTS-C', addOnOnly: false } } });
  const r = report([order('2026-10-20T04:00:00Z', { items: [item(), second] }), order('2026-10-21T04:00:00Z', { items: [item(), second] })]);
  assert.equal(r.products.pairs[0].orders, 2);
  assert.equal(r.products.pairs[0].lift, 1);
});

console.log('forecast');

test('landing: same inputs give the same range, and it never falls below money already in', () => {
  const days = [0, 0, 5_000, 0, 12_000, 0, 3_000, 0, 0, 8_000];
  const a = forecastLanding(days, 20_000, 23)!;
  assert.deepEqual(a, forecastLanding(days, 20_000, 23));
  assert.ok(a.low >= 20_000);
  assert.ok(a.low <= a.expected && a.expected <= a.high);
});

test('landing: the mean of the simulation sits near the true rate', () => {
  const days = Array.from({ length: 56 }, (_, i) => (i % 2 ? 10_000 : 0));
  const a = forecastLanding(days, 0, 20)!;
  assert.ok(Math.abs(a.expected - 100_000) < 15_000, `got ${a.expected}`);
});

test('landing: too little history gives no forecast rather than a wild one', () => {
  assert.equal(forecastLanding([1_000, 2_000], 3_000, 20), null);
});

test('landing: a skewed month is forecast at its mean, not its median', () => {
  const days = new Array<number>(56).fill(0);
  days[50] = 700_000;
  const a = forecastLanding(days, 0, 23)!;
  assert.ok(a.expected > 100_000, `got ${a.expected}`);
  assert.ok(a.low <= a.expected && a.expected <= a.high);
});

test('a second order the same day is not a reorder gap', () => {
  const r = report([order('2026-10-10T04:00:00Z'), order('2026-10-10T06:00:00Z')]);
  assert.equal(r.customers.medianGapDays, null);
});

test('a finished month lands on what it took', () => {
  assert.deepEqual(forecastLanding(new Array(10).fill(1_000), 5_000, 0), { expected: 5_000, low: 5_000, high: 5_000 });
});

test('monthly: steady growth picks the trend and it stays damped', () => {
  const f = forecastMonthly([100, 200, 300, 400, 500, 600, 700, 800].map((v) => v * 100), 3)!;
  assert.equal(f.method, 'trend');
  assert.ok(f.points[0].expected > 80_000);
  assert.ok(f.points[2].expected < 110_000, `got ${f.points[2].expected}`);
  assert.ok(f.backtest && f.backtest.typicalMissPct < f.backtest.naiveMissPct);
});

test('monthly: a flat series does not invent growth', () => {
  const f = forecastMonthly(new Array(8).fill(50_000), 3)!;
  f.points.forEach((p) => assert.ok(Math.abs(p.expected - 50_000) < 1_000));
});

test('monthly: short history gives a wide range and no claimed accuracy', () => {
  const f = forecastMonthly([50_000, 60_000], 3)!;
  assert.equal(f.backtest, null);
  assert.ok(f.points[0].high / f.points[0].low > 2);
});

test('monthly: ranges widen further out', () => {
  const f = forecastMonthly([40, 90, 30, 120, 60, 100, 50, 110].map((v) => v * 1000), 3)!;
  const width = (i: number) => f.points[i].high - f.points[i].low;
  assert.ok(width(2) > width(0));
});

test('compound growth: doubling twice over 2 steps is 100% a month', () => {
  assert.equal(compoundMonthlyGrowth([100, 200, 400]), 100);
  assert.equal(compoundMonthlyGrowth([0, 200]), null);
});

test('break-even: spend over margin', () => {
  const r = report(
    [order('2026-09-10T04:00:00Z'), order('2026-10-10T04:00:00Z'), order('2026-10-20T04:00:00Z')],
    { expenses: [{ occurredAt: new Date('2026-10-05T04:00:00Z'), category: 'Rent', amount: 6_000, kind: 'OPERATING' }] },
  );
  assert.equal(r.forecast.marginPct, 60);
  assert.equal(r.forecast.monthlySpend, 3_000); // 2 complete months, 1 of them with spend
  assert.equal(r.forecast.breakEven?.revenue, 5_000);
});

test('an empty store reports cleanly', () => {
  const r = report([]);
  assert.equal(r.months.length, 1);
  assert.equal(r.forecast.monthly, null);
  assert.equal(r.forecast.landing, null);
  assert.equal(r.customers.ltv12, null);
});

console.log(`\n${passed} passed`);
