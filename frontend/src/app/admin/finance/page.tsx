'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wallet, TrendingUp, Coins, Users, AlertTriangle, Plus, ArrowRight, Receipt,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetFinanceOverview } from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import { RecordMoneyDialog } from './RecordMoneyDialog';
import type { FinanceOverview, FinanceActivityKind } from '@/types';

const ACTIVITY_STYLES: Record<FinanceActivityKind, { label: string; chip: string }> = {
  EXPENSE: { label: 'Spending', chip: 'bg-surface-elevated text-text-secondary' },
  CONTRIBUTION: { label: 'Contribution', chip: 'bg-blue-100 text-blue-800' },
  ADVANCE: { label: 'Advance', chip: 'bg-yellow-100 text-yellow-800' },
  REPAYMENT: { label: 'Repayment', chip: 'bg-green-100 text-green-800' },
  PAYOUT: { label: 'Payout', chip: 'bg-purple-100 text-purple-800' },
};

function StatCard({
  label, value, hint, icon: Icon, tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs sm:text-sm text-text-secondary">{label}</span>
        <Icon className="w-4 h-4 text-text-muted" />
      </div>
      <p className={cn(
        'font-display text-xl sm:text-2xl font-bold tracking-tight',
        tone === 'good' && 'text-success',
        tone === 'bad' && 'text-danger'
      )}>
        {value}
      </p>
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
    </div>
  );
}

export default function AdminFinancePage() {
  const { token } = useAuth();
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    setError(false);
    adminGetFinanceOverview(token)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (error) {
    return (
      <div className="text-center py-16">
        <Wallet className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <p className="text-text-muted mb-4">Failed to load finance data.</p>
        <button onClick={load} className="text-sm font-medium text-primary underline cursor-pointer">Try again</button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-surface-elevated rounded w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 bg-surface-elevated rounded-xl" />)}
        </div>
        <div className="h-64 bg-surface-elevated rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <Animate variant="fadeUp">
          <div>
            <h1 className="font-display text-2xl font-bold">Finance</h1>
            <p className="text-xs text-text-muted mt-0.5">Lifetime totals across every order and expense</p>
          </div>
        </Animate>
        <Animate variant="fadeUp" delay={0.05}>
          <div className="flex gap-2">
            <Link
              href="/admin/finance/expenses"
              className="inline-flex items-center gap-1.5 px-3 py-2 border border-border bg-surface rounded-lg text-sm font-medium hover:bg-surface-elevated transition-colors"
            >
              <Receipt className="w-4 h-4" /> Expenses
            </Link>
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Record money
            </button>
          </div>
        </Animate>
      </div>

      {/* Company position */}
      <Animate variant="fadeUp" delay={0.1}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StatCard
            label="Gross profit"
            value={formatPrice(data.grossOrderProfit)}
            hint={`From ${data.costedOrders} costed order${data.costedOrders === 1 ? '' : 's'}`}
            icon={TrendingUp}
          />
          <StatCard
            label="Company spend"
            value={formatPrice(data.companySpend)}
            hint="Reduces net profit only"
            icon={Coins}
          />
          <StatCard
            label="Net profit"
            value={formatPrice(data.netProfit)}
            hint="Gross profit − company spend"
            icon={Wallet}
            tone={data.netProfit < 0 ? 'bad' : 'good'}
          />
          <StatCard
            label="Capital in"
            value={formatPrice(data.totalContributed)}
            hint={`${formatPrice(data.totalAdvancesOutstanding)} advances outstanding`}
            icon={Users}
          />
        </div>
      </Animate>

      {data.uncostedOrders > 0 && (
        <Animate variant="fadeUp" delay={0.12}>
          <div className="bg-warning/10 border border-warning/20 rounded-xl px-5 py-3.5 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">
                {data.uncostedOrders} paid order{data.uncostedOrders === 1 ? '' : 's'} not costed yet.
              </span>{' '}
              Their profit is in none of these figures — cost them on each order&rsquo;s Profit Sharing tab.
            </p>
          </div>
        </Animate>
      )}

      {/* Partners */}
      <Animate variant="fadeUp" delay={0.15}>
        <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="font-display font-semibold">Partners</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Partner</th>
                  <th className="text-right px-3 py-3">Earned</th>
                  <th className="text-right px-3 py-3 whitespace-nowrap">Capital fronted</th>
                  <th className="text-right px-3 py-3">Contributed</th>
                  <th className="text-right px-3 py-3 whitespace-nowrap">Advances o/s</th>
                  <th className="text-right px-3 py-3 whitespace-nowrap">Paid out</th>
                  <th className="text-right px-5 py-3">Owed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.partners.map((p) => (
                  <tr key={p.partnerId} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/finance/partners/${p.partnerId}`}
                        className="font-medium hover:text-primary hover:underline transition-colors"
                      >
                        {p.name}
                      </Link>
                      {!p.active && <span className="ml-2 text-xs text-text-muted">inactive</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPrice(p.earned)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPrice(p.capitalFronted)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-muted">{formatPrice(p.contributed)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPrice(p.advancesOutstanding)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-text-muted">
                      {p.paidOut > 0 ? `−${formatPrice(p.paidOut)}` : formatPrice(0)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={cn('font-display font-bold tabular-nums', p.owed < 0 ? 'text-danger' : '')}>
                        {formatPrice(p.owed)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="px-5 py-3 border-t border-border text-xs text-text-muted">
            Owed = earned + capital fronted + advances outstanding − paid out.{' '}
            <span className="text-text-secondary">Capital fronted is money they put up to cover an order&apos;s
            costs before the customer paid</span> — it comes back to them, so it adds to what they are owed.{' '}
            <span className="text-text-secondary">Contributions are capital they never want back</span>, so
            they sit outside the sum.
          </p>
        </div>
      </Animate>

      {/* Recent activity — every money movement, not just spending. An advance
          or a payout is as much "something happened" as buying ads, and a feed
          that showed only expenses made recorded money look like it vanished. */}
      <Animate variant="fadeUp" delay={0.2}>
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <h2 className="font-display font-semibold">Recent activity</h2>
            <Link href="/admin/finance/expenses" className="text-xs text-text-muted hover:text-primary transition-colors inline-flex items-center gap-1">
              All spending <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {data.recentActivity.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">
              Nothing recorded yet — no spending, contributions, advances or payouts.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.recentActivity.map((a) => {
                const style = ACTIVITY_STYLES[a.kind];
                return (
                  <div key={`${a.kind}-${a.id}`} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0 flex items-center gap-3">
                      {/* Fixed width so every row's text starts at the same x —
                          "Spending" and "Contribution" are very different
                          lengths, and left-aligning to the chip made the list
                          look ragged. */}
                      <span
                        className={cn(
                          'w-24 shrink-0 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-medium',
                          style.chip
                        )}
                      >
                        {style.label}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.description}</p>
                        <p className="text-xs text-text-muted truncate">
                          {[
                            a.category,
                            formatShortDate(a.occurredAt),
                            a.partnerName &&
                              (a.kind === 'EXPENSE'
                                ? `paid by ${a.partnerName}${a.fundedAs === 'ADVANCE' ? ' · owed back' : a.fundedAs === 'CONTRIBUTION' ? ' · investment' : ''}`
                                : a.partnerName),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                    <p className={cn('text-sm font-semibold shrink-0 tabular-nums', a.direction === 'IN' ? 'text-success' : '')}>
                      {a.direction === 'IN' ? '+' : '−'}{formatPrice(a.amount)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          <p className="px-5 py-3 border-t border-border text-xs text-text-muted">
            <span className="text-success">+</span> money into the company,{' '}
            <span>−</span> money out. An expense a partner paid for shows once, on the expense.
          </p>
        </div>
      </Animate>

      {dialogOpen && (
        <RecordMoneyDialog
          partners={data.partners}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); load(); }}
        />
      )}
    </div>
  );
}
