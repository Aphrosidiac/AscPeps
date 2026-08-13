'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  DollarSign,
  ShoppingBag,
  Coins,
  TrendingUp,
  CreditCard,
  Package,
  Users,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetAnalytics } from '@/lib/api';
import { formatPrice, cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';

interface AnalyticsData {
  period: { days: number; since: string };
  summary: {
    totalRevenue: number;
    totalOrders: number;
    paidOrders: number;
    failedOrders: number;
    conversionRate: number;
    avgOrderValue: number;
    totalItemCost: number;
    totalExtraCost: number;
    totalCost: number;
    netProfit: number;
    profitMargin: number;
    costedRevenue: number;
    costedOrders: number;
    uncostedOrders: number;
  };
  dailyRevenue: { date: string; revenue: number; orders: number; costedRevenue: number; cost: number; profit: number }[];
  topProducts: { name: string; code: string; quantity: number; revenue: number }[];
  profitShare: { name: string; amount: number }[];
  paymentMethods: Record<string, number>;
  orderStatuses: Record<string, number>;
}

const PERIOD_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

const SERIES_OPTIONS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'profit', label: 'Profit' },
] as const;

type SeriesKey = (typeof SERIES_OPTIONS)[number]['key'];

const CHART_HEIGHT = 220;
const TICK_COUNT = 4;
/** Roughly how many dated labels fit under the x axis without colliding. */
const MAX_X_LABELS = 6;

/**
 * Rounds an axis maximum up to a readable number, so ticks land on values a
 * person would actually write down. The previous chart divided the raw maximum
 * in half, which produced axis labels like "RM387.50".
 */
function niceCeil(value: number): number {
  if (value <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Compact axis money — "RM1.2k" rather than "RM1200.00" on a cramped axis. */
function formatAxis(cents: number): string {
  const ringgit = cents / 100;
  const abs = Math.abs(ringgit);
  if (abs >= 1000) return `RM${(ringgit / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `RM${abs % 1 === 0 ? ringgit.toFixed(0) : ringgit.toFixed(2)}`;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-400',
  CONFIRMED: 'bg-blue-400',
  SHIPPED: 'bg-indigo-400',
  DELIVERED: 'bg-emerald-400',
  CANCELLED: 'bg-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const PAYMENT_LABELS: Record<string, string> = {
  BILLPLZ: 'Online (Billplz)',
  WHATSAPP: 'WhatsApp (Manual)',
  CRYPTO: 'Bitcoin (BTCPay)',
};

/**
 * Day keys from the API are bare "YYYY-MM-DD" in Malaysian time. `new Date()`
 * parses a bare date as UTC midnight, so an admin viewing from a timezone
 * behind UTC would see every bar labelled one day early. Appending a time makes
 * it parse as local midnight, which keeps the label matching the key.
 */
function parseDayKey(dateStr: string): Date {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr);
}

function formatShortDate(dateStr: string): string {
  return parseDayKey(dateStr).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

function formatFullDate(dateStr: string): string {
  return parseDayKey(dateStr).toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AdminAnalyticsPage() {
  const { token } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<SeriesKey>('revenue');
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError(false);
    adminGetAnalytics(token, days)
      .then((res: AnalyticsData) => {
        setData(res);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [token, days]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="text-center py-16">
        <BarChart3 className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <p className="text-text-muted mb-4">Failed to load analytics data.</p>
        <button
          onClick={load}
          className="text-sm font-medium text-primary underline cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-surface-elevated rounded w-48" />
          <div className="h-9 bg-surface-elevated rounded-lg w-40" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 bg-surface-elevated rounded-xl" />
          ))}
        </div>
        <div className="h-72 bg-surface-elevated rounded-xl" />
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="h-64 bg-surface-elevated rounded-xl" />
          <div className="h-64 bg-surface-elevated rounded-xl" />
        </div>
      </div>
    );
  }

  const { summary, dailyRevenue, topProducts, profitShare, paymentMethods, orderStatuses } = data;

  // Profit covers only the paid orders that are fully costed. Saying so on the
  // card matters: without it, a small netProfit reads as a bad month rather
  // than as most of the month simply not being costed yet.
  const hasProfit = summary.costedOrders > 0;

  /* ----- chart scale.
     The domain is built from a rounded maximum (and a rounded minimum when a
     day ran at a loss) so ticks land on whole numbers and bars share one
     baseline. Profit can legitimately go negative, hence the explicit zero
     line rather than assuming everything grows up from the floor. */
  const chartPoints = dailyRevenue.map((d) => ({ ...d, value: series === 'revenue' ? d.revenue : d.profit }));
  const rawMax = Math.max(...chartPoints.map((p) => p.value), 0);
  const rawMin = Math.min(...chartPoints.map((p) => p.value), 0);
  const axisTop = niceCeil(rawMax);
  const axisBottom = rawMin < 0 ? -niceCeil(-rawMin) : 0;
  const span = axisTop - axisBottom || 1;
  const zeroPct = ((0 - axisBottom) / span) * 100;

  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
    const value = axisBottom + (span / TICK_COUNT) * i;
    return { value: Math.round(value), pct: ((value - axisBottom) / span) * 100 };
  });

  // Left-to-right stagger, but budgeted: the whole sweep finishes in ~350ms
  // whether that's 7 bars or 90, so the 90d view doesn't crawl in.
  const barStagger = chartPoints.length > 0 ? Math.min(24, 350 / chartPoints.length) : 0;

  // Evenly spaced label positions, always including the first and last day.
  const labelStride = Math.max(1, Math.ceil(chartPoints.length / MAX_X_LABELS));
  const labelIndices = new Set<number>();
  for (let i = 0; i < chartPoints.length; i += labelStride) labelIndices.add(i);
  labelIndices.add(chartPoints.length - 1);

  const summaryCards = [
    {
      label: 'Revenue',
      value: formatPrice(summary.totalRevenue),
      icon: DollarSign,
      subtext: `${summary.paidOrders} paid order${summary.paidOrders === 1 ? '' : 's'}`,
    },
    {
      label: 'Costs',
      value: hasProfit ? formatPrice(summary.totalCost) : '—',
      icon: Coins,
      subtext: hasProfit
        ? `${formatPrice(summary.totalItemCost)} goods + ${formatPrice(summary.totalExtraCost)} extras`
        : 'Nothing costed yet',
    },
    {
      label: 'Net Profit',
      value: hasProfit ? formatPrice(summary.netProfit) : '—',
      icon: TrendingUp,
      subtext: hasProfit
        ? `${summary.profitMargin.toFixed(1)}% margin${summary.uncostedOrders > 0 ? ` · ${summary.uncostedOrders} not costed` : ''}`
        : 'Cost an order to see profit',
      tone: hasProfit ? (summary.netProfit < 0 ? 'bad' : 'good') : undefined,
    },
    {
      label: 'Orders',
      value: summary.totalOrders.toLocaleString(),
      icon: ShoppingBag,
      subtext: `${summary.conversionRate.toFixed(0)}% paid · ${summary.failedOrders} failed`,
    },
    {
      label: 'Avg Order Value',
      value: formatPrice(summary.avgOrderValue),
      icon: CreditCard,
      subtext: 'Per paid order',
    },
  ];

  const totalPayments = Object.values(paymentMethods).reduce((a, b) => a + b, 0);
  const totalStatuses = Object.values(orderStatuses).reduce((a, b) => a + b, 0);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <Animate variant="fadeUp">
          <h1 className="font-display text-2xl font-bold">Analytics</h1>
        </Animate>

        <Animate variant="fadeUp" delay={0.05}>
          <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setDays(opt.days)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer',
                  days === opt.days
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Animate>
      </div>

      {/* Summary Cards */}
      <Animate variant="fadeUp" delay={0.1}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
          {summaryCards.map((card, idx) => (
            <div
              key={card.label}
              className={cn(
                'bg-surface rounded-xl border border-border p-4 sm:p-5 transition-all hover:border-border-hover hover:shadow-sm',
                idx === 0 && 'col-span-2 lg:col-span-1'
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs sm:text-sm text-text-secondary">{card.label}</span>
                <card.icon className="w-4 h-4 text-text-muted" />
              </div>
              <p
                className={cn(
                  'font-display text-xl sm:text-2xl font-bold tracking-tight',
                  card.tone === 'good' && 'text-success',
                  card.tone === 'bad' && 'text-danger'
                )}
              >
                {card.value}
              </p>
              <p className="text-xs text-text-muted mt-1">{card.subtext}</p>
            </div>
          ))}
        </div>
      </Animate>


      {/* Revenue / Profit Chart */}
      <Animate variant="fadeUp" delay={0.15}>
        <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display font-semibold text-lg">
                Daily {series === 'revenue' ? 'Revenue' : 'Profit'}
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                {formatShortDate(data.period.since)}{' '}&mdash;{' '}Today
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-display text-lg font-bold">
                  {series === 'revenue'
                    ? formatPrice(summary.totalRevenue)
                    : hasProfit ? formatPrice(summary.netProfit) : '—'}
                </p>
                <p className="text-xs text-text-muted">
                  {series === 'revenue'
                    ? `${summary.paidOrders} paid order${summary.paidOrders === 1 ? '' : 's'}`
                    : `${summary.costedOrders} costed order${summary.costedOrders === 1 ? '' : 's'}`}
                </p>
              </div>
              {/* Series toggle rather than a second chart — same axes, same
                  shape, one thing to read at a time. */}
              <div className="flex items-center gap-1 bg-surface-elevated rounded-lg p-1 shrink-0">
                {SERIES_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSeries(opt.key)}
                    className={cn(
                      'px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer',
                      series === opt.key
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-primary'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {chartPoints.length === 0 ? (
            <div className="text-center py-12">
              <BarChart3 className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">No data for this period</p>
            </div>
          ) : (
            <>
              {/* pt-3 keeps the topmost axis label, which is centred on its
                  gridline and so sits half above it, clear of the heading. */}
              <div className="flex pt-3" onMouseLeave={() => setHoveredBar(null)}>
                {/* Y axis. Labels sit ON their gridline — the previous version
                    laid these out in a horizontal row, so they read as three
                    values across the top rather than as an axis. */}
                <div className="relative w-14 sm:w-16 shrink-0" style={{ height: CHART_HEIGHT }}>
                  {ticks.map((tick) => (
                    <span
                      key={tick.value}
                      className="absolute right-2 text-[10px] text-text-muted tabular-nums -translate-y-1/2 whitespace-nowrap"
                      style={{ bottom: `${tick.pct}%` }}
                    >
                      {formatAxis(tick.value)}
                    </span>
                  ))}
                </div>

                <div className="relative flex-1 min-w-0" style={{ height: CHART_HEIGHT }}>
                  {/* Gridlines */}
                  {ticks.map((tick) => (
                    <div
                      key={tick.value}
                      className={cn(
                        'absolute inset-x-0 border-t',
                        tick.value === 0 ? 'border-border' : 'border-border/50'
                      )}
                      style={{ bottom: `${tick.pct}%` }}
                    />
                  ))}

                  {/* Bars. The key is what replays the grow-in animation:
                      remounting on a series or period change restarts the CSS
                      keyframes, which a plain class toggle would not. */}
                  <div key={`${series}-${days}`} className="absolute inset-0 flex items-stretch gap-px">
                    {chartPoints.map((point, idx) => {
                      const isHovered = hoveredBar === idx;
                      const magnitude = Math.abs(point.value);
                      const heightPct = (magnitude / span) * 100;
                      const basePct = point.value >= 0 ? zeroPct : zeroPct - heightPct;

                      return (
                        <div
                          key={point.date}
                          className="relative flex-1 min-w-0 cursor-pointer"
                          onMouseEnter={() => setHoveredBar(idx)}
                        >
                          {/* Full-height hover band, so thin bars and empty
                              days are still targetable and readable. */}
                          <div
                            className={cn(
                              'absolute inset-0 transition-colors',
                              isHovered ? 'bg-surface-elevated' : 'bg-transparent'
                            )}
                          />
                          {point.value !== 0 && (
                            <div
                              className={cn(
                                'absolute inset-x-0 sm:inset-x-[1px] rounded-t-[2px] transition-colors chart-bar-rise',
                                point.value < 0
                                  ? 'bg-danger rounded-t-none rounded-b-[2px]'
                                  : isHovered
                                    ? 'bg-primary'
                                    : 'bg-primary/70'
                              )}
                              style={{
                                bottom: `${basePct}%`,
                                height: `${Math.max(heightPct, 0.8)}%`,
                                transformOrigin: point.value < 0 ? 'top' : 'bottom',
                                animationDelay: `${idx * barStagger}ms`,
                              }}
                            />
                          )}

                          {isHovered && (
                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                              <div className="bg-primary text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                                <p className="font-semibold">{formatFullDate(point.date)}</p>
                                <p className="mt-1">
                                  Revenue {formatPrice(point.revenue)} &middot; {point.orders} order
                                  {point.orders !== 1 ? 's' : ''}
                                </p>
                                {point.costedRevenue > 0 && (
                                  <p className="opacity-80">
                                    Profit {formatPrice(point.profit)} on {formatPrice(point.costedRevenue)} costed
                                  </p>
                                )}
                              </div>
                              <div className="w-2 h-2 bg-primary rotate-45 mx-auto -mt-1" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* X axis — labels aligned to their own bar slot rather than
                  spread with justify-between, which never lined up. */}
              <div className="flex gap-px mt-2 ml-14 sm:ml-16">
                {chartPoints.map((point, idx) => (
                  <div key={point.date} className="relative flex-1 min-w-0 h-4">
                    {labelIndices.has(idx) && (
                      <span
                        className={cn(
                          'absolute text-[10px] text-text-muted whitespace-nowrap top-0',
                          idx === 0
                            ? 'left-0'
                            : idx === chartPoints.length - 1
                              ? 'right-0'
                              : 'left-1/2 -translate-x-1/2'
                        )}
                      >
                        {formatShortDate(point.date)}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {series === 'profit' && summary.uncostedOrders > 0 && (
                <p className="text-xs text-text-muted mt-4 pt-4 border-t border-border">
                  {summary.uncostedOrders} paid order{summary.uncostedOrders === 1 ? '' : 's'} in this period
                  {summary.uncostedOrders === 1 ? " isn't" : " aren't"} costed yet and{' '}
                  {summary.uncostedOrders === 1 ? 'is' : 'are'} excluded from profit.
                </p>
              )}
            </>
          )}
        </div>
      </Animate>

      {/* Top Products */}
      <Animate variant="fadeUp" delay={0.2}>
        <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 mb-8">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-semibold text-lg">Top Products</h2>
            <span className="text-xs text-text-muted">By revenue</span>
          </div>

          {topProducts.length === 0 ? (
            <div className="text-center py-10">
              <Package className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">No product sales in this period</p>
            </div>
          ) : (
            <>
            {/* Phones get a stacked row per product. The table wants 540px, so
                Qty Sold and Revenue — the two figures that make it a ranking —
                were off the right edge. */}
            <div className="divide-y divide-border sm:hidden -mx-5">
              {topProducts.map((product, idx) => (
                <div key={`m-${product.code}-${idx}`} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0',
                      idx === 0
                        ? 'bg-primary text-white'
                        : idx === 1
                          ? 'bg-surface-elevated text-text-primary'
                          : idx === 2
                            ? 'bg-surface-elevated text-text-secondary'
                            : 'text-text-muted'
                    )}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium min-w-0">{product.name}</p>
                      <span className="text-sm font-display font-bold tabular-nums shrink-0">
                        {formatPrice(product.revenue)}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">
                      <code className="font-mono">{product.code}</code> · {product.quantity.toLocaleString()} sold
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto -mx-5 sm:-mx-6">
              <table className="w-full min-w-[540px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider py-3 pl-5 sm:pl-6 pr-2 w-10">
                      #
                    </th>
                    <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider py-3 pr-3">
                      Product
                    </th>
                    <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wider py-3 pr-3">
                      Code
                    </th>
                    <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wider py-3 pr-3">
                      Qty Sold
                    </th>
                    <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wider py-3 pr-5 sm:pr-6">
                      Revenue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((product, idx) => (
                    <tr
                      key={`${product.code}-${idx}`}
                      className="border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors"
                    >
                      <td className="py-3 pl-5 sm:pl-6 pr-2">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold',
                            idx === 0
                              ? 'bg-primary text-white'
                              : idx === 1
                                ? 'bg-surface-elevated text-text-primary'
                                : idx === 2
                                  ? 'bg-surface-elevated text-text-secondary'
                                  : 'text-text-muted'
                          )}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <p className="text-sm font-medium">{product.name}</p>
                      </td>
                      <td className="py-3 pr-3">
                        <code className="text-xs text-text-muted font-mono bg-surface-elevated px-1.5 py-0.5 rounded">
                          {product.code}
                        </code>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="text-sm font-semibold tabular-nums">
                          {product.quantity.toLocaleString()}
                        </span>
                      </td>
                      <td className="py-3 pr-5 sm:pr-6 text-right">
                        <span className="text-sm font-display font-bold tabular-nums">
                          {formatPrice(product.revenue)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      </Animate>

      {/* Profit Share, Payment Methods & Order Statuses */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Profit Share — who earned what across the period, summed from each
            order's own recorded split rather than from one global rule. */}
        <Animate variant="fadeUp" delay={0.22}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 h-full">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display font-semibold text-lg">Profit Share</h2>
              <span className="text-xs text-text-muted">
                {summary.costedOrders} order{summary.costedOrders === 1 ? '' : 's'}
              </span>
            </div>

            {profitShare.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-8 h-8 text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">
                  {hasProfit ? 'No splits recorded yet' : 'Cost an order to see profit'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {profitShare.map((person) => {
                  const pct = summary.netProfit !== 0
                    ? Math.abs(person.amount / summary.netProfit) * 100
                    : 0;

                  return (
                    <div key={person.name}>
                      <div className="flex items-center justify-between mb-1.5 gap-3">
                        <span className="text-sm font-medium truncate">{person.name}</span>
                        <span className="text-sm font-semibold tabular-nums shrink-0">
                          {formatPrice(person.amount)}
                        </span>
                      </div>
                      <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Animate>

        {/* Payment Methods */}
        <Animate variant="fadeUp" delay={0.25}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 h-full">
            <h2 className="font-display font-semibold text-lg mb-5">Payment Methods</h2>

            {totalPayments === 0 ? (
              <div className="text-center py-8">
                <CreditCard className="w-8 h-8 text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">No payment data</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(paymentMethods).map(([method, count]) => {
                  const pct = (count / totalPayments) * 100;

                  return (
                    <div key={method}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium">
                          {PAYMENT_LABELS[method] || method}
                        </span>
                        <span className="text-sm text-text-secondary tabular-nums">
                          {count.toLocaleString()}{' '}
                          <span className="text-text-muted">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            background: 'linear-gradient(to right, #0A0A0A, #525252)',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Animate>

        {/* Order Statuses */}
        <Animate variant="fadeUp" delay={0.3}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 h-full">
            <h2 className="font-display font-semibold text-lg mb-5">Order Status Breakdown</h2>

            {totalStatuses === 0 ? (
              <div className="text-center py-8">
                <ShoppingBag className="w-8 h-8 text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">No order data</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(orderStatuses).map(([status, count]) => {
                  const pct = (count / totalStatuses) * 100;
                  const barColor = STATUS_COLORS[status] || 'bg-gray-400';

                  return (
                    <div key={status}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={cn('w-2.5 h-2.5 rounded-full', barColor)} />
                          <span className="text-sm font-medium">
                            {STATUS_LABELS[status] || status}
                          </span>
                        </div>
                        <span className="text-sm text-text-secondary tabular-nums">
                          {count.toLocaleString()}{' '}
                          <span className="text-text-muted">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', barColor)}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Animate>
      </div>
    </div>
  );
}
