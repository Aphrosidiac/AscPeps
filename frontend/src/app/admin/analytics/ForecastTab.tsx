'use client';

import { useState } from 'react';
import type { AnalyticsReport } from './types';
import { Change, Panel, Quiet, Stat, Stats, TableScroll, Td, Th, changePct, rm0 } from './parts';
import { StockTable } from './ProductsTab';

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[14px] leading-5">
        <span>{label}</span>
        <span className="font-medium tabular-nums">{unit === 'RM' ? `RM${value.toLocaleString('en-MY')}` : `${value > 0 ? '+' : ''}${value}${unit}`}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full cursor-pointer accent-[#3155D9]" />
    </label>
  );
}

function WhatIf({ report }: { report: AnalyticsReport }) {
  const f = report.forecast;
  const [ordersPct, setOrders] = useState(0);
  const [valuePct, setValue] = useState(0);
  const [marginPts, setMargin] = useState(0);
  const [spend, setSpend] = useState(0);

  const baseMargin = f.marginPct ?? 0;
  const baseRevenue = f.monthly?.points[0]?.expected ?? f.ordersPerMonth * f.avgOrder;
  const baseProfit = baseRevenue * (baseMargin / 100) - f.monthlySpend;
  const revenue = baseRevenue * (1 + ordersPct / 100) * (1 + valuePct / 100);
  const profit = revenue * ((baseMargin + marginPts) / 100) - f.monthlySpend - spend * 100;

  return (
    <Panel eyebrow="Scenario" title="What if" description={`Starts from next month’s forecast at ${Math.round(baseMargin)}% margin${f.monthlySpend > 0 ? ` and ${rm0(f.monthlySpend)} running costs` : ''}.`}>
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <Slider label="Orders" value={ordersPct} min={-50} max={100} step={5} unit="%" onChange={setOrders} />
          <Slider label="Average order" value={valuePct} min={-20} max={50} step={5} unit="%" onChange={setValue} />
          <Slider label="Margin" value={marginPts} min={-15} max={15} step={1} unit=" pts" onChange={setMargin} />
          <Slider label="Extra monthly spend" value={spend} min={0} max={10000} step={100} unit="RM" onChange={setSpend} />
        </div>
        <dl className="space-y-3 rounded-[8px] bg-surface-elevated p-4">
          <div><dt className="text-[13px] text-text-secondary">Revenue</dt><dd className="font-display text-[22px] leading-7 font-semibold tabular-nums">{rm0(revenue)}</dd><dd className="text-[13px]"><Change value={changePct(revenue, baseRevenue)} /></dd></div>
          <div><dt className="text-[13px] text-text-secondary">Net after running costs</dt><dd className="font-display text-[22px] leading-7 font-semibold tabular-nums">{rm0(profit)}</dd><dd className="text-[13px] text-text-secondary">{Math.round(profit) === Math.round(baseProfit) ? 'No change' : `${profit > baseProfit ? '+' : '−'}${rm0(Math.abs(profit - baseProfit))} a month`}</dd></div>
        </dl>
      </div>
    </Panel>
  );
}

export function ForecastTab({ report }: { report: AnalyticsReport }) {
  const f = report.forecast;
  const { landing, monthly } = f;

  return (
    <div className="space-y-4">
      {landing ? (
        <Panel eyebrow="This month" title={`Where ${landing.label} lands`} description={`Day ${landing.daysElapsed}, ${landing.daysLeft} days left. Simulated 4,000 times from the last 8 weeks of real daily sales.`}>
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <p className="font-display text-[38px] leading-[44px] font-semibold tracking-[-0.02em] tabular-nums">{rm0(landing.expected)}</p>
            <p className="text-[14px] leading-5 text-text-secondary">Likely {rm0(landing.low)} to {rm0(landing.high)}, an 80% range</p>
            <p className="text-[14px] leading-5 text-text-secondary">
              <Change value={changePct(landing.expected, landing.previousTotal)} /> on {landing.previousLabel} ({rm0(landing.previousTotal)})
            </p>
          </div>
          <div className="relative mt-5 h-3 rounded-full bg-surface-elevated">
            {(() => {
              const end = Math.max(landing.high, landing.previousTotal) * 1.05 || 1;
              const at = (v: number) => `${(v / end) * 100}%`;
              return (
                <>
                  <div className="absolute inset-y-0 rounded-full bg-cobalt/30" style={{ left: at(landing.low), width: `${((landing.high - landing.low) / end) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: at(landing.toDate) }} />
                  <div className="absolute -inset-y-1 w-0.5 bg-cobalt" style={{ left: at(landing.expected) }} title="Expected" />
                  <div className="absolute -inset-y-1 w-px bg-text-muted" style={{ left: at(landing.previousTotal) }} title={landing.previousLabel} />
                </>
              );
            })()}
          </div>
          <p className="mt-2 text-[13px] leading-[18px] text-text-muted">Black is money in so far, blue the likely landing, the thin line {landing.previousLabel}.</p>
        </Panel>
      ) : (
        <Panel eyebrow="This month" title="Where this month lands"><Quiet>Needs at least a week of sales history.</Quiet></Panel>
      )}

      <Panel
        eyebrow="Ahead"
        title="Next 3 months"
        description={
          monthly?.backtest
            ? `${monthly.method === 'last' ? `${monthly.methodLabel}. No other method beat it` : `${monthly.methodLabel}, picked because it came closest`} over ${monthly.backtest.folds} past months: typically ${Math.round(monthly.backtest.typicalMissPct)}% off${monthly.method === 'last' ? '' : `, against ${Math.round(monthly.backtest.naiveMissPct)}% for simply repeating last month`}.${monthly.backtest.typicalMissPct > 50 ? ' Months have been too uneven to forecast closely, so read this as rough.' : ''}`
            : `${monthly?.methodLabel ?? 'No method yet'}. Not enough months to test accuracy yet, so the range is deliberately wide.`
        }
        flush
      >
        {!monthly ? (
          <div className="p-5"><Quiet>Needs a complete month of sales.</Quiet></div>
        ) : (
          <TableScroll head={<><Th>Month</Th><Th right>Expected revenue</Th><Th right>Low</Th><Th right>High</Th><Th right>Profit on orders</Th><Th right>Net after costs</Th></>}>
            {monthly.points.map((p) => (
              <tr key={p.month}>
                <Td className="font-medium">{p.label}</Td>
                <Td right className="font-semibold">{rm0(p.expected)}</Td>
                <Td right>{rm0(p.low)}</Td>
                <Td right>{rm0(p.high)}</Td>
                <Td right>{p.contribution === null ? '—' : rm0(p.contribution)}</Td>
                <Td right className={p.net !== null && p.net < 0 ? 'text-danger' : undefined}>{p.net === null ? '—' : rm0(p.net)}</Td>
              </tr>
            ))}
          </TableScroll>
        )}
      </Panel>

      <Stats>
        <Stat label="Break-even" value={f.breakEven && f.monthlySpend > 0 ? rm0(f.breakEven.revenue) : '—'} note={f.monthlySpend === 0 ? 'Needs running costs recorded' : f.breakEven ? `${f.breakEven.orders} orders a month` : 'Needs costed orders'} />
        <Stat label="Running costs" value={f.monthlySpend > 0 ? rm0(f.monthlySpend) : '—'} note={f.monthlySpend > 0 ? 'Monthly, last 3 months' : 'None recorded, last 3 months'} />
        <Stat label="Margin" value={f.marginPct === null ? '—' : `${Math.round(f.marginPct)}%`} note="Costed orders, 90 days" />
        <Stat label="Average order" value={rm0(f.avgOrder)} note={`${Math.round(f.ordersPerMonth)} orders a month`} />
      </Stats>

      <WhatIf report={report} />

      <Panel eyebrow="Stock" title="Running out within 30 days" description="At current demand, soonest first." flush>
        {f.stockouts.length === 0 ? <div className="p-5"><Quiet>Nothing runs out in the next 30 days at current demand.</Quiet></div> : <StockTable rows={f.stockouts} />}
      </Panel>

      <p className="px-1 text-[13px] leading-[18px] text-text-muted">
        Forecasts read past sales only. They do not know about a planned promotion, Ramadan, a supply gap or a new product, so treat a known event as a reason to adjust by hand. Profit uses the margin on costed orders.
      </p>
    </div>
  );
}
