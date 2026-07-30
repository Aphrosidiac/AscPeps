'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wallet, TrendingUp, Coins, Users, AlertTriangle, Plus, ArrowRight, Receipt,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetFinanceOverview, adminSavePartners } from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import { RecordMoneyDialog } from './RecordMoneyDialog';
import type { FinanceOverview } from '@/types';

const bpsToPercent = (bps: number) => (bps / 100).toFixed(2).replace(/\.00$/, '');

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
  const [editingOwnership, setEditingOwnership] = useState(false);
  const [ownershipDraft, setOwnershipDraft] = useState<Record<string, number>>({});
  const [ownershipError, setOwnershipError] = useState('');
  const [savingOwnership, setSavingOwnership] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    setError(false);
    adminGetFinanceOverview(token)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startEditingOwnership = () => {
    if (!data) return;
    setOwnershipDraft(Object.fromEntries(data.partners.map((p) => [p.partnerId, p.ownershipBps])));
    setOwnershipError('');
    setEditingOwnership(true);
  };

  const saveOwnership = async () => {
    if (!token || !data) return;
    setOwnershipError('');
    setSavingOwnership(true);
    try {
      await adminSavePartners(
        token,
        data.partners.map((p) => ({
          id: p.partnerId,
          name: p.name,
          active: p.active,
          ownershipBps: ownershipDraft[p.partnerId] ?? p.ownershipBps,
        }))
      );
      setEditingOwnership(false);
      load();
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setOwnershipError(message || 'Could not save ownership.');
    } finally {
      setSavingOwnership(false);
    }
  };

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

  const draftTotal = Object.values(ownershipDraft).reduce((sum, v) => sum + v, 0);

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
            hint={data.unallocatedSpend > 0 ? `${formatPrice(data.unallocatedSpend)} absorbed` : 'All allocated'}
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

      {data.ownershipBps !== 10_000 && (
        <Animate variant="fadeUp" delay={0.13}>
          <div className="bg-danger/10 border border-danger/20 rounded-xl px-5 py-3.5 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">
                Ownership totals {bpsToPercent(data.ownershipBps)}%, not 100%.
              </span>{' '}
              Expenses are still split in full, but in proportions nobody chose. Fix it below.
            </p>
          </div>
        </Animate>
      )}

      {/* Partners */}
      <Animate variant="fadeUp" delay={0.15}>
        <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border gap-3">
            <h2 className="font-display font-semibold">Partners</h2>
            {editingOwnership ? (
              <div className="flex items-center gap-2">
                <span className={cn('text-xs font-medium', draftTotal === 10_000 ? 'text-success' : 'text-danger')}>
                  {bpsToPercent(draftTotal)}%
                </span>
                <button
                  onClick={() => setEditingOwnership(false)}
                  className="px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={saveOwnership}
                  disabled={savingOwnership}
                  className="px-2.5 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {savingOwnership ? 'Saving…' : 'Save'}
                </button>
              </div>
            ) : (
              <button
                onClick={startEditingOwnership}
                className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                Edit ownership
              </button>
            )}
          </div>

          {ownershipError && <p className="text-sm text-danger px-5 pt-3">{ownershipError}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Partner</th>
                  <th className="text-right px-3 py-3 whitespace-nowrap">Own %</th>
                  <th className="text-right px-3 py-3">Earned</th>
                  <th className="text-right px-3 py-3 whitespace-nowrap">Expense share</th>
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
                    <td className="px-3 py-3 text-right">
                      {editingOwnership ? (
                        <div className="relative w-20 ml-auto">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={bpsToPercent(ownershipDraft[p.partnerId] ?? 0)}
                            onChange={(e) =>
                              setOwnershipDraft((d) => ({
                                ...d,
                                [p.partnerId]: Math.round(Number(e.target.value) * 100) || 0,
                              }))
                            }
                            aria-label={`${p.name} ownership percent`}
                            className="w-full pl-2 pr-5 py-1 border border-border rounded-md text-sm bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-text-muted">%</span>
                        </div>
                      ) : (
                        <span className="text-text-secondary">{bpsToPercent(p.ownershipBps)}%</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatPrice(p.earned)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-danger">
                      {p.expenseShare > 0 ? `−${formatPrice(p.expenseShare)}` : formatPrice(0)}
                    </td>
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
            Owed = earned − expense share + advances outstanding − paid out.{' '}
            <span className="text-text-secondary">Contributions are capital, never owed back</span>, so they
            sit outside that sum.
          </p>
        </div>
      </Animate>

      {/* Recent expenses */}
      <Animate variant="fadeUp" delay={0.2}>
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <h2 className="font-display font-semibold">Recent spending</h2>
            <Link href="/admin/finance/expenses" className="text-xs text-text-muted hover:text-primary transition-colors inline-flex items-center gap-1">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {data.recentExpenses.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">
              Nothing recorded yet. Company spending is what turns gross profit into a real number.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.recentExpenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.description}</p>
                    <p className="text-xs text-text-muted">
                      {e.category} · {formatShortDate(e.occurredAt)}
                      {e.paidBy && ` · paid by ${e.paidBy.name}`}
                    </p>
                  </div>
                  <p className="text-sm font-semibold shrink-0 tabular-nums">{formatPrice(e.amount)}</p>
                </div>
              ))}
            </div>
          )}
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
