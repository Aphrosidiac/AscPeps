'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  DollarSign,
  ShoppingBag,
  CheckCircle,
  TrendingUp,
  CreditCard,
  Package,
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
  };
  dailyRevenue: { date: string; revenue: number; orders: number }[];
  topProducts: { name: string; code: string; quantity: number; revenue: number }[];
  paymentMethods: Record<string, number>;
  orderStatuses: Record<string, number>;
}

const PERIOD_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

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
};

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AdminAnalyticsPage() {
  const { token } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(30);
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

  const { summary, dailyRevenue, topProducts, paymentMethods, orderStatuses } = data;

  const maxRevenue = Math.max(...dailyRevenue.map((d) => d.revenue), 1);

  const summaryCards = [
    {
      label: 'Total Revenue',
      value: formatPrice(summary.totalRevenue),
      icon: DollarSign,
      subtext: `Since ${formatShortDate(data.period.since)}`,
    },
    {
      label: 'Total Orders',
      value: summary.totalOrders.toLocaleString(),
      icon: ShoppingBag,
      subtext: `${summary.failedOrders} failed`,
    },
    {
      label: 'Paid Orders',
      value: summary.paidOrders.toLocaleString(),
      icon: CheckCircle,
      subtext: `${((summary.paidOrders / Math.max(summary.totalOrders, 1)) * 100).toFixed(0)}% of total`,
    },
    {
      label: 'Conversion Rate',
      value: `${summary.conversionRate.toFixed(1)}%`,
      icon: TrendingUp,
      subtext: 'Paid / Total',
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
              <p className="font-display text-xl sm:text-2xl font-bold tracking-tight">
                {card.value}
              </p>
              <p className="text-xs text-text-muted mt-1">{card.subtext}</p>
            </div>
          ))}
        </div>
      </Animate>

      {/* Revenue Chart */}
      <Animate variant="fadeUp" delay={0.15}>
        <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display font-semibold text-lg">Daily Revenue</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {formatShortDate(data.period.since)} &mdash; Today
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-lg font-bold">
                {formatPrice(summary.totalRevenue)}
              </p>
              <p className="text-xs text-text-muted">
                {summary.totalOrders} order{summary.totalOrders !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {dailyRevenue.length === 0 ? (
            <div className="text-center py-12">
              <BarChart3 className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">No revenue data for this period</p>
            </div>
          ) : (
            <div className="relative">
              {/* Y-axis labels */}
              <div className="flex justify-between text-[10px] text-text-muted mb-2 px-0.5">
                <span>{formatPrice(maxRevenue)}</span>
                <span>{formatPrice(Math.round(maxRevenue / 2))}</span>
                <span>RM0.00</span>
              </div>

              {/* Chart area */}
              <div
                className="flex items-end gap-[2px] sm:gap-1"
                style={{ height: '200px' }}
                onMouseLeave={() => setHoveredBar(null)}
              >
                {dailyRevenue.map((day, idx) => {
                  const heightPct = (day.revenue / maxRevenue) * 100;
                  const isHovered = hoveredBar === idx;

                  return (
                    <div
                      key={day.date}
                      className="relative flex-1 flex items-end justify-center group"
                      style={{ height: '100%' }}
                      onMouseEnter={() => setHoveredBar(idx)}
                    >
                      {/* Tooltip */}
                      {isHovered && (
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
                          <div className="bg-primary text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                            <p className="font-semibold">{formatFullDate(day.date)}</p>
                            <p className="mt-0.5">
                              {formatPrice(day.revenue)} &middot; {day.orders} order
                              {day.orders !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <div className="w-2 h-2 bg-primary rotate-45 mx-auto -mt-1" />
                        </div>
                      )}

                      {/* Bar */}
                      <div
                        className={cn(
                          'w-full rounded-t-sm transition-all duration-200 cursor-pointer',
                          isHovered ? 'opacity-100' : 'opacity-80 hover:opacity-100'
                        )}
                        style={{
                          height: `${Math.max(heightPct, day.revenue > 0 ? 2 : 0)}%`,
                          background:
                            day.revenue > 0
                              ? 'linear-gradient(to top, #0A0A0A, #404040)'
                              : 'transparent',
                          minHeight: day.revenue > 0 ? '3px' : '0',
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* X-axis labels */}
              <div className="flex justify-between mt-2 px-0.5">
                {dailyRevenue.length <= 14 ? (
                  dailyRevenue.map((day) => (
                    <span key={day.date} className="text-[10px] text-text-muted flex-1 text-center truncate">
                      {formatShortDate(day.date)}
                    </span>
                  ))
                ) : (
                  <>
                    <span className="text-[10px] text-text-muted">
                      {formatShortDate(dailyRevenue[0].date)}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {formatShortDate(dailyRevenue[Math.floor(dailyRevenue.length / 2)].date)}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {formatShortDate(dailyRevenue[dailyRevenue.length - 1].date)}
                    </span>
                  </>
                )}
              </div>
            </div>
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
            <div className="overflow-x-auto -mx-5 sm:-mx-6">
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
          )}
        </div>
      </Animate>

      {/* Payment Methods & Order Statuses */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Payment Methods */}
        <Animate variant="fadeUp" delay={0.25}>
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6">
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
          <div className="bg-surface rounded-xl border border-border p-5 sm:p-6">
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
