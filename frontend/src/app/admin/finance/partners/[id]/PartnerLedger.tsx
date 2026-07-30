'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, X, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetPartner, adminCreateRepayment, adminDeleteFunding,
  adminDeleteRepayment, adminDeletePayout,
} from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import { RecordMoneyDialog } from '../../RecordMoneyDialog';
import type { PartnerDetail, PartnerFunding } from '@/types';

const bpsToPercent = (bps: number) => (bps / 100).toFixed(2).replace(/\.00$/, '');
const outstandingOf = (f: PartnerFunding) =>
  Math.max(0, f.amount - f.repayments.reduce((sum, r) => sum + r.amount, 0));

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn(
        'text-sm font-medium tabular-nums',
        tone === 'good' && 'text-success',
        tone === 'bad' && 'text-danger',
        tone === 'muted' && 'text-text-muted'
      )}>
        {value}
      </span>
    </div>
  );
}

export function PartnerLedger({ partnerId }: { partnerId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [repayingId, setRepayingId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    adminGetPartner(token, partnerId)
      .then(setData)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token, partnerId]);

  useEffect(() => { load(); }, [load]);

  const apiError = (err: unknown, fallback: string) => {
    const message = err && typeof err === 'object' && 'response' in err
      ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
      : undefined;
    setError(message || fallback);
  };

  const submitRepayment = async (fundingId: string) => {
    if (!token) return;
    const cents = Math.round(Number(repayAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    setError('');
    setBusy(true);
    try {
      await adminCreateRepayment(token, {
        fundingId, amount: cents, occurredAt: new Date().toISOString().slice(0, 10),
      });
      setRepayingId(null);
      setRepayAmount('');
      load();
    } catch (err) {
      apiError(err, 'Could not record that repayment.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (fn: () => Promise<unknown>, fallback: string) => {
    if (!token) return;
    setError('');
    setBusy(true);
    try {
      await fn();
      load();
    } catch (err) {
      apiError(err, fallback);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-56 bg-surface-elevated rounded-lg" />
        <div className="h-40 bg-surface-elevated rounded-xl" />
        <div className="h-64 bg-surface-elevated rounded-xl" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="text-center py-16">
        <p className="text-text-muted mb-4">Partner not found.</p>
        <Link href="/admin/finance" className="text-primary text-sm font-medium hover:underline">Back to Finance</Link>
      </div>
    );
  }

  const { partner, balance, earnings, funding, payouts } = data;
  const advances = funding.filter((f) => f.type === 'ADVANCE');
  const contributions = funding.filter((f) => f.type === 'CONTRIBUTION');

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => router.push('/admin/finance')}
            aria-label="Back to finance"
            className="mt-1 p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold truncate">{partner.name}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {partner.active ? 'Active partner' : 'Inactive'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" /> Record money
        </button>
      </div>

      {error && <p className="text-sm text-danger mb-4">{error}</p>}

      {/* How the balance is built */}
      {balance && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Balance</p>
          <div className="max-w-md">
            <Row label="Earned from orders" value={formatPrice(balance.earned)} />
            <Row label="Expenses carried on orders" value={`−${formatPrice(balance.expenseShare)}`} tone="bad" />
            <Row label="Advances outstanding" value={formatPrice(balance.advancesOutstanding)} />
            <Row label="Profit paid out" value={`−${formatPrice(balance.paidOut)}`} tone="muted" />
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 mt-2">
              <span className="font-display font-bold">Owed</span>
              <span className={cn('font-display text-lg font-bold tabular-nums', balance.owed < 0 && 'text-danger')}>
                {formatPrice(balance.owed)}
              </span>
            </div>
            {balance.contributed > 0 && (
              <p className="text-xs text-text-muted mt-3">
                Plus {formatPrice(balance.contributed)} contributed as capital — never repaid, so it sits
                outside this sum by design.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Advances */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="font-display font-semibold text-sm">Advances</h2>
          <p className="text-xs text-text-muted mt-0.5">Money in that the company owes back</p>
        </div>
        {advances.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted text-center">No advances.</p>
        ) : (
          <div className="divide-y divide-border">
            {advances.map((f) => {
              const outstanding = outstandingOf(f);
              const settled = outstanding === 0;
              return (
                <div key={f.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.description}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {formatShortDate(f.occurredAt)} · {formatPrice(f.amount)} advanced
                        {f.expense && ' · from a company expense'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn('text-sm font-semibold tabular-nums', settled ? 'text-success' : '')}>
                        {settled ? (
                          <span className="inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Repaid</span>
                        ) : (
                          `${formatPrice(outstanding)} left`
                        )}
                      </p>
                      {!settled && f.repayments.length > 0 && (
                        <p className="text-xs text-text-muted">
                          {formatPrice(f.amount - outstanding)} repaid so far
                        </p>
                      )}
                    </div>
                  </div>

                  {!settled && (
                    repayingId === f.id ? (
                      <div className="flex items-center gap-2 mt-3">
                        <div className="relative w-36">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted">RM</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            autoFocus
                            value={repayAmount}
                            onChange={(e) => setRepayAmount(e.target.value)}
                            placeholder={(outstanding / 100).toFixed(2)}
                            aria-label="Repayment amount"
                            className="w-full pl-9 pr-2 py-1.5 border border-border rounded-lg text-sm bg-surface text-right"
                          />
                        </div>
                        <button
                          onClick={() => submitRepayment(f.id)}
                          disabled={busy}
                          className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          Record repayment
                        </button>
                        <button
                          onClick={() => { setRepayingId(null); setRepayAmount(''); }}
                          className="px-2 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setRepayingId(f.id); setRepayAmount(''); setError(''); }}
                        className="mt-2 text-xs font-medium text-primary hover:underline cursor-pointer"
                      >
                        Record a repayment
                      </button>
                    )
                  )}

                  {f.repayments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {f.repayments.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-3 text-xs text-text-muted">
                          <span>Repaid {formatShortDate(r.occurredAt)}</span>
                          <span className="flex items-center gap-2">
                            <span className="tabular-nums">{formatPrice(r.amount)}</span>
                            <button
                              onClick={() => remove(() => adminDeleteRepayment(token!, r.id), 'Could not delete that repayment.')}
                              aria-label="Delete repayment"
                              className="p-0.5 rounded hover:text-danger transition-colors cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contributions */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="font-display font-semibold text-sm">Contributions</h2>
          <p className="text-xs text-text-muted mt-0.5">Capital in, never repaid</p>
        </div>
        {contributions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted text-center">No contributions.</p>
        ) : (
          <div className="divide-y divide-border">
            {contributions.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{f.description}</p>
                  <p className="text-xs text-text-muted">{formatShortDate(f.occurredAt)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold tabular-nums">{formatPrice(f.amount)}</span>
                  {!f.expenseId && (
                    <button
                      onClick={() => remove(() => adminDeleteFunding(token!, f.id), 'Could not delete that record.')}
                      aria-label="Delete contribution"
                      className="p-1 rounded-lg text-text-muted hover:text-danger transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Earnings */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="font-display font-semibold text-sm">Earnings by order</h2>
        </div>
        {earnings.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted text-center">No orders with a split yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                  <th className="text-left px-5 py-2.5">Order</th>
                  <th className="text-left px-3 py-2.5">Date</th>
                  <th className="text-right px-3 py-2.5">Share</th>
                  <th className="text-right px-3 py-2.5">Order profit</th>
                  <th className="text-right px-5 py-2.5">Their cut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {earnings.map((e) => (
                  <tr key={e.orderId}>
                    <td className="px-5 py-2.5">
                      <Link href={`/admin/orders/${e.orderId}`} className="font-medium hover:text-primary hover:underline transition-colors">
                        {e.orderNumber}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-text-muted">{formatShortDate(e.occurredAt)}</td>
                    <td className="px-3 py-2.5 text-right text-text-secondary">{bpsToPercent(e.shareBps)}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">
                      {e.costed ? formatPrice(e.orderProfit) : <span className="text-text-muted">not costed</span>}
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                      {e.costed ? formatPrice(e.amount) : <span className="text-text-muted font-normal">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payouts */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <h2 className="font-display font-semibold text-sm">Profit paid out</h2>
        </div>
        {payouts.length === 0 ? (
          <p className="px-5 py-6 text-sm text-text-muted text-center">Nothing paid out yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm">{p.note || 'Profit payout'}</p>
                  <p className="text-xs text-text-muted">{formatShortDate(p.occurredAt)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold tabular-nums">{formatPrice(p.amount)}</span>
                  <button
                    onClick={() => remove(() => adminDeletePayout(token!, p.id), 'Could not delete that payout.')}
                    aria-label="Delete payout"
                    className="p-1 rounded-lg text-text-muted hover:text-danger transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dialogOpen && balance && (
        <RecordMoneyDialog
          partners={[balance]}
          defaultPartnerId={partner.id}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); load(); }}
        />
      )}
    </div>
  );
}
