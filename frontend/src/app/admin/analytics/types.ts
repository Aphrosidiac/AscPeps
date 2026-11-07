/** Mirrors AnalyticsReport in backend/src/utils/analytics-model.ts. */

export type MonthKey = string;

export interface Slice {
  key: string;
  orders: number;
  revenue: number;
}

export interface MonthProduct {
  variantId: string;
  name: string;
  code: string;
  units: number;
  revenue: number;
  sharePct: number;
  marginPct: number | null;
  profit: number | null;
  previousRevenue: number;
  previousUnits: number;
}

export interface MonthReport {
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
  compare: { label: string; sameDays: boolean; revenue: number; paidOrders: number; avgOrder: number; margin: number | null; units: number; buyers: number };
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

export interface Contact {
  name: string;
  phone: string;
  orders: number;
  spent: number;
  lastOrder: string;
  daysSince: number;
  expectedGapDays?: number;
  basis?: 'own' | 'store';
}

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
  status: 'out' | 'critical' | 'low' | 'healthy' | 'overstock' | 'dead';
}

export interface ForecastRange {
  expected: number;
  low: number;
  high: number;
}

export interface AnalyticsReport {
  generatedAt: string;
  currentMonth: MonthKey;
  months: MonthReport[];
  period: MonthReport | null;
  customers: {
    total: number;
    repeat: number;
    repeatRatePct: number;
    ordersPerCustomer: number;
    avgLifetimeSpend: number;
    medianGapDays: number | null;
    ltv12: { revenue: number; contribution: number | null; ordersPerMonth: number } | null;
    cohorts: { month: MonthKey; label: string; size: number; revenue: number; retention: (number | null)[] }[];
    segments: { key: string; label: string; rule: string; customers: number; revenue: number; avgSpend: number; sharePct: number }[];
    dueToReorder: Contact[];
    atRisk: Contact[];
  };
  products: {
    window: string;
    rows: {
      variantId: string;
      name: string;
      code: string;
      units: number;
      revenue: number;
      marginPct: number | null;
      sharePct: number;
      cumulativePct: number;
      abc: 'A' | 'B' | 'C';
      units30: number;
      unitsPrior30: number;
    }[];
    pairs: { a: string; b: string; orders: number; lift: number }[];
    stock: StockRow[];
    stockValue: number;
    uncostedStockLines: number;
    targetCoverDays: number;
  };
  forecast: {
    landing: (ForecastRange & { month: MonthKey; label: string; toDate: number; daysElapsed: number; daysLeft: number; previousLabel: string; previousTotal: number }) | null;
    monthly: {
      method: string;
      methodLabel: string;
      backtest: { folds: number; typicalMissPct: number; naiveMissPct: number } | null;
      basedOn: number;
      points: (ForecastRange & { month: MonthKey; label: string; contribution: number | null; net: number | null })[];
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
