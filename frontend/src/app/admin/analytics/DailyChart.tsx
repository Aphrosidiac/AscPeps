'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { AnalyticsReport, MonthReport } from './types';
import { MONO, compact, rm } from './parts';

export const SERIES = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'profit', label: 'Profit' },
  { key: 'pace', label: 'Pace' },
] as const;
export type Series = (typeof SERIES)[number]['key'];

const TICKS = 4;
const X_LABELS = 5;

function niceCeil(value: number): number {
  if (value <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / magnitude;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * magnitude;
}

function running(values: readonly number[]): number[] {
  let total = 0;
  return values.map((v) => (total += v));
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
}

export function SeriesToggle({ series, onChange }: { series: Series; onChange: (s: Series) => void }) {
  return (
    <div role="group" aria-label="Chart" className="flex items-center gap-0.5 rounded-full bg-surface-elevated p-0.5">
      {SERIES.map((opt) => (
        <button
          key={opt.key}
          type="button"
          aria-pressed={series === opt.key}
          onClick={() => onChange(opt.key)}
          className={cn('h-7 cursor-pointer rounded-full px-3 text-[13px] font-medium transition-colors duration-100', series === opt.key ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Fills its panel. Height comes from the parent, so it follows the window. */
export function DailyChart({ report, landing, series }: { report: MonthReport; landing: AnalyticsReport['forecast']['landing']; series: Series }) {
  const [hover, setHover] = useState<number | null>(null);

  const days = report.daily;
  const elapsed = report.daysElapsed;
  const isPace = series === 'pace';
  const land = report.partial ? landing : null;

  const thisPace = running(days.map((d) => d.revenue)).slice(0, elapsed);
  const lastPace = running(report.previousDaily);
  const values = days.map((d) => (series === 'profit' ? d.profit : d.revenue));

  const rawMax = isPace ? Math.max(...thisPace, ...lastPace.slice(0, days.length), land?.expected ?? 0, 1) : Math.max(...values, 1);
  const rawMin = isPace ? 0 : Math.min(...values, 0);
  const step = niceCeil(Math.max(rawMax, -rawMin) / TICKS);
  const top = Math.ceil(rawMax / step) * step;
  const bottom = rawMin < 0 ? -Math.ceil(-rawMin / step) * step : 0;
  const span = top - bottom || 1;
  const pct = (v: number) => ((v - bottom) / span) * 100;

  const ticks: number[] = [];
  for (let v = bottom; v <= top + 1e-6; v += step) ticks.push(v);

  const n = days.length;
  const line = (points: readonly number[]) => points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i + 0.5} ${100 - pct(v)}`).join(' ');
  const labelAt = n <= X_LABELS ? days.map((_, i) => i) : Array.from({ length: X_LABELS }, (_, i) => Math.round((i * (n - 1)) / (X_LABELS - 1)));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[260px] lg:h-auto lg:min-h-0 lg:flex-1" onMouseLeave={() => setHover(null)}>
        <div className="relative w-12 shrink-0">
          {ticks.map((t) => (
            <span key={t} className={cn(MONO, 'absolute right-2 translate-y-1/2 text-[11px] leading-none tabular-nums text-text-muted')} style={{ bottom: `${pct(t)}%` }}>
              {compact(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {ticks.map((t) => (
            <div key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-primary' : 'border-border/70')} style={{ bottom: `${pct(t)}%` }} />
          ))}

          {isPace && (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
              <path d={line(lastPace.slice(0, n))} fill="none" stroke="var(--color-border-hover)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <path d={line(thisPace)} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {land && thisPace.length > 0 && (
                <path d={`M ${elapsed - 0.5} ${100 - pct(thisPace[thisPace.length - 1])} L ${n - 0.5} ${100 - pct(land.expected)}`} fill="none" stroke="var(--color-cobalt)" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          )}

          <div className="absolute inset-0 flex gap-px">
            {days.map((d, i) => {
              const value = values[i];
              const future = i >= elapsed;
              const height = (Math.abs(value) / span) * 100;
              const base = value >= 0 ? pct(0) : pct(0) - height;
              return (
                <div key={d.date} className="relative min-w-0 flex-1" onMouseEnter={() => setHover(i)}>
                  {hover === i && <div className="absolute inset-0 bg-surface-elevated" />}
                  {!isPace && !future && value !== 0 && (
                    <div className={cn('absolute inset-x-0 sm:inset-x-px', value < 0 ? 'rounded-b-[2px] bg-danger' : 'rounded-t-[2px] bg-primary')} style={{ bottom: `${base}%`, height: `${Math.max(height, 0.8)}%` }} />
                  )}
                  {hover === i && (
                    <div className={cn('pointer-events-none absolute top-1 z-20 rounded-lg bg-primary px-3 py-2 text-[13px] leading-[18px] whitespace-nowrap text-white shadow-lg', i > n / 2 ? 'right-full mr-1' : 'left-full ml-1')}>
                      <p className="font-semibold">{dayLabel(d.date)}</p>
                      {future ? (
                        <p className="text-white/70">Not reached yet</p>
                      ) : (
                        <>
                          <p>Revenue {rm(d.revenue)} · {d.orders} order{d.orders === 1 ? '' : 's'}</p>
                          {d.costedRevenue > 0 && <p className="text-white/70">Profit {rm(d.profit)}</p>}
                          {isPace && <p className="text-white/70">To date {rm(thisPace[i])}</p>}
                        </>
                      )}
                      {isPace && lastPace[i] !== undefined && <p className="text-white/70">Before, by now {rm(lastPace[i])}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative mt-2 ml-12 h-4 shrink-0">
        {labelAt.map((i, at) => (
          <span
            key={i}
            className={cn(MONO, 'absolute text-[11px] leading-4 whitespace-nowrap text-text-muted', at === 0 ? 'left-0' : at === labelAt.length - 1 ? 'right-0' : '-translate-x-1/2')}
            style={at === 0 || at === labelAt.length - 1 ? undefined : { left: `${((i + 0.5) / n) * 100}%` }}
          >
            {dayLabel(days[i].date)}
          </span>
        ))}
      </div>
    </div>
  );
}
