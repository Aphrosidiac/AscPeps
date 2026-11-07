import { costOrder, allocate, type OrderCosting } from './profit.js';
import { isIncludedItem } from './order-lines.js';
import { normalizePhone } from './phone.js';
import { getVariantDisplayName } from './product-addons.js';
import {
  compoundMonthlyGrowth,
  forecastLanding,
  forecastMonthly,
  median,
  type Backtest,
  type Range,
} from './forecast.js';

/**
 * Everything the Analytics page shows, worked out from plain rows so it can be
 * tested without a database (scripts/test-analytics.ts). The controller only
 * loads the rows.
 *
 * The rules are the books' rules, unchanged (docs/bookkeeping.md):
 * - A month is a Malaysian calendar month; an order belongs to the month it was
 *   placed in, the same as the month-end wrap.
 * - "Money in" is PAID or REFUNDED, and every figure comes from costOrder, so a
 *   month here cannot disagree with Money or with the wrap.
 * - Profit is only known on fully costed orders. Margin is measured against
 *   those orders' own revenue, and what is not costed is shown, never guessed.
 */

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia has no DST
const DAY_MS = 86_400_000;

export type MonthKey = string; // YYYY-MM

interface MytParts {
  month: MonthKey;
  day: string;
  dayOfMonth: number;
  /** 0 = Monday. */
  weekday: number;
  hour: number;
}

export function mytParts(date: Date): MytParts {
  const d = new Date(date.getTime() + MYT_OFFSET_MS);
  const iso = d.toISOString();
  return {
    month: iso.slice(0, 7),
    day: iso.slice(0, 10),
    dayOfMonth: d.getUTCDate(),
    weekday: (d.getUTCDay() + 6) % 7,
    hour: d.getUTCHours(),
  };
}

export function shiftMonth(month: MonthKey, by: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Plain YYYY-MM-DD arithmetic: these are Malaysian calendar days, not instants. */
function addDays(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthName(month: MonthKey): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

export function monthLabel(month: MonthKey): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

function shortDay(day: string): string {
  return `${Number(day.slice(8))} ${monthName(day.slice(0, 7)).slice(0, 3)} ${day.slice(0, 4)}`;
}

/* ---------- Periods ---------- */

export interface PeriodSpec {
  key: string;
  label: string;
  from: string;
  to: string;
  /** A calendar month still running. */
  partial: boolean;
  /** The stretch before, for the pace line. */
  paceFrom: string;
  paceTo: string;
  /** Where the like-for-like comparison stops inside that stretch. */
  compareTo: string;
  compareLabel: string;
  sameDays: boolean;
}

function monthSpec(month: MonthKey, today: MytParts): PeriodSpec {
  const partial = month === today.month;
  const before = shiftMonth(month, -1);
  const paceFrom = `${before}-01`;
  const paceTo = addDays(paceFrom, daysInMonth(before) - 1);
  const elapsed = partial ? today.dayOfMonth : daysInMonth(month);
  const lined = addDays(paceFrom, elapsed - 1);
  return {
    key: month,
    label: monthLabel(month),
    from: `${month}-01`,
    to: addDays(`${month}-01`, daysInMonth(month) - 1),
    partial,
    paceFrom,
    paceTo,
    compareTo: partial && lined < paceTo ? lined : paceTo,
    compareLabel: partial ? `first ${elapsed} days of ${monthName(before)}` : monthName(before),
    sameDays: partial,
  };
}

/** Any span of days. A whole calendar month reads as that month, with its own comparison. */
export function periodSpec(from: string, to: string, today: MytParts): PeriodSpec {
  const end = to > today.day ? today.day : to;
  const month = from.slice(0, 7);
  const monthEnd = addDays(`${month}-01`, daysInMonth(month) - 1);
  if (from === `${month}-01` && to === monthEnd) return monthSpec(month, today);

  const length = dayDiff(from, end) + 1;
  const paceTo = addDays(from, -1);
  return {
    key: `${from}..${end}`,
    label: `${shortDay(from)} to ${shortDay(end)}`,
    from,
    to: end,
    partial: false,
    paceFrom: addDays(from, -length),
    paceTo,
    compareTo: paceTo,
    compareLabel: `previous ${length} days`,
    sameDays: true,
  };
}

/* ---------- Input ---------- */

export interface AnalyticsItem {
  variantId: string;
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  parentItemId: string | null;
  variant: { code: string; size: string | null; product: { name: string; addOnOnly: boolean } };
}

export interface AnalyticsOrder {
  id: string;
  customerName: string;
  phone: string;
  state: string;
  createdAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  total: number;
  discountAmount: number;
  refundedAmount: number;
  gatewayFee: number;
  affiliateCommission: number;
  stockRestored: boolean;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentGateway: string | null;
  paymentFailureReason: string | null;
  isPreorder: boolean;
  groupBuyId: string | null;
  discountCode: { code: string } | null;
  affiliate: { fullName: string } | null;
  items: AnalyticsItem[];
  extraCosts: { amount: number }[];
  profitShares: { name: string; shareBps: number; partnerId: string | null; partner: { name: string; kind: string } | null }[];
}

export interface AnalyticsExpense {
  occurredAt: Date;
  category: string;
  amount: number;
  kind: string;
}

export interface AnalyticsVariant {
  id: string;
  code: string;
  size: string | null;
  stock: number;
  /** Cheapest supplier price, when one is on file. */
  supplierCost: number | null;
  product: { name: string; addOnOnly: boolean };
}

export interface AnalyticsInput {
  orders: AnalyticsOrder[];
  expenses: AnalyticsExpense[];
  variants: AnalyticsVariant[];
  now: Date;
  /** A span to report on, YYYY-MM-DD in Malaysian time. Also sets the product ranking's window. */
  period?: { from: string; to: string };
}

/* ---------- Output ---------- */

export interface Comparable {
  label: string;
  /** Like for like: the same number of days when the month is still running. */
  sameDays: boolean;
  revenue: number;
  paidOrders: number;
  avgOrder: number;
  margin: number | null;
  units: number;
  buyers: number;
}

export interface MonthProduct {
  variantId: string;
  name: string;
  code: string;
  units: number;
  revenue: number;
  sharePct: number;
  /** Null until a line of it is costed. */
  marginPct: number | null;
  profit: number | null;
  previousRevenue: number;
  previousUnits: number;
}

export interface Slice {
  key: string;
  orders: number;
  revenue: number;
}

export interface MonthReport {
  /** The month, or from..to for any other span. */
  month: string;
  from: string;
  to: string;
  label: string;
  partial: boolean;
  daysElapsed: number;
  daysInMonth: number;
  orders: { placed: number; paid: number; unpaid: number; failed: number; cancelled: number; refunded: number; paidPct: number };
  revenue: number;
  refunded: number;
  discounts: number;
  avgOrder: number;
  units: number;
  unitsPerOrder: number;
  compare: Comparable;
  pnl: {
    costedRevenue: number;
    costedOrders: number;
    uncostedOrders: number;
    uncostedRevenue: number;
    itemCost: number;
    extraCost: number;
    gatewayFees: number;
    affiliateCommissions: number;
    contribution: number;
    marginPct: number | null;
    operatingSpend: number;
    spendByCategory: { category: string; amount: number }[];
    inventoryBought: number;
    netAfterSpend: number;
  };
  daily: { date: string; revenue: number; orders: number; paidOrders: number; costedRevenue: number; profit: number }[];
  previousDaily: number[];
  products: MonthProduct[];
  customers: {
    buyers: number;
    newBuyers: number;
    returningBuyers: number;
    newRevenue: number;
    returningRevenue: number;
    returningSharePct: number;
    top: { name: string; orders: number; revenue: number; isNew: boolean; lifetimeRevenue: number }[];
  };
  marketing: { spend: number; costPerNewCustomerCents: number | null; returnOnSpend: number | null };
  payments: (Slice & { fees: number; failed: number })[];
  orderTypes: Slice[];
  discountCodes: (Slice & { amount: number })[];
  affiliates: (Slice & { commission: number })[];
  states: Slice[];
  byWeekday: { orders: number; revenue: number }[];
  byHour: number[];
  fulfilment: { paidToShippedHours: number | null; shippedToDeliveredDays: number | null; shipped: number; delivered: number; waitingToShip: number };
  failureReasons: { reason: string; count: number }[];
  profitShare: { name: string; company: boolean; amount: number }[];
}

export interface CohortRow {
  month: MonthKey;
  label: string;
  size: number;
  revenue: number;
  /** Percent of the cohort that bought in month 0, 1, 2…; null where that month is unfinished. */
  retention: (number | null)[];
}

export type SegmentKey = 'champions' | 'loyal' | 'new' | 'promising' | 'at_risk' | 'lapsed';

export interface Segment {
  key: SegmentKey;
  label: string;
  rule: string;
  customers: number;
  revenue: number;
  avgSpend: number;
  sharePct: number;
}

export interface CustomerContact {
  name: string;
  phone: string;
  orders: number;
  spent: number;
  lastOrder: string;
  daysSince: number;
  /** The gap this customer's next order is expected after. */
  expectedGapDays?: number;
  basis?: 'own' | 'store';
}

export interface ProductRow {
  variantId: string;
  name: string;
  code: string;
  units: number;
  revenue: number;
  marginPct: number | null;
  sharePct: number;
  cumulativePct: number;
  abc: 'A' | 'B' | 'C';
  /** Units in the last 30 days against the 30 before. */
  units30: number;
  unitsPrior30: number;
}

export type StockStatus = 'out' | 'critical' | 'low' | 'healthy' | 'overstock' | 'dead';

export interface StockRow {
  variantId: string;
  name: string;
  code: string;
  supply: boolean;
  stock: number;
  dailyDemand: number;
  coverDays: number | null;
  stockoutOn: string | null;
  reorderUnits: number;
  reorderCost: number | null;
  stockValue: number | null;
  status: StockStatus;
}

export interface AnalyticsReport {
  generatedAt: string;
  currentMonth: MonthKey;
  /** Newest first. */
  months: MonthReport[];
  /** The span asked for, when one was. */
  period: MonthReport | null;
  customers: {
    total: number;
    repeat: number;
    repeatRatePct: number;
    ordersPerCustomer: number;
    avgLifetimeSpend: number;
    medianGapDays: number | null;
    ltv12: { revenue: number; contribution: number | null; ordersPerMonth: number } | null;
    cohorts: CohortRow[];
    segments: Segment[];
    dueToReorder: CustomerContact[];
    atRisk: CustomerContact[];
  };
  products: {
    window: string;
    rows: ProductRow[];
    pairs: { a: string; b: string; orders: number; lift: number }[];
    stock: StockRow[];
    stockValue: number;
    uncostedStockLines: number;
    targetCoverDays: number;
  };
  forecast: {
    landing: (Range & { month: MonthKey; label: string; toDate: number; daysElapsed: number; daysLeft: number; previousLabel: string; previousTotal: number }) | null;
    monthly: {
      method: string;
      methodLabel: string;
      backtest: Backtest | null;
      basedOn: number;
      points: (Range & { month: MonthKey; label: string; contribution: number | null; net: number | null })[];
    } | null;
    dailyRunRate: number;
    annualRunRate: number;
    growth3: number | null;
    growth6: number | null;
    marginPct: number | null;
    avgOrder: number;
    ordersPerMonth: number;
    monthlySpend: number;
    breakEven: { revenue: number; orders: number } | null;
    stockouts: StockRow[];
  };
}

/* ---------- Helpers ---------- */

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

function slices<T extends Slice>(map: Map<string, T>, limit = Infinity): T[] {
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders).slice(0, limit);
}

interface Row {
  order: AnalyticsOrder;
  at: MytParts;
  costing: OrderCosting;
  moneyIn: boolean;
  bought: boolean;
  customer: string;
  firstPurchase: boolean;
}

interface Window {
  revenue: number;
  paidOrders: number;
  costedRevenue: number;
  contribution: number;
  units: number;
  buyers: Set<string>;
}

function windowOf(rows: readonly Row[], upToDay: string): Window {
  const out: Window = { revenue: 0, paidOrders: 0, costedRevenue: 0, contribution: 0, units: 0, buyers: new Set() };
  for (const r of rows) {
    if (!r.moneyIn || r.at.day > upToDay) continue;
    out.revenue += r.costing.revenue;
    out.paidOrders++;
    out.buyers.add(r.customer);
    if (r.costing.profit !== null) {
      out.costedRevenue += r.costing.revenue;
      out.contribution += r.costing.profit;
    }
    if (r.order.paymentStatus === 'PAID') for (const i of r.order.items) if (!isIncludedItem(i)) out.units += i.quantity;
  }
  return out;
}

const MARKETING_CATEGORY = /market|\bads?\b|advert|promo|influenc|meta|facebook|instagram|tiktok|google/i;

function buildPeriod(spec: PeriodSpec, rows: readonly Row[], previous: readonly Row[], expenses: readonly AnalyticsExpense[], lifetime: Map<string, number>, today: MytParts): MonthReport {
  const total = dayDiff(spec.from, spec.to) + 1;
  const daysElapsed = dayDiff(spec.from, spec.to < today.day ? spec.to : today.day) + 1;

  const orders = { placed: rows.length, paid: 0, unpaid: 0, failed: 0, cancelled: 0, refunded: 0, paidPct: 0 };
  const pnl = { costedRevenue: 0, costedOrders: 0, uncostedOrders: 0, uncostedRevenue: 0, itemCost: 0, extraCost: 0, gatewayFees: 0, affiliateCommissions: 0, contribution: 0 };
  let revenue = 0;
  let refunded = 0;
  let discounts = 0;
  let units = 0;

  const daily = Array.from({ length: total }, (_, i) => ({
    date: addDays(spec.from, i),
    revenue: 0,
    orders: 0,
    paidOrders: 0,
    costedRevenue: 0,
    profit: 0,
  }));
  const products = new Map<string, MonthProduct & { costedRevenue: number; lineCost: number }>();
  const buyers = new Map<string, { name: string; orders: number; revenue: number; isNew: boolean }>();
  const payments = new Map<string, Slice & { fees: number; failed: number }>();
  const orderTypes = new Map<string, Slice>();
  const codes = new Map<string, Slice & { amount: number }>();
  const affiliates = new Map<string, Slice & { commission: number }>();
  const states = new Map<string, Slice>();
  const byWeekday = Array.from({ length: 7 }, () => ({ orders: 0, revenue: 0 }));
  const byHour = new Array<number>(24).fill(0);
  const reasons = new Map<string, number>();
  const shares = new Map<string, { name: string; company: boolean; amount: number }>();
  const shipHours: number[] = [];
  const deliverDays: number[] = [];
  let shipped = 0;
  let delivered = 0;
  let waitingToShip = 0;

  const bump = <T extends Slice>(map: Map<string, T>, key: string, revenueIn: number, extra: Omit<T, keyof Slice>): T => {
    const cur = map.get(key) ?? ({ key, orders: 0, revenue: 0, ...extra } as unknown as T);
    cur.orders++;
    cur.revenue += revenueIn;
    map.set(key, cur);
    return cur;
  };

  for (const r of rows) {
    const { order: o, costing: c } = r;
    const method = o.paymentGateway || o.paymentMethod;
    const day = daily[dayDiff(spec.from, r.at.day)];
    day.orders++;

    if (o.paymentStatus === 'FAILED') {
      orders.failed++;
      // Counted on the lane without counting as a paid order on it.
      const lane = bump(payments, method, 0, { fees: 0, failed: 0 });
      lane.failed++;
      lane.orders--;
      const reason = (o.paymentFailureReason ?? '').trim() || 'No reason given';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    } else if (o.status === 'CANCELLED') orders.cancelled++;
    else if (o.paymentStatus === 'UNPAID') orders.unpaid++;
    if (o.paymentStatus === 'REFUNDED' || o.refundedAmount > 0) orders.refunded++;

    if (!r.moneyIn) continue;
    orders.paid++;
    revenue += c.revenue;
    refunded += c.refunded;
    discounts += o.discountAmount;
    day.revenue += c.revenue;
    day.paidOrders++;

    byWeekday[r.at.weekday].orders++;
    byWeekday[r.at.weekday].revenue += c.revenue;
    byHour[r.at.hour]++;

    bump(payments, method, c.revenue, { fees: 0, failed: 0 }).fees += c.gatewayFee;
    bump(orderTypes, o.groupBuyId ? 'GROUP_BUY' : o.isPreorder ? 'PRE_ORDER' : 'ORDER', c.revenue, {});
    bump(states, o.state.trim() || 'Unknown', c.revenue, {});
    if (o.discountAmount > 0) bump(codes, o.discountCode?.code ?? 'Keyed by hand', c.revenue, { amount: 0 }).amount += o.discountAmount;
    if (o.affiliate) bump(affiliates, o.affiliate.fullName, c.revenue, { commission: 0 }).commission += c.affiliateCommission;

    const buyer = buyers.get(r.customer) ?? { name: o.customerName, orders: 0, revenue: 0, isNew: false };
    buyer.orders++;
    buyer.revenue += c.revenue;
    buyer.isNew = buyer.isNew || r.firstPurchase;
    buyers.set(r.customer, buyer);

    if (o.status === 'SHIPPED' || o.status === 'DELIVERED') shipped++;
    if (o.status === 'DELIVERED') delivered++;
    if ((o.status === 'PENDING' || o.status === 'CONFIRMED') && o.paymentStatus === 'PAID') waitingToShip++;
    if (o.shippedAt) shipHours.push(Math.max(0, o.shippedAt.getTime() - (o.paidAt ?? o.createdAt).getTime()) / 3_600_000);
    if (o.shippedAt && o.deliveredAt) deliverDays.push(Math.max(0, o.deliveredAt.getTime() - o.shippedAt.getTime()) / DAY_MS);

    if (o.paymentStatus === 'PAID') {
      for (const item of o.items) {
        if (isIncludedItem(item)) continue;
        units += item.quantity;
        const lineRevenue = item.unitPrice * item.quantity;
        const cur = products.get(item.variantId) ?? {
          variantId: item.variantId,
          name: getVariantDisplayName(item.variant.product, item.variant),
          code: item.variant.code,
          units: 0, revenue: 0, sharePct: 0, marginPct: null, profit: null, previousRevenue: 0, previousUnits: 0,
          costedRevenue: 0, lineCost: 0,
        };
        cur.units += item.quantity;
        cur.revenue += lineRevenue;
        if (item.unitCost !== null) {
          cur.costedRevenue += lineRevenue;
          cur.lineCost += item.unitCost * item.quantity;
        }
        products.set(item.variantId, cur);
      }
    }

    if (c.profit === null) {
      pnl.uncostedOrders++;
      pnl.uncostedRevenue += c.revenue;
      continue;
    }
    pnl.costedOrders++;
    pnl.costedRevenue += c.revenue;
    pnl.itemCost += c.itemCost;
    pnl.extraCost += c.extraCost;
    pnl.gatewayFees += c.gatewayFee;
    pnl.affiliateCommissions += c.affiliateCommission;
    pnl.contribution += c.profit;
    day.costedRevenue += c.revenue;
    day.profit += c.profit;

    if (o.profitShares.length > 0) {
      const amounts = allocate(c.profit, o.profitShares.map((s) => s.shareBps));
      o.profitShares.forEach((share, i) => {
        const key = share.partnerId ?? `name:${share.name}`;
        const cur = shares.get(key) ?? { name: share.partner?.name ?? share.name, company: share.partner?.kind === 'COMPANY', amount: 0 };
        cur.amount += amounts[i];
        shares.set(key, cur);
      });
    }
  }

  orders.paidPct = pct(orders.paid, orders.placed);

  for (const r of previous) {
    if (r.order.paymentStatus !== 'PAID') continue;
    if (r.at.day > spec.compareTo) continue;
    for (const item of r.order.items) {
      if (isIncludedItem(item)) continue;
      const cur = products.get(item.variantId);
      if (!cur) continue;
      cur.previousRevenue += item.unitPrice * item.quantity;
      cur.previousUnits += item.quantity;
    }
  }

  const productRows: MonthProduct[] = [...products.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .map(({ costedRevenue, lineCost, ...p }) => ({
      ...p,
      sharePct: pct(p.revenue, [...products.values()].reduce((s, x) => s + x.revenue, 0)),
      marginPct: costedRevenue > 0 ? pct(costedRevenue - lineCost, costedRevenue) : null,
      profit: costedRevenue > 0 ? costedRevenue - lineCost : null,
    }));

  let operatingSpend = 0;
  let inventoryBought = 0;
  const spendMap = new Map<string, number>();
  for (const e of expenses) {
    if (e.kind === 'INVENTORY') {
      inventoryBought += e.amount;
      continue;
    }
    operatingSpend += e.amount;
    spendMap.set(e.category, (spendMap.get(e.category) ?? 0) + e.amount);
  }
  const marketingSpend = [...spendMap.entries()].filter(([k]) => MARKETING_CATEGORY.test(k)).reduce((s, [, v]) => s + v, 0);

  const buyerList = [...buyers.entries()];
  const newBuyers = buyerList.filter(([, b]) => b.isNew);
  const newRevenue = newBuyers.reduce((s, [, b]) => s + b.revenue, 0);

  const prior = windowOf(previous, spec.compareTo);
  const marginPct = pnl.costedRevenue > 0 ? pct(pnl.contribution, pnl.costedRevenue) : null;

  const previousDaily = new Array<number>(dayDiff(spec.paceFrom, spec.paceTo) + 1).fill(0);
  for (const r of previous) if (r.moneyIn) previousDaily[dayDiff(spec.paceFrom, r.at.day)] += r.costing.revenue;

  return {
    month: spec.key,
    from: spec.from,
    to: spec.to,
    label: spec.label,
    partial: spec.partial,
    daysElapsed,
    daysInMonth: total,
    orders,
    revenue,
    refunded,
    discounts,
    avgOrder: orders.paid ? Math.round(revenue / orders.paid) : 0,
    units,
    unitsPerOrder: orders.paid ? Math.round((units / orders.paid) * 100) / 100 : 0,
    compare: {
      label: spec.compareLabel,
      sameDays: spec.sameDays,
      revenue: prior.revenue,
      paidOrders: prior.paidOrders,
      avgOrder: prior.paidOrders ? Math.round(prior.revenue / prior.paidOrders) : 0,
      margin: prior.costedRevenue > 0 ? pct(prior.contribution, prior.costedRevenue) : null,
      units: prior.units,
      buyers: prior.buyers.size,
    },
    pnl: {
      ...pnl,
      marginPct,
      operatingSpend,
      spendByCategory: [...spendMap.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
      inventoryBought,
      netAfterSpend: pnl.contribution - operatingSpend,
    },
    daily,
    previousDaily,
    products: productRows,
    customers: {
      buyers: buyers.size,
      newBuyers: newBuyers.length,
      returningBuyers: buyers.size - newBuyers.length,
      newRevenue,
      returningRevenue: revenue - newRevenue,
      returningSharePct: pct(revenue - newRevenue, revenue),
      top: buyerList
        .map(([key, b]) => ({ name: b.name, orders: b.orders, revenue: b.revenue, isNew: b.isNew, lifetimeRevenue: lifetime.get(key) ?? b.revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8),
    },
    marketing: {
      spend: marketingSpend,
      costPerNewCustomerCents: marketingSpend > 0 && newBuyers.length > 0 ? Math.round(marketingSpend / newBuyers.length) : null,
      returnOnSpend: marketingSpend > 0 ? Math.round((revenue / marketingSpend) * 10) / 10 : null,
    },
    payments: slices(payments),
    orderTypes: slices(orderTypes),
    discountCodes: slices(codes, 8),
    affiliates: slices(affiliates, 8),
    states: slices(states, 8),
    byWeekday,
    byHour,
    fulfilment: {
      paidToShippedHours: shipHours.length ? Math.round(median(shipHours) * 10) / 10 : null,
      shippedToDeliveredDays: deliverDays.length ? Math.round(median(deliverDays) * 10) / 10 : null,
      shipped,
      delivered,
      waitingToShip,
    },
    failureReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    profitShare: [...shares.values()].sort((a, b) => Number(a.company) - Number(b.company) || b.amount - a.amount),
  };
}

/* ---------- Customers ---------- */

interface Customer {
  key: string;
  name: string;
  phone: string;
  purchases: Date[];
  months: Set<MonthKey>;
  revenue: number;
}

function retentionCohorts(customers: readonly Customer[], current: MonthKey): CohortRow[] {
  const byCohort = new Map<MonthKey, Customer[]>();
  for (const c of customers) {
    const key = mytParts(c.purchases[0]).month;
    byCohort.set(key, [...(byCohort.get(key) ?? []), c]);
  }
  return [...byCohort.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-12)
    .map(([month, members]) => {
      const retention: (number | null)[] = [];
      for (let offset = 0; ; offset++) {
        const target = shiftMonth(month, offset);
        if (target > current) break;
        const active = members.filter((c) => c.months.has(target)).length;
        // The running month can only ever understate retention, so it is left blank.
        retention.push(target === current && offset > 0 ? null : pct(active, members.length));
      }
      return { month, label: monthLabel(month), size: members.length, revenue: members.reduce((s, c) => s + c.revenue, 0), retention };
    });
}

/**
 * RFM by plain rules rather than quintiles. Quintiles need a spread of
 * frequencies to split, and at this size most customers have bought once, so
 * five equal buckets of "1 order" would mean nothing.
 */
const SEGMENTS: { key: SegmentKey; label: string; rule: string; test: (days: number, orders: number) => boolean }[] = [
  { key: 'champions', label: 'Champions', rule: '3+ orders, bought in the last 60 days', test: (d, o) => o >= 3 && d <= 60 },
  { key: 'loyal', label: 'Loyal', rule: '2+ orders, bought in the last 90 days', test: (d, o) => o >= 2 && d <= 90 },
  { key: 'new', label: 'New', rule: 'First order in the last 30 days', test: (d, o) => o === 1 && d <= 30 },
  { key: 'promising', label: 'Promising', rule: 'One order, 31 to 90 days ago', test: (d, o) => o === 1 && d <= 90 },
  { key: 'at_risk', label: 'At risk', rule: '2+ orders, nothing for over 90 days', test: (_, o) => o >= 2 },
  { key: 'lapsed', label: 'Lapsed', rule: 'One order, over 90 days ago', test: () => true },
];

/* ---------- The report ---------- */

const TARGET_COVER_DAYS = 45;
const DEMAND_WINDOW_DAYS = 60;
const PRODUCT_WINDOW_DAYS = 90;

export function computeAnalytics({ orders, expenses, variants, now, period }: AnalyticsInput): AnalyticsReport {
  const today = mytParts(now);
  const sorted = [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seen = new Set<string>();
  const customerMap = new Map<string, Customer>();

  const rows: Row[] = sorted.map((order) => {
    const costing = costOrder(order);
    const moneyIn = order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED';
    const bought = moneyIn && costing.revenue > 0;
    const customer = normalizePhone(order.phone);
    const firstPurchase = bought && !seen.has(customer);
    if (bought) {
      seen.add(customer);
      const c = customerMap.get(customer) ?? { key: customer, name: order.customerName, phone: order.phone, purchases: [], months: new Set<MonthKey>(), revenue: 0 };
      c.name = order.customerName;
      c.purchases.push(order.createdAt);
      c.months.add(mytParts(order.createdAt).month);
      c.revenue += costing.revenue;
      customerMap.set(customer, c);
    }
    return { order, at: mytParts(order.createdAt), costing, moneyIn, bought, customer, firstPurchase };
  });

  const byMonth = new Map<MonthKey, Row[]>();
  for (const r of rows) byMonth.set(r.at.month, [...(byMonth.get(r.at.month) ?? []), r]);
  const spendByMonth = new Map<MonthKey, AnalyticsExpense[]>();
  for (const e of expenses) {
    const key = mytParts(e.occurredAt).month;
    spendByMonth.set(key, [...(spendByMonth.get(key) ?? []), e]);
  }

  const customers = [...customerMap.values()];
  const lifetime = new Map(customers.map((c) => [c.key, c.revenue]));
  const firstMonth = rows[0]?.at.month ?? today.month;

  const monthKeys: MonthKey[] = [];
  for (let m = firstMonth; m <= today.month; m = shiftMonth(m, 1)) monthKeys.push(m);
  const months = monthKeys
    .map((m) => buildPeriod(monthSpec(m, today), byMonth.get(m) ?? [], byMonth.get(shiftMonth(m, -1)) ?? [], spendByMonth.get(m) ?? [], lifetime, today))
    .reverse();

  // "All" arrives as a date before the store existed, so start at the first order.
  // Compared by month: picking the store's first month must still read as that month.
  const firstDay = rows[0]?.at.day ?? today.day;
  const spec = period ? periodSpec(period.from.slice(0, 7) < firstDay.slice(0, 7) ? firstDay : period.from, period.to, today) : null;
  const between = (day: string, from: string, to: string) => day >= from && day <= to;
  const periodReport = spec
    ? buildPeriod(
        spec,
        rows.filter((r) => between(r.at.day, spec.from, spec.to)),
        rows.filter((r) => between(r.at.day, spec.paceFrom, spec.paceTo)),
        expenses.filter((e) => between(mytParts(e.occurredAt).day, spec.from, spec.to)),
        lifetime,
        today,
      )
    : null;

  /* ----- Trailing rates ----- */
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const trailing = rows.filter((r) => r.moneyIn && r.order.createdAt >= since(PRODUCT_WINDOW_DAYS));
  const trailingCosted = trailing.filter((r) => r.costing.profit !== null);
  const trailingCostedRevenue = trailingCosted.reduce((s, r) => s + r.costing.revenue, 0);
  const trailingContribution = trailingCosted.reduce((s, r) => s + (r.costing.profit ?? 0), 0);
  const marginPct = trailingCostedRevenue > 0 ? pct(trailingContribution, trailingCostedRevenue) : null;
  const avgOrder = trailing.length ? Math.round(trailing.reduce((s, r) => s + r.costing.revenue, 0) / trailing.length) : 0;

  const completeMonths = months.filter((m) => !m.partial).reverse(); // oldest first
  // A store's first month is a part month unless its first order was in the first days.
  const firstIsPartial = rows.length > 0 && rows[0].at.dayOfMonth > 3;
  const fitMonths = firstIsPartial ? completeMonths.slice(1) : completeMonths;
  const lastThree = completeMonths.slice(-3);
  const monthlySpend = lastThree.length ? Math.round(lastThree.reduce((s, m) => s + m.pnl.operatingSpend, 0) / lastThree.length) : 0;

  /* ----- Landing ----- */
  const dailyHistory: number[] = [];
  const revenueByDay = new Map<string, number>();
  for (const r of rows) if (r.moneyIn) revenueByDay.set(r.at.day, (revenueByDay.get(r.at.day) ?? 0) + r.costing.revenue);
  const firstOrderAt = rows[0]?.order.createdAt.getTime() ?? now.getTime();
  for (let back = 56; back >= 1; back--) {
    const at = new Date(now.getTime() - back * DAY_MS);
    if (at.getTime() < firstOrderAt) continue;
    dailyHistory.push(revenueByDay.get(mytParts(at).day) ?? 0);
  }
  const dailyRunRate = dailyHistory.length ? Math.round(dailyHistory.slice(-28).reduce((a, b) => a + b, 0) / Math.min(28, dailyHistory.length)) : 0;

  const running = months.find((m) => m.partial) ?? null;
  const landingRange = running ? forecastLanding(dailyHistory, running.revenue, running.daysInMonth - running.daysElapsed) : null;
  const previousMonth = running ? months.find((m) => m.month === shiftMonth(running.month, -1)) : undefined;
  const landing: AnalyticsReport['forecast']['landing'] =
    running && landingRange
      ? {
          ...landingRange,
          month: running.month,
          label: running.label,
          toDate: running.revenue,
          daysElapsed: running.daysElapsed,
          daysLeft: running.daysInMonth - running.daysElapsed,
          previousLabel: previousMonth?.label ?? monthLabel(shiftMonth(running.month, -1)),
          previousTotal: previousMonth?.revenue ?? 0,
        }
      : null;

  /* ----- Next months ----- */
  const history = fitMonths.map((m) => m.revenue);
  if (landing) history.push(landing.expected);
  const fit = forecastMonthly(history, 3);
  const lastFitted = landing ? landing.month : today.month > (fitMonths.at(-1)?.month ?? today.month) ? shiftMonth(today.month, -1) : today.month;
  const monthly: AnalyticsReport['forecast']['monthly'] = fit
    ? {
        method: fit.method,
        methodLabel: fit.methodLabel,
        backtest: fit.backtest,
        basedOn: history.length,
        points: fit.points.map((point, i) => {
          const month = shiftMonth(lastFitted, i + 1);
          const contribution = marginPct === null ? null : Math.round(point.expected * (marginPct / 100));
          return { ...point, month, label: monthLabel(month), contribution, net: contribution === null ? null : contribution - monthlySpend };
        }),
      }
    : null;

  /* ----- Customers ----- */
  const gaps: number[] = [];
  const secondOrderGaps: number[] = [];
  for (const c of customers) {
    for (let i = 1; i < c.purchases.length; i++) {
      const gap = (c.purchases[i].getTime() - c.purchases[i - 1].getTime()) / DAY_MS;
      // A second order the same day is a top-up, not a return visit.
      if (gap < 1) continue;
      gaps.push(gap);
      if (i === 1) secondOrderGaps.push(gap);
    }
  }
  const storeGap = secondOrderGaps.length >= 5 ? median(secondOrderGaps) : null;

  const paidOrderCount = customers.reduce((s, c) => s + c.purchases.length, 0);
  const totalSpend = customers.reduce((s, c) => s + c.revenue, 0);
  const repeatCustomers = customers.filter((c) => c.purchases.length > 1);
  const customerMonths = customers.reduce((s, c) => s + Math.max(1, (now.getTime() - c.purchases[0].getTime()) / (30.44 * DAY_MS)), 0);
  const ordersPerCustomerMonth = customerMonths > 0 ? paidOrderCount / customerMonths : 0;
  const overallAvgOrder = paidOrderCount ? totalSpend / paidOrderCount : 0;
  const ltvRevenue = Math.round(overallAvgOrder * ordersPerCustomerMonth * 12);

  const contact = (c: Customer): CustomerContact => {
    const last = c.purchases[c.purchases.length - 1];
    return {
      name: c.name,
      phone: c.phone,
      orders: c.purchases.length,
      spent: c.revenue,
      lastOrder: mytParts(last).day,
      daysSince: Math.floor((now.getTime() - last.getTime()) / DAY_MS),
    };
  };

  const segmentTotals = new Map<SegmentKey, { customers: number; revenue: number }>();
  const atRisk: CustomerContact[] = [];
  const dueToReorder: CustomerContact[] = [];
  for (const c of customers) {
    const info = contact(c);
    const segment = SEGMENTS.find((s) => s.test(info.daysSince, info.orders));
    if (segment) {
      const cur = segmentTotals.get(segment.key) ?? { customers: 0, revenue: 0 };
      cur.customers++;
      cur.revenue += c.revenue;
      segmentTotals.set(segment.key, cur);
      if (segment.key === 'at_risk') atRisk.push(info);
    }

    const own = c.purchases.length > 1 ? (c.purchases[c.purchases.length - 1].getTime() - c.purchases[0].getTime()) / DAY_MS / (c.purchases.length - 1) : null;
    const gap = own !== null && own >= 1 ? own : storeGap;
    if (gap !== null && info.daysSince >= gap - 3 && info.daysSince <= gap * 2.5) {
      dueToReorder.push({ ...info, expectedGapDays: Math.round(gap), basis: own !== null && own >= 1 ? 'own' : 'store' });
    }
  }

  const segments: Segment[] = SEGMENTS.map((s) => {
    const t = segmentTotals.get(s.key) ?? { customers: 0, revenue: 0 };
    return { key: s.key, label: s.label, rule: s.rule, customers: t.customers, revenue: t.revenue, avgSpend: t.customers ? Math.round(t.revenue / t.customers) : 0, sharePct: pct(t.revenue, totalSpend) };
  });

  /* ----- Products ----- */
  const inProductWindow = (r: Row) => (spec ? between(r.at.day, spec.from, spec.to) : r.order.createdAt >= since(PRODUCT_WINDOW_DAYS));
  const thirtyAgo = since(30);
  const sixtyAgo = since(60);
  const productTotals = new Map<string, { name: string; code: string; units: number; revenue: number; costedRevenue: number; cost: number; units30: number; unitsPrior30: number }>();
  const latestCost = new Map<string, number>();
  const demand = new Map<string, { recent: number; prior: number }>();
  const lastSold = new Map<string, Date>();
  const basket = new Map<string, Set<string>>();

  for (const r of rows) {
    if (r.order.paymentStatus !== 'PAID') continue;
    const chosen = new Set<string>();
    for (const item of r.order.items) {
      if (item.unitCost !== null) latestCost.set(item.variantId, item.unitCost);
      if (!r.order.groupBuyId) {
        // Stock demand counts every line that draws stock, included supplies too.
        const d = demand.get(item.variantId) ?? { recent: 0, prior: 0 };
        if (r.order.createdAt >= thirtyAgo) d.recent += item.quantity;
        else if (r.order.createdAt >= sixtyAgo) d.prior += item.quantity;
        demand.set(item.variantId, d);
        lastSold.set(item.variantId, r.order.createdAt);
      }
      if (isIncludedItem(item)) continue;
      const name = getVariantDisplayName(item.variant.product, item.variant);
      chosen.add(name);
      const inWindow = inProductWindow(r);
      if (!inWindow && r.order.createdAt < sixtyAgo) continue;
      const cur = productTotals.get(item.variantId) ?? { name, code: item.variant.code, units: 0, revenue: 0, costedRevenue: 0, cost: 0, units30: 0, unitsPrior30: 0 };
      if (r.order.createdAt >= thirtyAgo) cur.units30 += item.quantity;
      else if (r.order.createdAt >= sixtyAgo) cur.unitsPrior30 += item.quantity;
      if (inWindow) {
        cur.units += item.quantity;
        cur.revenue += item.unitPrice * item.quantity;
        if (item.unitCost !== null) {
          cur.costedRevenue += item.unitPrice * item.quantity;
          cur.cost += item.unitCost * item.quantity;
        }
      }
      productTotals.set(item.variantId, cur);
    }
    if (chosen.size > 0) basket.set(r.order.id, chosen);
  }

  const productRevenue = [...productTotals.values()].reduce((s, p) => s + p.revenue, 0);
  let running90 = 0;
  const productRows: ProductRow[] = [...productTotals.entries()]
    .filter(([, p]) => p.units > 0)
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([variantId, p]) => {
      const before = pct(running90, productRevenue);
      running90 += p.revenue;
      return {
        variantId,
        name: p.name,
        code: p.code,
        units: p.units,
        revenue: p.revenue,
        marginPct: p.costedRevenue > 0 ? pct(p.costedRevenue - p.cost, p.costedRevenue) : null,
        sharePct: pct(p.revenue, productRevenue),
        cumulativePct: pct(running90, productRevenue),
        // By where a product STARTS in the running total, so the one that
        // crosses 80% is still an A: the standard reading of the Pareto line.
        abc: before < 80 ? ('A' as const) : before < 95 ? ('B' as const) : ('C' as const),
        units30: p.units30,
        unitsPrior30: p.unitsPrior30,
      };
    });

  const pairCounts = new Map<string, { a: string; b: string; orders: number }>();
  const itemCounts = new Map<string, number>();
  for (const names of basket.values()) {
    const list = [...names].sort();
    for (const n of list) itemCounts.set(n, (itemCounts.get(n) ?? 0) + 1);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}|${list[j]}`;
        const cur = pairCounts.get(key) ?? { a: list[i], b: list[j], orders: 0 };
        cur.orders++;
        pairCounts.set(key, cur);
      }
    }
  }
  const baskets = basket.size;
  const pairs = [...pairCounts.values()]
    .filter((p) => p.orders >= 2)
    .map((p) => ({ ...p, lift: Math.round((p.orders * baskets * 10) / ((itemCounts.get(p.a) ?? 1) * (itemCounts.get(p.b) ?? 1))) / 10 }))
    .sort((a, b) => b.orders - a.orders || b.lift - a.lift)
    .slice(0, 8);

  /* ----- Stock ----- */
  const stock: StockRow[] = variants.map((v) => {
    const d = demand.get(v.id) ?? { recent: 0, prior: 0 };
    // Weighted towards the last 30 days, so a product taking off reads as one.
    const dailyDemand = Math.round((((d.recent / 30) * 0.65 + (d.prior / 30) * 0.35) * 100)) / 100;
    const onHand = Math.max(0, v.stock);
    const coverDays = dailyDemand > 0 ? Math.round(onHand / dailyDemand) : null;
    const unitCost = latestCost.get(v.id) ?? v.supplierCost;
    const reorderUnits = dailyDemand > 0 ? Math.max(0, Math.ceil(TARGET_COVER_DAYS * dailyDemand - onHand)) : 0;
    const stockoutOn = coverDays !== null && onHand > 0 ? mytParts(new Date(now.getTime() + coverDays * DAY_MS)).day : null;
    const last = lastSold.get(v.id);
    const silent = !last || last < since(DEMAND_WINDOW_DAYS);
    let status: StockStatus = 'healthy';
    if (onHand === 0 && dailyDemand > 0) status = 'out';
    else if (onHand > 0 && silent) status = 'dead';
    else if (coverDays !== null && coverDays < 14) status = 'critical';
    else if (coverDays !== null && coverDays < 30) status = 'low';
    else if (coverDays !== null && coverDays > 180) status = 'overstock';
    return {
      variantId: v.id,
      name: getVariantDisplayName(v.product, v),
      code: v.code,
      supply: v.product.addOnOnly,
      stock: v.stock,
      dailyDemand,
      coverDays,
      stockoutOn,
      reorderUnits,
      reorderCost: unitCost === null || unitCost === undefined ? null : reorderUnits * unitCost,
      stockValue: unitCost === null || unitCost === undefined ? null : onHand * unitCost,
      status,
    };
  });
  const rank: Record<StockStatus, number> = { out: 0, critical: 1, low: 2, healthy: 3, overstock: 4, dead: 5 };
  stock.sort((a, b) => rank[a.status] - rank[b.status] || (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity) || b.stock - a.stock);

  /* ----- Assembled ----- */
  const growthBase = fitMonths.map((m) => m.revenue);
  const contributionRate = marginPct === null ? null : marginPct / 100;
  const ordersPerMonth = lastThree.length ? Math.round((lastThree.reduce((s, m) => s + m.orders.paid, 0) / lastThree.length) * 10) / 10 : 0;

  return {
    generatedAt: now.toISOString(),
    currentMonth: today.month,
    months,
    period: periodReport,
    customers: {
      total: customers.length,
      repeat: repeatCustomers.length,
      repeatRatePct: pct(repeatCustomers.length, customers.length),
      ordersPerCustomer: customers.length ? Math.round((paidOrderCount / customers.length) * 100) / 100 : 0,
      avgLifetimeSpend: customers.length ? Math.round(totalSpend / customers.length) : 0,
      medianGapDays: gaps.length ? Math.round(median(gaps)) : null,
      ltv12: customers.length
        ? {
            revenue: ltvRevenue,
            contribution: contributionRate === null ? null : Math.round(ltvRevenue * contributionRate),
            ordersPerMonth: Math.round(ordersPerCustomerMonth * 100) / 100,
          }
        : null,
      cohorts: retentionCohorts(customers, today.month),
      segments,
      dueToReorder: dueToReorder.sort((a, b) => b.spent - a.spent).slice(0, 25),
      atRisk: atRisk.sort((a, b) => b.spent - a.spent).slice(0, 25),
    },
    products: {
      window: spec ? spec.label : `Last ${PRODUCT_WINDOW_DAYS} days`,
      rows: productRows,
      pairs,
      stock,
      stockValue: stock.reduce((s, r) => s + (r.stockValue ?? 0), 0),
      uncostedStockLines: stock.filter((r) => r.stockValue === null && r.stock > 0).length,
      targetCoverDays: TARGET_COVER_DAYS,
    },
    forecast: {
      landing,
      monthly,
      dailyRunRate,
      annualRunRate: dailyRunRate * 365,
      growth3: growthBase.length >= 4 ? compoundMonthlyGrowth(growthBase.slice(-4)) : null,
      growth6: growthBase.length >= 7 ? compoundMonthlyGrowth(growthBase.slice(-7)) : null,
      marginPct,
      avgOrder,
      ordersPerMonth,
      monthlySpend,
      breakEven:
        contributionRate !== null && contributionRate > 0
          ? {
              revenue: Math.round(monthlySpend / contributionRate),
              orders: avgOrder > 0 ? Math.ceil(monthlySpend / contributionRate / avgOrder) : 0,
            }
          : null,
      stockouts: stock.filter((s) => s.status === 'out' || (s.stockoutOn !== null && s.coverDays !== null && s.coverDays <= 30)),
    },
  };
}
