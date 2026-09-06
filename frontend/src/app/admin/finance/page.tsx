'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Wallet, TrendingUp, Coins, Users, AlertTriangle, Plus, ArrowRight, Receipt, Scale,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminDeletePartner, adminGetFinanceOverview } from '@/lib/api';
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
  const [removingPartner, setRemovingPartner] = useState<string | null>(null);
  const [partnerError, setPartnerError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Every setState here happens in a promise callback, never synchronously in
  // the effect body — the retry button is what re-arms `loading`.
  const load = useCallback(() => {
    if (!token) return;
    adminGetFinanceOverview(token)
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token]);

  const retry = () => { setLoading(true); setError(false); load(); };

  useEffect(() => { load(); }, [load]);

  if (error) {
  
  return (
      <div className="text-center py-16">
        <Wallet className="w-10 h-10 text-text-muted mx-auto mb-3" />
        <p className="text-text-muted mb-4">Failed to load finance data.</p>
        <button onClick={retry} className="text-sm font-medium text-primary underline cursor-pointer">Try again</button>
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

  // Confirmed rather than instant: the row is a person's name, and although the
  // server refuses when anything references them, an accidental click on the
  // wrong row is still a name silently vanishing from a finance page.
  const handleRemovePartner = async (id: string, name: string) => {
    if (!token) return;
    if (!window.confirm(`Remove ${name}? They have nothing recorded against them. This cannot be undone.`)) return;
    setRemovingPartner(id);
    setPartnerError(null);
    try {
      await adminDeletePartner(token, id);
      await load();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setPartnerError(message || `Could not remove ${name}.`);
    } finally {
      setRemovingPartner(null);
    }
  };

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <StatCard
            label="Revenue"
            value={formatPrice(data.revenue)}
            hint={
              data.refunded > 0
                ? `Net of ${formatPrice(data.refunded)} refunded`
                : 'Every order the money arrived on'
            }
            icon={Wallet}
          />
          <StatCard
            label="Gross profit"
            value={formatPrice(data.grossOrderProfit)}
            hint={`From ${data.costedOrders} costed order${data.costedOrders === 1 ? '' : 's'}`}
            icon={TrendingUp}
          />
          <StatCard
            label="Operating spend"
            value={formatPrice(data.operatingSpend)}
            hint={
              data.inventoryPurchased > 0
                ? `Excludes ${formatPrice(data.inventoryPurchased)} spent on stock`
                : 'Reduces net profit only'
            }
            icon={Coins}
          />
          <StatCard
            label="Net profit"
            value={formatPrice(data.netProfit)}
            hint="Gross profit − operating spend"
            icon={Scale}
            tone={data.netProfit < 0 ? 'bad' : 'good'}
          />
        </div>
      </Animate>

      {/* The cost lines behind gross profit. Shown rather than left implied
          because two of them — the processor's cut and the goods themselves —
          were previously either missing or counted twice, and a bottom line
          nobody can take apart is a bottom line nobody can check. */}
      <Animate variant="fadeUp" delay={0.11}>
        <div className="bg-surface rounded-xl border border-border px-5 py-4 mb-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 text-sm">
            {[
              ['Costed revenue', formatPrice(data.costedRevenue), 'The part with known costs'],
              ['Goods (COGS)', `−${formatPrice(data.cogs)}`, 'What the items cost us'],
              ['Order extras', `−${formatPrice(data.extraCosts)}`, 'Courier, packaging, fuel'],
              ['Gateway fees', `−${formatPrice(data.gatewayFees)}`, 'Kept by the processor'],
            ].map(([label, value, hint]) => (
              <div key={label}>
                <p className="text-xs text-text-muted">{label}</p>
                <p className="font-medium tabular-nums mt-0.5">{value}</p>
                <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted mt-4 pt-3 border-t border-border">
            Those four are gross profit, exactly. Stock bought ahead of demand is
            <span className="text-text-secondary"> not</span> operating spend — it becomes a cost here, as
            goods, when it sells.{' '}
            {data.inventoryPurchased > 0 && (
              <>
                {formatPrice(data.inventoryPurchased)} bought,{' '}
                <span className={cn(data.stockOnHand < 0 && 'text-warning')}>
                  {formatPrice(data.stockOnHand)} still on hand
                </span>
                {data.stockOnHand < 0 && ' — more has sold than was recorded bought, so some purchases predate this system'}.
              </>
            )}
          </p>
        </div>
      </Animate>

      {data.uncostedOrders > 0 && (
        <Animate variant="fadeUp" delay={0.12}>
          <div className="bg-warning/10 border border-warning/20 rounded-xl px-5 py-3.5 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-sm text-text-secondary">
              <span className="font-medium text-text-primary">
                {data.uncostedOrders} order{data.uncostedOrders === 1 ? '' : 's'} not costed yet
                {data.uncostedRevenue > 0 && `, worth ${formatPrice(data.uncostedRevenue)}`}.
              </span>{' '}
              That revenue <span className="text-text-primary">is</span> counted above — only its profit is
              missing. Cost them on each order&rsquo;s Profit Sharing tab.
            </p>
          </div>
        </Animate>
      )}

      {/* Capital sits below the trading figures on purpose: it is money people
          put in, not money the business made, and putting it in the same row
          made a contribution look like earnings. */}
      <Animate variant="fadeUp" delay={0.13}>
        <div className="grid grid-cols-2 gap-3 mb-6">
          <StatCard
            label="Capital in"
            value={formatPrice(data.totalContributed)}
            hint="Contributed — never owed back"
            icon={Users}
          />
          <StatCard
            label="Advances outstanding"
            value={formatPrice(data.totalAdvancesOutstanding)}
            hint="Money the company still has to return"
            icon={Coins}
          />
        </div>
      </Animate>

      {/* Partners */}
      <Animate variant="fadeUp" delay={0.15}>
        <div className="bg-surface rounded-xl border border-border overflow-hidden mb-6">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="font-display font-semibold">Partners</h2>
          </div>
          {/* The server refuses to remove a partner anything still references,
              and says what — but that message was captured into state and never
              rendered, so a refused removal looked like a dead button. */}
          {partnerError && (
            <p className="px-5 py-3 bg-danger/10 border-b border-danger/20 text-sm text-danger">{partnerError}</p>
          )}

          {/* Phones get a card per partner. The table wants ~820px, so on a
              375px screen everything from "Capital fronted" rightwards — Owed
              included, which is the number this page exists to report — sat off
              the right edge behind a scrollbar. */}
          <div className="divide-y divide-border lg:hidden">
            {data.partners.map((p) => (
              <div key={p.partnerId} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/finance/partners/${p.partnerId}`}
                      className="font-medium hover:text-primary hover:underline transition-colors"
                    >
                      {p.name}
                    </Link>
                    {!p.active && <span className="ml-2 text-xs text-text-muted">inactive</span>}
                    {p.removable && (
                      <button
                        onClick={() => handleRemovePartner(p.partnerId, p.name)}
                        disabled={removingPartner === p.partnerId}
                        title={`Remove ${p.name} — nothing is recorded against them`}
                        className="ml-2 text-xs text-text-muted hover:text-danger transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {removingPartner === p.partnerId ? 'removing…' : 'remove'}
                      </button>
                    )}
                    <p className="text-xs text-text-muted mt-0.5">Owed</p>
                  </div>
                  <span className={cn(
                    'font-display text-lg font-bold tabular-nums shrink-0',
                    p.owed < 0 ? 'text-danger' : ''
                  )}>
                    {formatPrice(p.owed)}
                  </span>
                </div>

                {/* One column on phones. Two columns of label-plus-figure only
                    left ~85px per label at 375px, which wrapped "Capital
                    fronted" onto two lines and clipped "Advances outstanding".
                    Skipped entirely for a partner with nothing recorded — five
                    RM0.00 rows each is a screenful of nothing on a phone, and
                    these are usually the typo rows waiting to be removed. */}
                {(p.earned || p.capitalFronted || p.advancesOutstanding || p.paidOut || p.contributed) ? (
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs">
                    {[
                      ['Earned', formatPrice(p.earned)],
                      ['Capital fronted', formatPrice(p.capitalFronted)],
                      ['Advances outstanding', formatPrice(p.advancesOutstanding)],
                      ['Paid out', p.paidOut > 0 ? `−${formatPrice(p.paidOut)}` : formatPrice(0)],
                      ['Contributed', formatPrice(p.contributed)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-baseline justify-between gap-2">
                        <dt className="text-text-muted">{label}</dt>
                        <dd className="tabular-nums text-text-secondary">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-xs text-text-muted mt-1">Nothing recorded yet.</p>
                )}
              </div>
            ))}
          </div>

          <div className="hidden lg:block overflow-x-auto">
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
                      {/* Partners are created implicitly by typing a name into an
                          order's split, so a typo or a removed split leaves one
                          behind forever. Only offered when the server says
                          nothing references them. */}
                      {p.removable && (
                        <button
                          onClick={() => handleRemovePartner(p.partnerId, p.name)}
                          disabled={removingPartner === p.partnerId}
                          title={`Remove ${p.name} — nothing is recorded against them`}
                          className="ml-2 text-xs text-text-muted hover:text-danger transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {removingPartner === p.partnerId ? 'removing…' : 'remove'}
                        </button>
                      )}
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
                  <div key={`${a.kind}-${a.id}`} className="flex items-start gap-3 px-5 py-3">
                    {/* Fixed width so every row's text starts at the same x —
                        "Spending" and "Contribution" are very different
                        lengths, and left-aligning to the chip made the list
                        look ragged. Dropped on phones, where 96px of the 375
                        available left the description truncating to two words;
                        there it moves down onto the meta line instead. */}
                    <span
                      className={cn(
                        'hidden sm:inline-flex w-24 shrink-0 items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-medium',
                        style.chip
                      )}
                    >
                      {style.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium truncate">{a.description}</p>
                        <p className={cn('text-sm font-semibold shrink-0 tabular-nums', a.direction === 'IN' ? 'text-success' : '')}>
                          {a.direction === 'IN' ? '+' : '−'}{formatPrice(a.amount)}
                        </p>
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span
                          className={cn(
                            'sm:hidden inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium',
                            style.chip
                          )}
                        >
                          {style.label}
                        </span>
                        <span className="min-w-0">
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
                        </span>
                      </p>
                    </div>
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
