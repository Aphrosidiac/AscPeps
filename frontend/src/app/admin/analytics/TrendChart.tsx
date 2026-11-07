'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { AnalyticsReport } from './types';
import { MONO, compact, rm0 } from './parts';

function niceTop(value: number): number {
  if (value <= 0) return 100_000;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / magnitude;
  // Tops that divide into four round ticks, close enough that the bars fill the height.
  return ([1, 1.2, 1.6, 2, 2.4, 3.2, 4, 6, 8, 10].find((step) => n <= step) ?? 10) * magnitude;
}

interface Slot {
  key: string;
  short: string;
  label: string;
  actual: number;
  profit: number | null;
  low: number | null;
  expected: number | null;
  high: number | null;
  future: boolean;
}

export function TrendLegend({ forecast }: { forecast: boolean }) {
  return (
    <div className="hidden items-center gap-4 text-[13px] leading-[18px] text-text-secondary sm:flex">
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-primary" />Revenue</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-success" />Profit</span>
      {forecast && <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-[2px] bg-cobalt/30" />Forecast</span>}
    </div>
  );
}

/** The months in the period as bars, then the months ahead with their range when it reaches today. */
export function TrendChart({ report, from, to, onSelect }: { report: AnalyticsReport; from: string; to: string; onSelect: (month: string) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const { landing, monthly } = report.forecast;
  const reachesToday = to.slice(0, 7) >= report.currentMonth;

  const past: Slot[] = [...report.months].reverse().filter((m) => m.to >= from && m.from <= to).map((m) => {
    const landed = m.partial ? landing : null;
    return {
      key: m.month,
      short: m.label.slice(0, 3),
      label: m.label,
      actual: m.revenue,
      profit: m.pnl.costedOrders > 0 ? m.pnl.contribution : null,
      low: landed?.low ?? null,
      expected: landed?.expected ?? null,
      high: landed?.high ?? null,
      future: false,
    };
  });
  const ahead: Slot[] = reachesToday
    ? (monthly?.points ?? []).map((p) => ({ key: p.month, short: p.label.slice(0, 3), label: p.label, actual: 0, profit: null, low: p.low, expected: p.expected, high: p.high, future: true }))
    : [];
  const slots = [...past, ...ahead];

  // Scaled to the bars, not the top of the range. A young store's range can run
  // to many times its sales, and fitting that flattens every real month.
  const top = niceTop(Math.max(...slots.map((s) => Math.max(s.actual, s.expected ?? 0)), 1) * 1.3);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const h = (value: number) => `${(value / top) * 100}%`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[260px] lg:h-auto lg:min-h-0 lg:flex-1" onMouseLeave={() => setHover(null)}>
        <div className="relative w-12 shrink-0">
          {ticks.map((t) => (
            <span key={t} className={cn(MONO, 'absolute right-2 translate-y-1/2 text-[11px] leading-none tabular-nums text-text-muted')} style={{ bottom: h(t) }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {ticks.map((t) => (
            <div key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-primary' : 'border-border/70')} style={{ bottom: h(t) }} />
          ))}
          <div className="absolute inset-0 flex">
            {slots.map((s, i) => {
              const clickable = !s.future;
              const Tag = clickable ? 'button' : 'div';
              return (
                <Tag
                  key={s.key}
                  {...(clickable ? { type: 'button' as const, onClick: () => onSelect(s.key), 'aria-label': `Open ${s.label}` } : {})}
                  onMouseEnter={() => setHover(i)}
                  className={cn('relative min-w-0 flex-1', clickable && 'cursor-pointer', hover === i && 'bg-surface-elevated')}
                >
                  <div className="absolute inset-x-[16%] inset-y-0 flex items-end justify-center gap-[2px]">
                    <div className="relative h-full flex-1">
                      {s.expected !== null && <div className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-cobalt/25" style={{ height: h(s.expected) }} />}
                      {s.actual > 0 && <div className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-primary" style={{ height: h(s.actual) }} />}
                      {s.low !== null && s.high !== null && (
                        <div className="absolute left-1/2 w-px -translate-x-1/2 bg-cobalt" style={{ bottom: h(s.low), height: `${((Math.min(s.high, top) - s.low) / top) * 100}%` }}>
                          {s.high <= top && <i className="absolute top-0 -left-[3px] h-px w-[7px] bg-cobalt" />}
                          <i className="absolute bottom-0 -left-[3px] h-px w-[7px] bg-cobalt" />
                        </div>
                      )}
                    </div>
                    {s.profit !== null && (
                      <div className="relative h-full w-[34%]">
                        <div className="absolute inset-x-0 bottom-0 rounded-t-[2px] bg-success" style={{ height: h(Math.max(0, s.profit)) }} />
                      </div>
                    )}
                  </div>
                  {hover === i && (
                    <div className={cn('pointer-events-none absolute top-1 z-20 rounded-lg bg-primary px-3 py-2 text-left text-[13px] leading-[18px] whitespace-nowrap text-white shadow-lg', i > slots.length / 2 ? 'right-full mr-1' : 'left-full ml-1')}>
                      <p className="font-semibold">{s.label}{s.future ? ' forecast' : ''}</p>
                      {!s.future && <p>Revenue {rm0(s.actual)}</p>}
                      {s.profit !== null && <p className="text-white/70">Profit {rm0(s.profit)}</p>}
                      {s.expected !== null && <p className="text-white/70">Expected {rm0(s.expected)}</p>}
                      {s.low !== null && s.high !== null && <p className="text-white/70">{rm0(s.low)} to {rm0(s.high)}</p>}
                    </div>
                  )}
                </Tag>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2 ml-12 flex shrink-0">
        {slots.map((s) => (
          <span key={s.key} className={cn(MONO, 'min-w-0 flex-1 truncate text-center text-[11px] leading-4 tracking-[0.04em] uppercase', s.future ? 'text-cobalt' : 'text-text-muted')}>
            {s.short}
          </span>
        ))}
      </div>
    </div>
  );
}
