'use client';

import type { AnalyticsReport, StockRow } from './types';
import { Change, Chip, Panel, Quiet, Stat, Stats, TableScroll, Td, Th, changePct, rm0 } from './parts';

export const STOCK_LABELS: Record<StockRow['status'], string> = {
  out: 'Out of stock',
  critical: 'Under 2 weeks',
  low: 'Under a month',
  healthy: 'Healthy',
  overstock: 'Over 6 months',
  dead: 'Not selling',
};

const STOCK_TONE: Record<StockRow['status'], 'bad' | 'warn' | 'good' | 'neutral'> = { out: 'bad', critical: 'bad', low: 'warn', healthy: 'good', overstock: 'neutral', dead: 'neutral' };

export function StockTable({ rows }: { rows: StockRow[] }) {
  return (
    <TableScroll head={<><Th>Product</Th><Th>Status</Th><Th right>In stock</Th><Th right>Per week</Th><Th right>Lasts</Th><Th right>Runs out</Th><Th right>Reorder</Th><Th right>Cost</Th></>}>
      {rows.map((s) => (
        <tr key={s.variantId}>
          <Td className="font-medium">{s.name}{s.supply && <span className="ml-2 text-[13px] font-normal text-text-muted">supply</span>}</Td>
          <Td><Chip tone={STOCK_TONE[s.status]}>{STOCK_LABELS[s.status]}</Chip></Td>
          <Td right>{s.stock}</Td>
          <Td right>{s.dailyDemand ? (s.dailyDemand * 7).toFixed(1) : '—'}</Td>
          <Td right>{s.coverDays === null ? '—' : `${s.coverDays} days`}</Td>
          <Td right>{s.stockoutOn ? new Date(`${s.stockoutOn}T00:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' }) : '—'}</Td>
          <Td right>{s.reorderUnits || '—'}</Td>
          <Td right>{s.reorderUnits && s.reorderCost !== null ? rm0(s.reorderCost) : '—'}</Td>
        </tr>
      ))}
    </TableScroll>
  );
}

export function ProductsTab({ report }: { report: AnalyticsReport }) {
  const p = report.products;
  const a = p.rows.filter((r) => r.abc === 'A');
  const aShare = a.reduce((s, r) => s + r.sharePct, 0);
  const attention = p.stock.filter((s) => s.status === 'out' || s.status === 'critical' || s.status === 'low');
  const idle = p.stock.filter((s) => s.status === 'dead' && s.stock > 0);
  const idleValue = idle.reduce((s, r) => s + (r.stockValue ?? 0), 0);

  return (
    <div className="space-y-4">
      <Stats>
        <Stat label="Carrying sales" value={a.length} note={`${Math.round(aShare)}% of revenue`} />
        <Stat label="Stock value" value={rm0(p.stockValue)} note={p.uncostedStockLines ? `${p.uncostedStockLines} products without a cost` : 'At latest cost'} />
        <Stat label="Need reordering" value={attention.length} note={`To hold ${p.targetCoverDays} days of cover`} />
        <Stat label="Not selling" value={idle.length} note={idle.length ? `${rm0(idleValue)} tied up, 60 days quiet` : 'Everything moved in 60 days'} />
      </Stats>

      <Panel eyebrow="Ranking" title={p.window} description="A products make the first 80% of revenue, B the next 15%, C the rest." flush>
        {p.rows.length === 0 ? (
          <div className="p-5"><Quiet>No sales in this period.</Quiet></div>
        ) : (
          <TableScroll head={<><Th>Class</Th><Th>Product</Th><Th right>Units</Th><Th right>Revenue</Th><Th right>Share</Th><Th right>Running</Th><Th right>Margin</Th><Th right>Last 30 days</Th></>}>
            {p.rows.map((r) => (
              <tr key={r.variantId}>
                <Td><Chip tone={r.abc === 'A' ? 'info' : 'neutral'}>{r.abc}</Chip></Td>
                <Td className="font-medium">{r.name}<span className="ml-2 text-[13px] font-normal text-text-muted">{r.code}</span></Td>
                <Td right>{r.units}</Td>
                <Td right>{rm0(r.revenue)}</Td>
                <Td right>{Math.round(r.sharePct)}%</Td>
                <Td right>{Math.round(r.cumulativePct)}%</Td>
                <Td right>{r.marginPct === null ? '—' : `${Math.round(r.marginPct)}%`}</Td>
                <Td right>
                  {r.units30}
                  <span className="ml-2 inline-block w-14 text-[13px]">{r.unitsPrior30 > 0 ? <Change value={changePct(r.units30, r.unitsPrior30)} /> : null}</span>
                </Td>
              </tr>
            ))}
          </TableScroll>
        )}
      </Panel>

      <Panel eyebrow="Stock" title="Cover and reorder" description={`Demand from the last 60 days, weighted to the last 30. Reorder tops up to ${p.targetCoverDays} days.`} flush>
        <StockTable rows={p.stock} />
      </Panel>

      <Panel eyebrow="Baskets" title="Bought together" description="Lift above 1 means more often than chance, so worth bundling." flush>
        {p.pairs.length === 0 ? (
          <div className="p-5"><Quiet>No pair has shown up in two orders yet.</Quiet></div>
        ) : (
          <TableScroll head={<><Th>Pair</Th><Th right>Orders</Th><Th right>Lift</Th></>}>
            {p.pairs.map((pair) => (
              <tr key={`${pair.a}-${pair.b}`}>
                <Td className="font-medium">{pair.a} + {pair.b}</Td>
                <Td right>{pair.orders}</Td>
                <Td right>{pair.lift}×</Td>
              </tr>
            ))}
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}
