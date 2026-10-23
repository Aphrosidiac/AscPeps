'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CreditCard, AlertTriangle, RotateCcw, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetPaymentAnalytics } from '@/lib/api';
import { formatPrice, cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import { PageHeader } from '@/components/admin/ui';
import { REASON_HINTS, REASON_LABELS, deviceText, formatMoment, gatewayName, minutesText, SOURCE_LABELS } from '@/lib/payment-trail';
import type { PaymentAnalytics } from '@/types';

/**
 * Admin → Payments: why online payments do and don't go through, from the
 * payment trail (backend admin-payments.controller.ts). Every number is a
 * count of real orders in the period; every failed order is listed with what
 * actually happened to it, and whether the same customer bought anyway.
 */

const PERIODS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
] as const;

const GATEWAYS = [
  { key: 'all', label: 'All gateways' },
  { key: 'billplz', label: 'Billplz' },
  { key: 'toyyibpay', label: 'ToyyibPay' },
] as const;

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export default function AdminPaymentsPage() {
  const { token } = useAuth();
  const [days, setDays] = useState<number>(30);
  const [gateway, setGateway] = useState<string>('all');
  const [tests, setTests] = useState(false);
  const [data, setData] = useState<PaymentAnalytics | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    adminGetPaymentAnalytics(token, { days, gateway, tests: tests ? '1' : '0' })
      .then((res) => {
        setData(res);
        setError(false);
      })
      .catch(() => setError(true));
  }, [token, days, gateway, tests]);

  useEffect(load, [load]);

  return (
    <div>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <Animate variant="fadeUp">
          <PageHeader title="Payments" className="mb-0" />
        </Animate>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={GATEWAYS.map((g) => ({ key: g.key, label: g.label }))} value={gateway} onChange={setGateway} />
          <Segmented options={PERIODS.map((p) => ({ key: String(p.days), label: p.label }))} value={String(days)} onChange={(v) => setDays(Number(v))} />
          <label className="inline-flex items-center gap-2 text-sm text-text-secondary cursor-pointer select-none px-2">
            <input type="checkbox" checked={tests} onChange={(e) => setTests(e.target.checked)} className="accent-primary" />
            Include test orders
          </label>
        </div>
      </div>

      {error && (
        <div className="text-center py-16">
          <p className="text-text-muted mb-4">Could not load payment analytics.</p>
          <button onClick={load} className="text-sm font-medium text-primary underline cursor-pointer">Try again</button>
        </div>
      )}

      {!error && !data && (
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-28 bg-surface-elevated rounded-xl" />)}
          </div>
          <div className="h-64 bg-surface-elevated rounded-xl" />
        </div>
      )}

      {!error && data && <Report data={data} />}
    </div>
  );
}

function Report({ data }: { data: PaymentAnalytics }) {
  const { totals, funnel, reasons, attempts, devices, byGateway, timing, failedOrders } = data;

  const cards = [
    { label: 'Online orders', value: totals.orders.toLocaleString(), sub: `${totals.open} still open`, icon: CreditCard },
    { label: 'Paid', value: pct(totals.paid, totals.orders), sub: `${totals.paid} orders · ${formatPrice(totals.paidAmount)}`, tone: 'good' },
    { label: 'Failed', value: totals.failed.toLocaleString(), sub: formatPrice(totals.failedAmount), icon: AlertTriangle },
    { label: 'Bought anyway', value: totals.recovered.toLocaleString(), sub: `same phone paid within 7 days · ${formatPrice(totals.recoveredAmount)}`, icon: RotateCcw },
    { label: 'Lost', value: formatPrice(totals.lostAmount), sub: `${totals.lost} order${totals.lost === 1 ? '' : 's'} never paid for`, tone: totals.lost ? 'bad' : undefined },
  ];

  const funnelRows = [
    { label: 'Orders placed', n: funnel.placed, of: funnel.placed },
    { label: 'Bill created', n: funnel.billCreated, of: funnel.placed, note: funnel.billFailed ? `${funnel.billFailed} refused by the gateway` : undefined },
    funnel.tracked
      ? {
          label: 'Opened the payment page',
          n: funnel.opened,
          of: funnel.tracked,
          note: funnel.tracked < funnel.placed ? `of the ${funnel.tracked} order${funnel.tracked === 1 ? '' : 's'} placed since visits were tracked` : undefined,
        }
      : { label: 'Opened the payment page', n: 0, of: 0, text: 'not tracked yet', note: 'Recorded for every order placed from now on' },
    { label: 'Tried to pay (chose a method)', n: funnel.attempted, of: funnel.placed },
    { label: 'Paid', n: funnel.paid, of: funnel.placed },
  ];

  return (
    <div className="space-y-8">
      <Animate variant="fadeUp" delay={0.05}>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {cards.map((c, i) => (
            <div key={c.label} className={cn('bg-surface rounded-xl border border-border p-4 sm:p-5', i === 0 && 'col-span-2 lg:col-span-1')}>
              <span className="text-xs sm:text-sm text-text-secondary">{c.label}</span>
              <p className={cn('font-display text-xl sm:text-2xl font-bold tracking-tight mt-3', c.tone === 'good' && 'text-success', c.tone === 'bad' && 'text-danger')}>
                {c.value}
              </p>
              <p className="text-xs text-text-muted mt-1">{c.sub}</p>
            </div>
          ))}
        </div>
      </Animate>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Where customers drop off" hint={data.trackingSince ? `Page visits tracked since ${formatMoment(data.trackingSince)}` : 'Page visits are tracked for orders placed from now on'}>
          <div className="space-y-4">
            {funnelRows.map((r) => (
              <Bar key={r.label} label={r.label} value={'text' in r && r.text ? r.text : `${r.n} of ${r.of}`} share={r.of ? r.n / r.of : 0} note={r.note} />
            ))}
          </div>
        </Panel>

        <Panel title="Why payments failed" hint="Each failed order counted once, by the reason recorded when it was released">
          {reasons.length === 0 ? (
            <Empty>No failed payments in this period.</Empty>
          ) : (
            <div className="space-y-4">
              {reasons.map((r) => (
                <div key={r.reason}>
                  <Bar
                    label={REASON_LABELS[r.reason] ?? r.reason}
                    value={`${r.orders} · ${formatPrice(r.amount)}`}
                    share={totals.failed ? r.orders / totals.failed : 0}
                    tone="bad"
                    note={`${r.recovered} bought anyway · ${r.lost} lost (${formatPrice(r.lostAmount)})`}
                  />
                  <p className="text-xs text-text-muted mt-1">{REASON_HINTS[r.reason]}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel
          title="Payment attempts by channel"
          hint={`${attempts.total} attempt${attempts.total === 1 ? '' : 's'} · ${attempts.failureRate == null ? '—' : `${Math.round(attempts.failureRate * 100)}%`} failed · ${attempts.paidAfterRetry} paid only after a failed try`}
        >
          {attempts.byChannel.length === 0 ? (
            <Empty>No attempts in this period.</Empty>
          ) : (
            <Table
              head={['Channel', 'Attempts', 'Paid', 'Failed', 'No result', 'Success']}
              rows={attempts.byChannel.map((c) => [c.channel, c.attempts, c.completed, c.failed, c.pending, pct(c.completed, c.attempts)])}
            />
          )}
        </Panel>

        <Panel title="By device at checkout" hint="From the browser that placed the order. In-app browsers (Instagram, TikTok…) are listed on their own.">
          <Table
            head={['Device', 'Orders', 'Paid', 'Failed', 'Open']}
            rows={devices.map((d) => [d.device, d.orders, `${d.paid} (${pct(d.paid, d.orders)})`, d.failed, d.open])}
          />
        </Panel>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="By gateway">
          <Table
            head={['Gateway', 'Orders', 'Paid', 'Failed', 'Paid RM']}
            rows={byGateway.map((g) => [g.gateway === 'none' ? 'No bill' : gatewayName(g.gateway), g.orders, `${g.paid} (${pct(g.paid, g.orders)})`, g.failed, formatPrice(g.paidAmount)])}
          />
        </Panel>
        <Panel title="Timing">
          <div className="space-y-3 text-sm">
            <Line icon={Clock} label="Order to paid (median)" value={minutesText(timing.medianMinutesToPay)} />
            <Line icon={Clock} label="Order to opening the payment page (median)" value={minutesText(timing.medianMinutesToFirstOpen)} />
            <Line icon={Clock} label="Paid first try / after a failed try" value={`${attempts.paidFirstTry} / ${attempts.paidAfterRetry}`} />
          </div>
        </Panel>
      </div>

      <Panel title={`Every failed payment (${failedOrders.length})`} hint="Newest first. Open an order for its full trail.">
        {failedOrders.length === 0 ? (
          <Empty>None in this period.</Empty>
        ) : (
          <div className="overflow-x-auto -mx-5 sm:mx-0">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border">
                  <th className="py-2 px-3 font-medium">Order</th>
                  <th className="py-2 px-3 font-medium">Placed</th>
                  <th className="py-2 px-3 font-medium text-right">Total</th>
                  <th className="py-2 px-3 font-medium">What happened</th>
                  <th className="py-2 px-3 font-medium">Page</th>
                  <th className="py-2 px-3 font-medium">Device</th>
                  <th className="py-2 px-3 font-medium">Afterwards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {failedOrders.map((f) => (
                  <tr key={f.id} className="align-top hover:bg-surface-elevated/50">
                    <td className="py-2.5 px-3">
                      <Link href={`/admin/orders/${f.id}`} className="font-medium text-primary hover:underline whitespace-nowrap">
                        {f.orderNumber}
                      </Link>
                      <div className="text-xs text-text-muted">{f.customerName}{f.isTest ? ' · test' : ''}</div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-text-secondary whitespace-nowrap">
                      {formatMoment(f.createdAt)}
                      <div className="text-text-muted">{f.gateway ? gatewayName(f.gateway) : 'No bill'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap">{formatPrice(f.total)}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium">{REASON_LABELS[f.reason] ?? f.reason}</div>
                      <div className="text-xs text-text-muted">
                        {[
                          f.attempts.failed ? `${f.attempts.failed} failed` : null,
                          f.attempts.pending ? `${f.attempts.pending} no result` : null,
                          f.attempts.channels.length ? f.attempts.channels.join(', ') : null,
                          f.returns ? `came back ${f.returns}×${f.lastReturnPaid === 'false' ? ' (not paid)' : ''}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'no attempts'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-text-secondary">
                      {f.tracked
                        ? f.opens
                          ? `Opened ${f.opens}× from ${f.openSources.map((s) => SOURCE_LABELS[s] ?? s).join(', ')}`
                          : 'Never opened'
                        : <span className="text-text-muted">not tracked</span>}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-text-secondary">{f.device ? deviceText(f.device) : <span className="text-text-muted">not recorded</span>}</td>
                    <td className="py-2.5 px-3 text-xs">
                      {f.recoveredBy ? (
                        <Link href={`/admin/orders/${f.recoveredBy.id}`} className="text-success hover:underline">
                          Bought {f.recoveredBy.orderNumber} ({formatPrice(f.recoveredBy.total)},{' '}
                          {f.recoveredBy.method === 'WHATSAPP' ? 'WhatsApp' : gatewayName(f.recoveredBy.gateway)}) {f.recoveredBy.hoursLater} h later
                        </Link>
                      ) : (
                        <span className="text-danger font-medium">Lost</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Segmented({ options, value, onChange }: { options: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 bg-surface rounded-lg border border-border p-1">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'px-3 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer whitespace-nowrap',
            value === o.key ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-elevated'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Animate variant="fadeUp" delay={0.1}>
      <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 h-full">
        <h2 className="font-display font-semibold text-lg">{title}</h2>
        {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </Animate>
  );
}

function Bar({ label, value, share, note, tone }: { label: string; value: string; share: number; note?: string; tone?: 'bad' }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-text-secondary tabular-nums whitespace-nowrap">
          {value} <span className="text-text-muted">({Math.round(share * 100)}%)</span>
        </span>
      </div>
      <div className="h-2.5 bg-surface-elevated rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', tone === 'bad' ? 'bg-danger/70' : 'bg-primary')} style={{ width: `${Math.min(share * 100, 100)}%` }} />
      </div>
      {note && <p className="text-xs text-text-muted mt-1">{note}</p>}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-muted uppercase tracking-wider border-b border-border">
            {head.map((h, i) => (
              <th key={h} className={cn('py-2 pr-3 font-medium', i > 0 && 'text-right')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, i) => (
                <td key={i} className={cn('py-2 pr-3', i > 0 ? 'text-right tabular-nums' : 'font-medium')}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Line({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-text-secondary">
        <Icon className="w-4 h-4 text-text-muted" />
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-text-muted py-6 text-center">{children}</p>;
