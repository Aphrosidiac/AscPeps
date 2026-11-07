'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnalyticsReport, MonthReport } from './types';
import { DailyChart, SeriesToggle, type Series } from './DailyChart';
import { TrendChart, TrendLegend } from './TrendChart';
import { Change, Chip, Label, Meter, Panel, PillButton, Quiet, Stat, Stats, TableScroll, Td, Th, changePct, rm, rm0 } from './parts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PAYMENT_LABELS: Record<string, string> = { BILLPLZ: 'Online', billplz: 'Billplz', toyyibpay: 'ToyyibPay', WHATSAPP: 'WhatsApp', CRYPTO: 'Bitcoin', btcpay: 'Bitcoin' };
const TYPE_LABELS: Record<string, string> = { ORDER: 'Regular orders', PRE_ORDER: 'Pre-orders', GROUP_BUY: 'Group Buy' };
/** Past a quarter a bar a day stops being readable, so the chart turns monthly. */
const MAX_DAILY_DAYS = 100;
/** The figures and the chart share one screen: never squashed below this, never past the window. */
const MIN_FIRST_SCREEN = 420;
const BOTTOM_GAP = 16;
const DESKTOP = '(min-width: 1024px)';

type SortKey = 'month' | 'revenue' | 'orders' | 'avgOrder' | 'newBuyers' | 'returning' | 'contribution' | 'margin' | 'spend' | 'net';

const COLUMNS: { key: SortKey; label: string; right: boolean; value: (m: MonthReport) => number | string }[] = [
  { key: 'month', label: 'Month', right: false, value: (m) => m.month },
  { key: 'revenue', label: 'Revenue', right: true, value: (m) => m.revenue },
  { key: 'orders', label: 'Orders', right: true, value: (m) => m.orders.paid },
  { key: 'avgOrder', label: 'Avg order', right: true, value: (m) => m.avgOrder },
  { key: 'newBuyers', label: 'New', right: true, value: (m) => m.customers.newBuyers },
  { key: 'returning', label: 'Returning', right: true, value: (m) => m.customers.returningSharePct },
  { key: 'contribution', label: 'Profit', right: true, value: (m) => m.pnl.contribution },
  { key: 'margin', label: 'Margin', right: true, value: (m) => m.pnl.marginPct ?? -Infinity },
  { key: 'spend', label: 'Spend', right: true, value: (m) => m.pnl.operatingSpend },
  { key: 'net', label: 'Net', right: true, value: (m) => m.pnl.netAfterSpend },
];

export function downloadMonthsCsv(months: MonthReport[], stamp: string) {
  const header = ['Month', 'Revenue (RM)', 'Refunded (RM)', 'Placed', 'Paid', 'Failed', 'Avg order (RM)', 'Units', 'New customers', 'Returning customers', 'Returning revenue %', 'Costed revenue (RM)', 'Uncosted orders', 'Goods (RM)', 'Courier and extras (RM)', 'Gateway fees (RM)', 'Affiliate (RM)', 'Profit (RM)', 'Margin %', 'Operating spend (RM)', 'Net (RM)', 'Stock bought (RM)'];
  const money = (c: number) => (c / 100).toFixed(2);
  const rows = months.map((m) => [
    m.month, money(m.revenue), money(m.refunded), m.orders.placed, m.orders.paid, m.orders.failed, money(m.avgOrder), m.units, m.customers.newBuyers, m.customers.returningBuyers, m.customers.returningSharePct,
    money(m.pnl.costedRevenue), m.pnl.uncostedOrders, money(m.pnl.itemCost), money(m.pnl.extraCost), money(m.pnl.gatewayFees), money(m.pnl.affiliateCommissions), money(m.pnl.contribution), m.pnl.marginPct ?? '', money(m.pnl.operatingSpend), money(m.pnl.netAfterSpend), money(m.pnl.inventoryBought),
  ]);
  const url = URL.createObjectURL(new Blob([[header, ...rows].map((r) => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ascend-analytics-by-month-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Ledger({ report, active, onOpen }: { report: AnalyticsReport; active: MonthReport; onOpen: (month: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'month', desc: true });
  const { months } = report;

  const rows = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key) ?? COLUMNS[0];
    return [...months].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      const order = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -order : order;
    });
  }, [months, sort]);

  const previousOf = (m: MonthReport) => months.find((p) => p.month < m.month);
  const best = months.filter((m) => !m.partial && m.orders.paid > 0).reduce<MonthReport | null>((a, b) => (!a || b.revenue > a.revenue ? b : a), null);

  return (
    <Panel
      eyebrow="Every month"
      title="Month by month"
      description="Sort by any column. Open a month to report on it."
      flush
      actions={
        <PillButton onClick={() => downloadMonthsCsv(rows, report.currentMonth)}>
          <Download className="h-4 w-4" />
          CSV
        </PillButton>
      }
    >
      <TableScroll
        head={COLUMNS.map((c) => (
          <Th key={c.key} right={c.right} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
            <button
              type="button"
              onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
              className={cn('cursor-pointer uppercase hover:text-text-primary', sort.key === c.key && 'text-text-primary')}
            >
              {c.label}
              {sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
            </button>
          </Th>
        ))}
      >
        {rows.map((m) => {
          const before = previousOf(m);
          return (
            <tr key={m.month} onClick={() => onOpen(m.month)} className={cn('cursor-pointer transition-colors duration-100 hover:bg-surface-elevated', m.month === active.month && 'bg-surface-elevated')}>
              <Td className="font-medium">
                <span className="inline-flex items-center gap-2">
                  {m.label}
                  {m.partial && <Chip tone="info">To date</Chip>}
                  {best?.month === m.month && <Chip tone="good">Best</Chip>}
                </span>
              </Td>
              <Td right>
                {rm0(m.revenue)}
                <span className="ml-2 inline-block w-14 text-[13px]">{!m.partial && before ? <Change value={changePct(m.revenue, before.revenue)} /> : null}</span>
              </Td>
              <Td right>{m.orders.paid}</Td>
              <Td right>{m.orders.paid ? rm0(m.avgOrder) : '—'}</Td>
              <Td right>{m.customers.newBuyers}</Td>
              <Td right>{m.orders.paid ? `${Math.round(m.customers.returningSharePct)}%` : '—'}</Td>
              <Td right>{m.pnl.costedOrders ? rm0(m.pnl.contribution) : '—'}</Td>
              <Td right>{m.pnl.marginPct === null ? '—' : `${Math.round(m.pnl.marginPct)}%`}</Td>
              <Td right>{m.pnl.operatingSpend ? rm0(m.pnl.operatingSpend) : '—'}</Td>
              <Td right className={m.pnl.netAfterSpend < 0 ? 'text-danger' : undefined}>{m.pnl.costedOrders || m.pnl.operatingSpend ? rm0(m.pnl.netAfterSpend) : '—'}</Td>
            </tr>
          );
        })}
      </TableScroll>
    </Panel>
  );
}

function Statement({ m }: { m: MonthReport }) {
  const { pnl } = m;
  const base = pnl.costedRevenue || 1;
  const line = (label: string, amount: number, opts: { strong?: boolean; deduct?: boolean } = {}) => (
    <div className={cn('flex items-baseline justify-between gap-4 px-5 py-2', opts.strong ? 'border-t border-primary font-semibold first:border-t-0' : 'text-text-secondary')}>
      <span className="min-w-0 text-[14px] leading-5">{label}</span>
      <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
        <span className={cn('text-[14px] leading-5', opts.strong && 'text-text-primary')}>{opts.deduct && amount > 0 ? `−${rm(amount)}` : rm(amount)}</span>
        <span className="w-10 text-right text-[13px] font-normal text-text-muted">{Math.round((amount / base) * 100)}%</span>
      </span>
    </div>
  );

  return (
    <Panel eyebrow="Profit and loss" title={pnl.uncostedOrders ? `${pnl.costedOrders} of ${m.orders.paid} orders costed` : 'Every paid order costed'} flush>
      <div className="py-1">
        {line('Revenue, costed orders', pnl.costedRevenue, { strong: true })}
        {line('Goods', pnl.itemCost, { deduct: true })}
        {line('Courier and extras', pnl.extraCost, { deduct: true })}
        {line('Gateway fees', pnl.gatewayFees, { deduct: true })}
        {pnl.affiliateCommissions > 0 && line('Affiliate commission', pnl.affiliateCommissions, { deduct: true })}
        {line('Profit on orders', pnl.contribution, { strong: true })}
        {pnl.spendByCategory.map((s) => (
          <div key={s.category}>{line(s.category, s.amount, { deduct: true })}</div>
        ))}
        {line('Net after running costs', pnl.netAfterSpend, { strong: true })}
      </div>
      {(pnl.uncostedOrders > 0 || pnl.inventoryBought > 0 || m.refunded > 0 || m.discounts > 0) && (
        <div className="space-y-1 border-t border-border px-5 py-3 text-[13px] leading-[18px] text-text-secondary">
          {pnl.uncostedOrders > 0 && <p>Not in this statement: {pnl.uncostedOrders} uncosted order{pnl.uncostedOrders === 1 ? '' : 's'}, {rm(pnl.uncostedRevenue)}.</p>}
          {pnl.inventoryBought > 0 && <p>Stock bought, {rm(pnl.inventoryBought)}, is not a cost until it sells.</p>}
          {m.refunded > 0 && <p>Refunded {rm(m.refunded)}, already off revenue.</p>}
          {m.discounts > 0 && <p>Discounts given {rm(m.discounts)}, already off revenue.</p>}
        </div>
      )}
    </Panel>
  );
}

/** Sizes the first screen to the window, so the whole chart shows at any window size. */
function useFitToWindow(deps: string) {
  const ref = useRef<HTMLDivElement>(null);
  // Before paint, or the chart shows at its old height for a frame on every tab switch.
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      if (!window.matchMedia(DESKTOP).matches) {
        el.style.height = '';
        return;
      }
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(MIN_FIRST_SCREEN, window.innerHeight - top - BOTTOM_GAP)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [deps]);
  return ref;
}

export function OverviewTab({ report, m, onOpenMonth, onForecast }: { report: AnalyticsReport; m: MonthReport; onOpenMonth: (month: string) => void; onForecast: () => void }) {
  const [series, setSeries] = useState<Series>('revenue');
  const firstScreen = useFitToWindow(m.month);
  const landing = m.partial ? report.forecast.landing : null;
  const c = m.compare;
  const versus = `vs ${c.label}`;
  const longPeriod = m.daily.length > MAX_DAILY_DAYS;
  const maxWeekday = Math.max(...m.byWeekday.map((d) => d.orders), 1);
  const maxHour = Math.max(...m.byHour, 1);
  const paidTotal = Math.max(m.orders.paid, 1);
  const hourBlocks = [0, 6, 12, 18].map((start) => ({ start, orders: m.byHour.slice(start, start + 6).reduce((a, b) => a + b, 0) }));
  const busiest = hourBlocks.reduce((a, b) => (b.orders > a.orders ? b : a));
  const revenueDays = m.daily.slice(0, m.daysElapsed).map((d) => d.revenue);
  const profitDays = m.daily.slice(0, m.daysElapsed).map((d) => d.profit);
  const orderDays = m.daily.slice(0, m.daysElapsed).map((d) => d.paidOrders);

  return (
    <div className="space-y-4">
      <div ref={firstScreen} className="flex flex-col gap-3">
      <Stats>
        <Stat label="Revenue" value={rm0(m.revenue)} spark={revenueDays} note={c.revenue > 0 ? <><Change value={changePct(m.revenue, c.revenue)} /> {versus}</> : 'Nothing earlier to compare'} />
        <Stat
          label="Profit on orders"
          value={m.pnl.costedOrders ? rm0(m.pnl.contribution) : '—'}
          spark={profitDays}
          tone={m.pnl.contribution < 0 ? 'bad' : undefined}
          note={m.pnl.marginPct === null ? 'No costed orders yet' : <>{Math.round(m.pnl.marginPct)}% margin{c.margin !== null ? <>, <Change value={Math.round((m.pnl.marginPct - c.margin) * 10) / 10} suffix=" pts" /></> : null}</>}
        />
        <Stat label="Paid orders" value={m.orders.paid.toLocaleString('en-MY')} spark={orderDays} note={<>{c.paidOrders > 0 && <><Change value={changePct(m.orders.paid, c.paidOrders)} />, </>}{Math.round(m.orders.paidPct)}% of placed</>} />
        <Stat label="Average order" value={m.orders.paid ? rm0(m.avgOrder) : '—'} note={<>{c.avgOrder > 0 && <><Change value={changePct(m.avgOrder, c.avgOrder)} />, </>}{m.unitsPerOrder || 0} units an order</>} />
      </Stats>

      <Panel
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="min-h-0 flex-1"
        title={<>{longPeriod ? 'By month' : 'By day'} <span className="font-body font-normal text-text-secondary">{m.label}</span></>}
        actions={
          <>
            {landing && <button type="button" onClick={onForecast} className="cursor-pointer text-[13px] font-medium text-cobalt hover:underline">On pace for {rm0(landing.expected)}</button>}
            {longPeriod ? <TrendLegend forecast={m.to.slice(0, 7) >= report.currentMonth} /> : <SeriesToggle series={series} onChange={setSeries} />}
          </>
        }
      >
        {longPeriod ? <TrendChart report={report} from={m.from} to={m.to} onSelect={onOpenMonth} /> : <DailyChart report={m} landing={landing} series={series} />}
      </Panel>
      </div>

      <Ledger report={report} active={m} onOpen={onOpenMonth} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Statement m={m} />
        <Panel eyebrow="Customers" title={`${m.customers.buyers} bought, ${m.customers.newBuyers} new`}>
          <div className="space-y-4">
            <Meter label={`New, ${m.customers.newBuyers}`} value={rm0(m.customers.newRevenue)} pct={m.revenue ? (m.customers.newRevenue / m.revenue) * 100 : 0} />
            <Meter label={`Returning, ${m.customers.returningBuyers}`} value={rm0(m.customers.returningRevenue)} pct={m.revenue ? (m.customers.returningRevenue / m.revenue) * 100 : 0} tone="cobalt" note={`${Math.round(m.customers.returningSharePct)}% of revenue`} />
            {m.marketing.spend > 0 && (
              <p className="text-[13px] leading-[18px] text-text-secondary">
                Marketing {rm0(m.marketing.spend)}
                {m.marketing.costPerNewCustomerCents !== null && `, ${rm0(m.marketing.costPerNewCustomerCents)} per new customer`}
                {m.marketing.returnOnSpend !== null && `, RM${m.marketing.returnOnSpend} back per RM1`}.
              </p>
            )}
          </div>
          {m.customers.top.length > 0 && (
            <div className="mt-5 border-t border-border pt-3">
              <Label className="mb-1 block">Top customers</Label>
              <ul>
                {m.customers.top.map((t) => (
                  <li key={`${t.name}-${t.revenue}`} className="flex items-center justify-between gap-3 py-1 text-[14px] leading-5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{t.name}</span>
                      {t.isNew ? <Chip tone="info">New</Chip> : <span className="shrink-0 text-[13px] text-text-muted">{rm0(t.lifetimeRevenue)} lifetime</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{rm0(t.revenue)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Products" title={`${m.products.length} sold`} description={`Before order discounts. Change is against ${c.sameDays ? 'the ' : ''}${c.label}.`} flush>
        {m.products.length === 0 ? (
          <div className="p-5"><Quiet>No product sales in this period.</Quiet></div>
        ) : (
          <TableScroll head={<><Th>Product</Th><Th right>Units</Th><Th right>Revenue</Th><Th right>Share</Th><Th right>Change</Th><Th right>Margin</Th><Th right>Profit</Th></>}>
            {m.products.map((p) => (
              <tr key={p.variantId}>
                <Td className="font-medium">{p.name}<span className="ml-2 text-[13px] font-normal text-text-muted">{p.code}</span></Td>
                <Td right>{p.units}</Td>
                <Td right>{rm0(p.revenue)}</Td>
                <Td right>{Math.round(p.sharePct)}%</Td>
                <Td right>{p.previousRevenue > 0 ? <Change value={changePct(p.revenue, p.previousRevenue)} /> : <Chip tone="info">New</Chip>}</Td>
                <Td right>{p.marginPct === null ? '—' : `${Math.round(p.marginPct)}%`}</Td>
                <Td right>{p.profit === null ? '—' : rm0(p.profit)}</Td>
              </tr>
            ))}
          </TableScroll>
        )}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Panel eyebrow="Payment" title="How they paid">
          {m.payments.length === 0 ? <Quiet>No payments.</Quiet> : (
            <div className="space-y-4">
              {m.payments.map((p) => (
                <Meter key={p.key} label={PAYMENT_LABELS[p.key] ?? p.key} value={rm0(p.revenue)} pct={m.revenue ? (p.revenue / m.revenue) * 100 : 0} note={`${p.orders} paid${p.failed ? `, ${p.failed} failed` : ''}${p.fees ? `, ${rm(p.fees)} fees` : ''}`} />
              ))}
            </div>
          )}
        </Panel>
        <Panel eyebrow="Sources" title="Where it came from">
          <div className="space-y-4">
            {m.orderTypes.map((t) => (
              <Meter key={t.key} label={TYPE_LABELS[t.key] ?? t.key} value={`${rm0(t.revenue)} · ${t.orders}`} pct={m.revenue ? (t.revenue / m.revenue) * 100 : 0} />
            ))}
            {m.affiliates.map((a) => (
              <Meter key={a.key} label={a.key} value={rm0(a.revenue)} pct={m.revenue ? (a.revenue / m.revenue) * 100 : 0} tone="cobalt" note={`Affiliate, ${a.orders} order${a.orders === 1 ? '' : 's'}, ${rm(a.commission)} commission`} />
            ))}
            {m.discountCodes.map((d) => (
              <Meter key={d.key} label={d.key} value={rm0(d.revenue)} pct={m.revenue ? (d.revenue / m.revenue) * 100 : 0} note={`Discount, ${d.orders} order${d.orders === 1 ? '' : 's'}, ${rm(d.amount)} given`} />
            ))}
            {m.orderTypes.length === 0 && <Quiet>No paid orders.</Quiet>}
          </div>
        </Panel>
        <Panel eyebrow="Geography" title="Top states">
          {m.states.length === 0 ? <Quiet>No paid orders.</Quiet> : (
            <div className="space-y-4">
              {m.states.map((s) => (
                <Meter key={s.key} label={s.key} value={`${rm0(s.revenue)} · ${s.orders}`} pct={m.revenue ? (s.revenue / m.revenue) * 100 : 0} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel eyebrow="Timing" title="When people buy" description={m.orders.paid ? `Busiest between ${String(busiest.start).padStart(2, '0')}:00 and ${String(busiest.start + 6).padStart(2, '0')}:00.` : undefined}>
          <div className="flex h-28 items-end gap-2">
            {m.byWeekday.map((d, i) => (
              <div key={WEEKDAYS[i]} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center" title={`${d.orders} orders, ${rm0(d.revenue)}`}>
                <span className="mb-1 text-[11px] leading-none tabular-nums text-text-secondary">{d.orders || ''}</span>
                <div className="rounded-t-[2px] bg-primary" style={{ height: `${(d.orders / maxWeekday) * 70}%` }} />
                <Label className="mt-1.5">{WEEKDAYS[i]}</Label>
              </div>
            ))}
          </div>
          <div className="mt-6 flex h-14 items-end gap-px">
            {m.byHour.map((count, hour) => (
              <div key={hour} className="min-w-0 flex-1 rounded-t-[1px] bg-cobalt" title={`${String(hour).padStart(2, '0')}:00, ${count} orders`} style={{ height: `${Math.max((count / maxHour) * 100, count ? 6 : 1)}%`, opacity: count ? 1 : 0.2 }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between"><Label>00:00</Label><Label>06:00</Label><Label>12:00</Label><Label>18:00</Label><Label>23:00</Label></div>
        </Panel>

        <Panel eyebrow="Fulfilment" title="Orders to door">
          <div className="space-y-4">
            <Meter label="Placed" value={m.orders.placed} pct={100} />
            <Meter label="Paid" value={m.orders.paid} pct={m.orders.placed ? (m.orders.paid / m.orders.placed) * 100 : 0} />
            <Meter label="Shipped" value={m.fulfilment.shipped} pct={(m.fulfilment.shipped / paidTotal) * (m.orders.paid / Math.max(m.orders.placed, 1)) * 100} />
            <Meter label="Delivered" value={m.fulfilment.delivered} pct={(m.fulfilment.delivered / paidTotal) * (m.orders.paid / Math.max(m.orders.placed, 1)) * 100} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div><dt><Label>Paid to shipped</Label></dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{m.fulfilment.paidToShippedHours === null ? '—' : m.fulfilment.paidToShippedHours >= 48 ? `${Math.round(m.fulfilment.paidToShippedHours / 24)} days` : `${Math.round(m.fulfilment.paidToShippedHours)} hours`}</dd></div>
            <div><dt><Label>Shipped to delivered</Label></dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{m.fulfilment.shippedToDeliveredDays === null ? '—' : `${m.fulfilment.shippedToDeliveredDays} days`}</dd></div>
            <div><dt><Label>Waiting to ship</Label></dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{m.fulfilment.waitingToShip}</dd></div>
            <div><dt><Label>Unpaid, failed, cancelled</Label></dt><dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{m.orders.unpaid}, {m.orders.failed}, {m.orders.cancelled}</dd></div>
          </dl>
          {m.failureReasons.length > 0 && (
            <ul className="mt-4 space-y-1 border-t border-border pt-3 text-[13px] leading-[18px] text-text-secondary">
              {m.failureReasons.map((f) => (
                <li key={f.reason} className="flex justify-between gap-3"><span className="min-w-0 truncate">{f.reason}</span><span className="shrink-0 tabular-nums">{f.count}</span></li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {m.profitShare.length > 0 && (
        <Panel eyebrow="Profit share" title="Who earned what" description="Each order’s own split, added up.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {m.profitShare.map((p) => (
              <Meter key={p.name} label={p.name} value={rm(p.amount)} pct={m.pnl.contribution ? Math.abs(p.amount / m.pnl.contribution) * 100 : 0} tone={p.company ? 'cobalt' : 'ink'} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
