'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Minus, Scale, Trash2, CheckCircle2, Download } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminDeleteBankCheck, adminDeleteBankEntry, adminGetBankLedger } from '@/lib/api';
import { formatShortDate, cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/admin/ui';
import { ConfirmDialog } from '@/components/admin/Dialog';
import { Button } from '@/components/ui/Button';
import type { BankLedger, BankMovement, BankSource } from '@/types';
import { PeriodPicker, periodRange, signedPrice, SOURCE, apiError, type PeriodKey, rm } from '../../money-ui';
import { BankEntryDialog, CheckBalanceDialog, OpeningBalanceForm } from '../../bank-dialogs';

const FILTERS: { key: string; label: string; sources: BankSource[] }[] = [
  { key: 'all', label: 'All', sources: [] },
  { key: 'sales', label: 'Sales', sources: ['SALE', 'REFUND'] },
  { key: 'shares', label: 'Profit shares', sources: ['PAYOUT'] },
  { key: 'spend', label: 'Stock & bills', sources: ['EXPENSE'] },
  { key: 'partners', label: 'Partners', sources: ['CAPITAL', 'REPAYMENT'] },
  { key: 'other', label: 'Other', sources: ['OPENING', 'MONEY_IN', 'MONEY_OUT'] },
];

/** Where a movement is recorded, so its row can open it. */
function hrefFor(m: BankMovement): string | null {
  switch (m.ref.type) {
    case 'order': return `/admin/orders/${m.ref.id}`;
    case 'expense': return '/admin/money/expenses';
    case 'payout_run': return `/admin/money/share#run-${m.ref.id}`;
    default: return null;
  }
}

export default function BankPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState<BankLedger | null>(null);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<'in' | 'out' | 'check' | null>(null);
  const [removing, setRemoving] = useState<{ kind: 'entry' | 'check'; id: string; label: string; opening?: boolean } | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    const { from, to } = periodRange(period);
    adminGetBankLedger(token, { from, to })
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true));
  }, [token, period]);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const f = FILTERS.find((x) => x.key === filter)!;
    return f.sources.length ? data.movements.filter((m) => f.sources.includes(m.source)) : data.movements;
  }, [data, filter]);

  const exportCsv = () => {
    if (!data) return;
    const lines = [['Date', 'Kind', 'Description', 'Who', 'In', 'Out', 'Balance']];
    for (const m of [...data.movements].reverse()) {
      lines.push([
        m.occurredAt.slice(0, 10),
        SOURCE[m.source].label,
        m.description,
        m.partnerName ?? '',
        m.amount > 0 ? (m.amount / 100).toFixed(2) : '',
        m.amount < 0 ? (-m.amount / 100).toFixed(2) : '',
        (m.balance / 100).toFixed(2),
      ]);
    }
    const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ascend-bank-${periodRange(period).label.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error && !data) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-text-secondary mb-3">Could not load the bank.</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!data) return <div className="h-72 rounded-[10px] bg-surface-elevated animate-pulse" />;

  if (!data.started) {
    return (
      <Card className="p-5 sm:p-6">
        <OpeningBalanceForm onSaved={load} />
      </Card>
    );
  }

  const range = periodRange(period);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-text-secondary">
        {data.lastCheck ? (
          data.lastCheck.difference === 0 ? (
            <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="w-4 h-4" /> Matched the bank statement on {formatShortDate(data.lastCheck.checkedAt)}</span>
          ) : (
            <span className="text-amber-700">Last statement check ({formatShortDate(data.lastCheck.checkedAt)}) was off by {signedPrice(data.lastCheck.difference)}</span>
          )
        ) : (
          <span>Not checked against the bank statement yet.</span>
        )}
        <span aria-hidden="true">·</span>
        <span>Tracked since {formatShortDate(data.startedAt as string)}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialog('in')}><Plus className="w-3.5 h-3.5" /> Money in</Button>
          <Button variant="outline" size="sm" onClick={() => setDialog('out')}><Minus className="w-3.5 h-3.5" /> Money out</Button>
          <Button variant="outline" size="sm" onClick={() => setDialog('check')}><Scale className="w-3.5 h-3.5" /> Check balance</Button>
          <Button variant="ghost" size="sm" onClick={exportCsv} title="Download CSV"><Download className="w-3.5 h-3.5" /> CSV</Button>
        </div>
      </div>

      {/* Start + in − out = end, so the four cards add up on their own. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label={period === 'all' ? 'Opening balance' : `Start of ${range.label}`} value={signedPrice(data.flows.opening)} />
        <Stat label="Money in" value={`+${rm(data.flows.moneyIn)}`} tone={data.flows.moneyIn > 0 ? 'good' : undefined} />
        <Stat label="Money out" value={`−${rm(data.flows.moneyOut)}`} />
        <Stat
          label={period === 'all' ? 'Balance now' : `End of ${range.label}`}
          value={signedPrice(data.flows.closing)}
          strong
          tone={data.flows.closing < 0 ? 'bad' : undefined}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 sm:px-6 py-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-[13px] font-medium transition-colors cursor-pointer',
                  filter === f.key ? 'bg-text-primary text-surface' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPicker value={period} onChange={setPeriod} />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-6 text-[14px] text-text-secondary">Nothing here for {range.label.toLowerCase()}.</p>
        ) : (
          <>
            {/* Phones: one block per movement. */}
            <ul className="divide-y divide-border sm:hidden">
              {rows.map((m) => (
                <li key={m.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] break-words">{m.partnerName ? `${m.partnerName} · ${m.description}` : m.description}</p>
                      <p className="text-[12px] text-text-secondary">{SOURCE[m.source].label} · {formatShortDate(m.occurredAt)} · <span className="whitespace-nowrap">balance {signedPrice(m.balance)}</span></p>
                    </div>
                    <span className={cn('shrink-0 text-[14px] font-semibold tabular-nums whitespace-nowrap', m.amount > 0 && 'text-success')}>
                      {m.amount > 0 ? '+' : '−'}{rm(Math.abs(m.amount))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                    <th className="px-6 py-2.5 text-left font-medium w-[110px]">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium">Movement</th>
                    <th className="px-3 py-2.5 text-right font-medium w-[120px]">In</th>
                    <th className="px-3 py-2.5 text-right font-medium w-[120px]">Out</th>
                    <th className="px-3 py-2.5 text-right font-medium w-[130px]">Balance</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((m) => {
                    const href = hrefFor(m);
                    const label = m.partnerName ? `${m.partnerName} · ${m.description}` : m.description;
                    return (
                      <tr key={m.key} className="hover:bg-surface-elevated/60">
                        <td className="px-6 py-2.5 text-text-secondary whitespace-nowrap">{formatShortDate(m.occurredAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', SOURCE[m.source].chip)}>{SOURCE[m.source].label}</span>
                            {href ? (
                              <Link href={href} className="truncate hover:text-primary hover:underline">{label}</Link>
                            ) : (
                              <span className="truncate">{label}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-success">{m.amount > 0 ? rm(m.amount) : ''}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{m.amount < 0 ? rm(-m.amount) : ''}</td>
                        <td className={cn('px-3 py-2.5 text-right tabular-nums font-medium', m.balance < 0 && 'text-danger')}>{signedPrice(m.balance)}</td>
                        <td className="pr-4 text-right">
                          {m.ref.type === 'bank_entry' && (
                            <button
                              type="button"
                              onClick={() => { setRemoveError(null); setRemoving({ kind: 'entry', id: m.ref.id, label: m.description, opening: m.source === 'OPENING' }); }}
                              aria-label={`Delete ${m.description}`}
                              className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Statement checks" description="Each time someone compared this page with the bank app." />
        {data.checks.length === 0 ? (
          <p className="px-6 py-5 text-[14px] text-text-secondary">No checks yet. Use Check balance above whenever you open the bank app.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-6 py-3">
                {c.difference === 0 ? <CheckCircle2 className="w-4 h-4 text-success shrink-0" /> : <Scale className="w-4 h-4 text-amber-700 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px]">
                    Bank {signedPrice(c.statementBalance)} · here {signedPrice(c.bookBalance)}
                    {c.difference !== 0 && <span className="text-amber-700"> · off {signedPrice(c.difference)}</span>}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {formatShortDate(c.checkedAt)}{c.createdBy ? ` · ${c.createdBy}` : ''}{c.note ? ` · ${c.note}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setRemoveError(null); setRemoving({ kind: 'check', id: c.id, label: 'this check' }); }}
                  aria-label="Delete check"
                  className="p-1.5 rounded-md text-text-muted hover:text-danger hover:bg-danger/10 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-[13px] text-text-secondary">
        Paid orders, refunds, payouts, repayments and expenses Ascend paid appear here on their own. Crypto stays out until it is cashed in.
      </p>

      {dialog === 'in' && <BankEntryDialog direction="in" onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'out' && <BankEntryDialog direction="out" onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'check' && <CheckBalanceDialog bookBalance={data.balance} onClose={() => setDialog(null)} onSaved={load} />}
      {removing && (
        <ConfirmDialog
          title={removing.kind === 'entry' ? `Delete “${removing.label}”?` : 'Delete this check?'}
          body={
            removing.kind === 'check'
              ? 'Only the record of the check goes; the balance does not change.'
              : removing.opening
                ? 'This stops tracking the bank: every movement disappears from this page until an opening balance is entered again. Nothing else is deleted.'
                : 'The balance changes by its amount.'
          }
          confirmLabel="Delete"
          tone="danger"
          error={removeError}
          onConfirm={async () => {
            if (!token) return false;
            try {
              if (removing.kind === 'entry') await adminDeleteBankEntry(token, removing.id);
              else await adminDeleteBankCheck(token, removing.id);
              load();
            } catch (err) {
              setRemoveError(apiError(err, 'Could not delete.'));
              return false;
            }
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint, strong, tone }: { label: string; value: string; hint?: string; strong?: boolean; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[12px] text-text-secondary truncate">{label}</p>
      <p
        className={cn(
          'mt-0.5 font-display tabular-nums font-bold',
          strong ? 'text-[22px] leading-7' : 'text-[17px] leading-6',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-danger',
          tone === 'warn' && 'text-amber-700'
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[12px] text-text-muted">{hint}</p>}
    </Card>
  );
}
