'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Landmark, Scale, AlertTriangle, CheckCircle2, ClipboardList, Truck, Plus, Minus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetMoneyOverview } from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/admin/ui';
import { Button } from '@/components/ui/Button';
import type { MoneyOverview } from '@/types';
import { PeriodPicker, periodRange, signedPrice, SOURCE, SplitBar, SplitLegend, type PeriodKey } from '../money-ui';
import { BankEntryDialog, CheckBalanceDialog, OpeningBalanceForm } from '../bank-dialogs';

export default function MoneyOverviewPage() {
  const { token } = useAuth();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [data, setData] = useState<MoneyOverview | null>(null);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<'in' | 'out' | 'check' | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    const { from, to } = periodRange(period);
    adminGetMoneyOverview(token, { from, to })
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true));
  }, [token, period]);

  useEffect(() => { load(); }, [load]);

  if (error && !data) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-text-secondary mb-3">Could not load Ascend Money.</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-3 animate-pulse">
        <div className="h-48 rounded-[10px] bg-surface-elevated lg:col-span-2" />
        <div className="h-48 rounded-[10px] bg-surface-elevated" />
        <div className="h-64 rounded-[10px] bg-surface-elevated lg:col-span-3" />
      </div>
    );
  }

  const { bank, period: p } = data;
  const range = periodRange(period);
  // Someone with nothing owed and nothing ever earned (a stray typo partner) is noise here.
  const peopleOwed = data.partners.filter((x) => x.owed !== 0 || x.earned !== 0);

  // What needs a person, each a link straight to the fix.
  const needs: { icon: React.ReactNode; text: React.ReactNode; href: string }[] = [];
  if (!bank.started) needs.push({ icon: <Landmark className="w-4 h-4" />, text: 'Enter the bank’s opening balance to start tracking it', href: '#bank' });
  if (data.readyToShare.orders > 0) {
    needs.push({
      icon: <ArrowRight className="w-4 h-4" />,
      text: <>{data.readyToShare.orders} order{data.readyToShare.orders === 1 ? '' : 's'} ready to share — {formatPrice(data.readyToShare.total)} to pay out</>,
      href: '/admin/money/share',
    });
  }
  if (data.waiting.needsCosting > 0) {
    needs.push({
      icon: <ClipboardList className="w-4 h-4" />,
      text: <>{data.waiting.needsCosting} paid order{data.waiting.needsCosting === 1 ? '' : 's'} still need costing — their profit is unknown</>,
      href: '/admin/money/share',
    });
  }
  if (data.waiting.needsSplit > 0) {
    needs.push({
      icon: <ClipboardList className="w-4 h-4" />,
      text: <>{data.waiting.needsSplit} order{data.waiting.needsSplit === 1 ? '' : 's'} with a split that needs fixing</>,
      href: '/admin/money/share',
    });
  }
  if (bank.started && (bank.daysSinceCheck === null || bank.daysSinceCheck >= 14)) {
    needs.push({
      icon: <Scale className="w-4 h-4" />,
      text: bank.daysSinceCheck === null ? 'Check the balance against the bank statement' : `Last checked against the statement ${bank.daysSinceCheck} days ago`,
      href: '#check',
    });
  }
  if (bank.started && bank.balance < 0) {
    needs.push({ icon: <AlertTriangle className="w-4 h-4" />, text: 'The bank balance is below zero — a movement is probably missing', href: '/admin/money/bank' });
  }

  return (
    <div className="space-y-5">
      {/* ---------------- bank + ready to share */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card id="bank" className="lg:col-span-2">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-text-secondary flex items-center gap-1.5">
                  <Landmark className="w-4 h-4" /> Ascend’s bank
                </p>
                {bank.started ? (
                  <>
                    <p className={cn('mt-1 font-display text-[34px] leading-[40px] font-bold tabular-nums tracking-[-0.02em]', bank.balance < 0 && 'text-danger')}>
                      {signedPrice(bank.balance)}
                    </p>
                    <p className="mt-1 text-[13px] text-text-secondary">
                      Tracked since {formatShortDate(bank.startedAt as string)}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[15px] text-text-secondary">Not tracked yet.</p>
                )}
              </div>
              {bank.started && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDialog('in')}><Plus className="w-3.5 h-3.5" /> Money in</Button>
                  <Button variant="outline" size="sm" onClick={() => setDialog('out')}><Minus className="w-3.5 h-3.5" /> Money out</Button>
                  <Button variant="outline" size="sm" onClick={() => setDialog('check')}><Scale className="w-3.5 h-3.5" /> Check balance</Button>
                </div>
              )}
            </div>

            {bank.started ? (
              <>
                <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
                  <Mini label="Money in" value={formatPrice(bank.flows.moneyIn)} hint={range.label} tone="good" />
                  <Mini label="Money out" value={formatPrice(bank.flows.moneyOut)} hint={range.label} />
                  <Mini
                    label="Statement"
                    value={
                      bank.lastCheck ? (
                        bank.lastCheck.difference === 0 ? (
                          <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="w-4 h-4" /> Matches</span>
                        ) : (
                          <span className="text-warning">Off by {signedPrice(bank.lastCheck.difference)}</span>
                        )
                      ) : (
                        <span className="text-text-secondary">Not checked</span>
                      )
                    }
                    hint={bank.lastCheck ? formatShortDate(bank.lastCheck.checkedAt) : undefined}
                  />
                </div>
              </>
            ) : (
              <div className="mt-4 border-t border-border pt-4">
                <OpeningBalanceForm onSaved={load} />
              </div>
            )}
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="p-5 sm:p-6 flex-1">
            <p className="text-[13px] font-medium text-text-secondary">Ready to share</p>
            <p className="mt-1 font-display text-[28px] leading-[34px] font-bold tabular-nums tracking-[-0.02em]">
              {formatPrice(data.readyToShare.total)}
            </p>
            <p className="text-[13px] text-text-secondary">
              {data.readyToShare.orders === 0
                ? 'Nothing waiting — every finished order is shared'
                : `${data.readyToShare.orders} finished order${data.readyToShare.orders === 1 ? '' : 's'}`}
            </p>
            {data.readyToShare.orders > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
                {data.readyToShare.people.map((x) => (
                  <li key={x.partnerId} className="flex justify-between text-[14px]">
                    <span>{x.name}</span>
                    <span className="tabular-nums font-medium">{formatPrice(x.amount)}</span>
                  </li>
                ))}
                {data.readyToShare.ascend !== 0 && (
                  <li className="flex justify-between text-[14px] text-text-secondary">
                    <span>Ascend keeps</span>
                    <span className="tabular-nums">{formatPrice(data.readyToShare.ascend)}</span>
                  </li>
                )}
              </ul>
            )}
          </div>
          <div className="border-t border-border px-5 py-3">
            <Link href="/admin/money/share" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-primary hover:underline">
              {data.readyToShare.orders > 0 ? 'Share out' : 'Profit sharing'} <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Card>
      </div>

      {/* ---------------- needs you */}
      {needs.length > 0 && (
        <Card>
          <CardHeader title="Needs you" />
          <ul className="divide-y divide-border">
            {needs.map((n, i) => (
              <li key={i}>
                {n.href === '#check' ? (
                  <button type="button" onClick={() => setDialog('check')} className="flex w-full items-center gap-3 px-6 py-3 text-left text-[14px] hover:bg-surface-elevated cursor-pointer">
                    <span className="text-warning">{n.icon}</span>
                    <span className="flex-1">{n.text}</span>
                    <ArrowRight className="w-4 h-4 text-text-muted" />
                  </button>
                ) : (
                  <Link href={n.href} className="flex items-center gap-3 px-6 py-3 text-[14px] hover:bg-surface-elevated">
                    <span className="text-warning">{n.icon}</span>
                    <span className="flex-1">{n.text}</span>
                    <ArrowRight className="w-4 h-4 text-text-muted" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---------------- P&L + people */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Profit"
            description={`${range.label} · by when the money arrived`}
            actions={<PeriodPicker value={period} onChange={setPeriod} />}
            className="flex-wrap"
          />
          <div className="px-6 py-4">
            <Line label="Revenue" value={formatPrice(p.revenue)} hint={p.refunded > 0 ? `after ${formatPrice(p.refunded)} refunded` : undefined} strong />
            {p.uncostedRevenue > 0 && (
              <p className="text-[13px] text-warning -mt-1 mb-2">
                {formatPrice(p.uncostedRevenue)} of it from {p.uncostedOrders} order{p.uncostedOrders === 1 ? '' : 's'} not costed yet — profit below leaves them out
              </p>
            )}
            <Line label="Goods" value={`−${formatPrice(p.cogs)}`} muted />
            <Line label="Courier, packaging & other order costs" value={`−${formatPrice(p.extraCosts)}`} muted />
            <Line label="Payment gateway fees" value={`−${formatPrice(p.gatewayFees)}`} muted />
            <Line label="Profit from orders" value={signedPrice(p.grossOrderProfit)} strong divider />
            <Line label="Running costs" value={`−${formatPrice(p.operatingSpend)}`} muted />
            <Line label="Net profit" value={signedPrice(p.netProfit)} strong divider tone={p.netProfit < 0 ? 'bad' : 'good'} />
            {(p.earnedByPerson.length > 0 || p.ascendKept !== 0) && (
              <div className="mt-4 rounded-lg bg-surface-elevated px-4 py-3">
                <p className="text-[12px] font-medium uppercase tracking-wider text-text-muted mb-1.5">Profit from orders, split</p>
                {p.earnedByPerson.map((x) => (
                  <Line key={x.partnerId} label={x.name} value={signedPrice(x.earned)} compact />
                ))}
                {p.ascendKept !== 0 && <Line label="Ascend keeps" value={signedPrice(p.ascendKept)} compact muted />}
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Owed now"
            description="Not shared yet, plus open advances"
            actions={<Link href="/admin/money/partners" className="text-[13px] font-medium text-primary hover:underline">Partners</Link>}
          />
          <ul className="divide-y divide-border">
            {peopleOwed.map((x) => (
              <li key={x.partnerId}>
                <Link href={`/admin/money/partners/${x.partnerId}`} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-surface-elevated">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium truncate">{x.name}</p>
                    <p className="text-[12px] text-text-secondary">
                      {formatPrice(x.toShare)} to share
                      {x.advancesOutstanding > 0 && <> · {formatPrice(x.advancesOutstanding)} advanced</>}
                    </p>
                  </div>
                  <span className={cn('font-display text-[17px] font-bold tabular-nums', x.owed < 0 && 'text-danger')}>{signedPrice(x.owed)}</span>
                </Link>
              </li>
            ))}
            {data.ascend && (
              <li className="flex items-center justify-between gap-3 px-6 py-3">
                <div>
                  <p className="text-[15px] font-medium">Ascend</p>
                  <p className="text-[12px] text-text-secondary">Its share, kept in the bank</p>
                </div>
                <span className="font-display text-[17px] font-bold tabular-nums text-success">{signedPrice(data.ascend.retained)}</span>
              </li>
            )}
          </ul>
          {data.splitRule && (
            <div className="border-t border-border px-6 py-4">
              <p className="text-[12px] font-medium uppercase tracking-wider text-text-muted mb-2">Default split now</p>
              <SplitBar shares={data.splitRule.shares} />
              <SplitLegend shares={data.splitRule.shares} />
              {data.nextSplitRule && (
                <p className="mt-2 text-[13px] text-text-secondary">
                  From {formatShortDate(data.nextSplitRule.effectiveFrom)}:{' '}
                  {data.nextSplitRule.shares.map((s) => `${s.name} ${s.shareBps / 100}%`).join(' · ')}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ---------------- recent bank movements */}
      {bank.started && (
        <Card>
          <CardHeader
            title="Recent bank activity"
            actions={<Link href="/admin/money/bank" className="text-[13px] font-medium text-primary hover:underline">All movements</Link>}
          />
          {bank.recent.length === 0 ? (
            <p className="px-6 py-5 text-[14px] text-text-secondary">Nothing has moved since the opening balance.</p>
          ) : (
            <ul className="divide-y divide-border">
              {bank.recent.map((m) => (
                <li key={m.key} className="flex items-center gap-3 px-6 py-3">
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', SOURCE[m.source].chip)}>{SOURCE[m.source].label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] truncate">{m.partnerName ? `${m.partnerName} · ${m.description}` : m.description}</p>
                    <p className="text-[12px] text-text-secondary">{formatShortDate(m.occurredAt)}</p>
                  </div>
                  <span className={cn('shrink-0 text-[14px] font-semibold tabular-nums', m.amount > 0 && 'text-success')}>
                    {m.amount > 0 ? '+' : '−'}{formatPrice(Math.abs(m.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {data.waiting.onTheWay > 0 && (
        <p className="flex items-center gap-2 text-[13px] text-text-secondary">
          <Truck className="w-4 h-4" /> {data.waiting.onTheWay} costed order{data.waiting.onTheWay === 1 ? ' is' : 's are'} still on the way — they join the share-out once delivered.
        </p>
      )}

      {dialog === 'in' && <BankEntryDialog direction="in" onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'out' && <BankEntryDialog direction="out" onClose={() => setDialog(null)} onSaved={load} />}
      {dialog === 'check' && <CheckBalanceDialog bookBalance={bank.balance} onClose={() => setDialog(null)} onSaved={load} />}
    </div>
  );
}

function Mini({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'good' }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-text-secondary truncate">{label}</p>
      <p className={cn('mt-0.5 text-[15px] font-semibold tabular-nums', tone === 'good' && 'text-success')}>{value}</p>
      {hint && <p className="text-[12px] text-text-muted">{hint}</p>}
    </div>
  );
}

function Line({
  label, value, hint, strong, muted, divider, tone, compact,
}: {
  label: string; value: string; hint?: string; strong?: boolean; muted?: boolean; divider?: boolean; tone?: 'good' | 'bad'; compact?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4', compact ? 'py-0.5' : 'py-1.5', divider && 'mt-1 border-t border-border pt-2.5')}>
      <span className={cn('text-[14px]', muted ? 'text-text-secondary' : 'text-text-primary', strong && 'font-medium')}>
        {label}
        {hint && <span className="ml-1.5 text-[12px] text-text-muted">{hint}</span>}
      </span>
      <span
        className={cn(
          'tabular-nums text-[14px]',
          strong && 'font-semibold',
          muted && 'text-text-secondary',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-danger'
        )}
      >
        {value}
      </span>
    </div>
  );
}
