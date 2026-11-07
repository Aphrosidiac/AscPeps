'use client';

import type { AnalyticsReport, Contact } from './types';
import { Chip, Label, Meter, Panel, Quiet, Stat, Stats, TableScroll, Td, Th, rm0, whatsappLink } from './parts';

function ContactTable({ rows, empty, expected }: { rows: Contact[]; empty: string; expected?: boolean }) {
  if (rows.length === 0) return <div className="p-5"><Quiet>{empty}</Quiet></div>;
  return (
    <TableScroll head={<><Th>Customer</Th><Th right>Orders</Th><Th right>Spent</Th><Th right>Last order</Th>{expected && <Th right>Usual gap</Th>}</>}>
      {rows.map((c) => (
        <tr key={`${c.phone}-${c.lastOrder}`}>
          <Td className="max-w-[180px] truncate font-medium">
            <a href={whatsappLink(c.phone)} target="_blank" rel="noreferrer" className="hover:text-cobalt hover:underline">{c.name}</a>
          </Td>
          <Td right>{c.orders}</Td>
          <Td right>{rm0(c.spent)}</Td>
          <Td right>{c.daysSince} days ago</Td>
          {expected && <Td right>{c.expectedGapDays} days{c.basis === 'store' ? ' (typical)' : ''}</Td>}
        </tr>
      ))}
    </TableScroll>
  );
}

/** Ink to cobalt by retention, on a fixed scale so two cohorts compare honestly. */
function cell(value: number) {
  const strength = Math.min(1, value / 60);
  return {
    background: `color-mix(in srgb, var(--color-cobalt) ${Math.round(strength * 85) + 6}%, transparent)`,
    color: strength > 0.55 ? '#FFFFFF' : 'var(--color-text-primary)',
  };
}

export function CustomersTab({ report }: { report: AnalyticsReport }) {
  const c = report.customers;
  const widest = Math.max(...c.cohorts.map((r) => r.retention.length), 1);
  const maxRevenue = Math.max(...c.segments.map((s) => s.revenue), 1);

  return (
    <div className="space-y-4">
      <Stats columns={5}>
        <Stat label="Customers" value={c.total.toLocaleString()} note="By phone number" />
        <Stat label="Repeat rate" value={`${Math.round(c.repeatRatePct)}%`} note={`${c.repeat} came back`} />
        <Stat label="Orders each" value={c.ordersPerCustomer} note={`${rm0(c.avgLifetimeSpend)} average spend`} />
        <Stat label="Time to reorder" value={c.medianGapDays === null ? '—' : `${c.medianGapDays} days`} note="Median gap" />
        <Stat label="12-month value" value={c.ltv12 ? rm0(c.ltv12.revenue) : '—'} note={c.ltv12?.contribution != null ? `Estimate, ${rm0(c.ltv12.contribution)} profit` : 'Estimate per customer'} />
      </Stats>

      <Panel eyebrow="Retention" title="By first-order month" description="Of the customers who first bought in a month, the share who bought again in each month after." flush>
        {c.cohorts.length === 0 ? (
          <div className="p-5"><Quiet>No customers yet.</Quiet></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-px px-4 py-3">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left"><Label>First order</Label></th>
                  <th className="px-2 py-1.5 text-right"><Label>Customers</Label></th>
                  {Array.from({ length: widest - 1 }, (_, i) => (
                    <th key={i} className="min-w-[52px] px-2 py-1.5 text-center"><Label>+{i + 1} mo</Label></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {c.cohorts.map((row) => (
                  <tr key={row.month}>
                    <td className="px-2 py-1.5 text-[14px] font-medium whitespace-nowrap">{row.label}</td>
                    <td className="px-2 py-1.5 text-right text-[14px] tabular-nums">{row.size}</td>
                    {Array.from({ length: widest - 1 }, (_, i) => {
                      const value = row.retention[i + 1];
                      if (value === undefined) return <td key={i} />;
                      if (value === null) return <td key={i} className="rounded-[4px] bg-surface-elevated px-2 py-1.5 text-center text-[13px] text-text-muted">…</td>;
                      if (value === 0) return <td key={i} className="rounded-[4px] px-2 py-1.5 text-center text-[13px] text-text-muted">0%</td>;
                      return <td key={i} className="rounded-[4px] px-2 py-1.5 text-center text-[13px] tabular-nums" style={cell(value)}>{Math.round(value)}%</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel eyebrow="Segments" title="Who your customers are" description="Recency, frequency and spend, sorted into groups you can act on." flush>
        <TableScroll head={<><Th>Segment</Th><Th>Who</Th><Th right>Customers</Th><Th right>Average spend</Th><Th right>Lifetime revenue</Th><Th className="w-40" /></>}>
          {c.segments.map((s) => (
            <tr key={s.key}>
              <Td><Chip tone={s.key === 'at_risk' ? 'bad' : s.key === 'champions' || s.key === 'loyal' ? 'good' : s.key === 'new' || s.key === 'promising' ? 'info' : 'neutral'}>{s.label}</Chip></Td>
              <Td className="text-text-secondary">{s.rule}</Td>
              <Td right>{s.customers}</Td>
              <Td right>{s.customers ? rm0(s.avgSpend) : '—'}</Td>
              <Td right>{rm0(s.revenue)}</Td>
              <Td><Meter label="" value="" pct={(s.revenue / maxRevenue) * 100} tone={s.key === 'at_risk' ? 'danger' : 'ink'} /></Td>
            </tr>
          ))}
        </TableScroll>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel eyebrow="Chase now" title="Due to reorder" description="Past their usual gap. Names open WhatsApp." flush>
          <ContactTable rows={c.dueToReorder} expected empty="Nobody is due right now." />
        </Panel>
        <Panel eyebrow="Win back" title="At risk" description="Repeat buyers quiet for over 90 days, biggest first." flush>
          <ContactTable rows={c.atRisk} empty="No repeat buyers have gone quiet." />
        </Panel>
      </div>
    </div>
  );
}
