'use client';

import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MONO } from './parts';

export type Preset = 'month' | '7d' | '30d' | '90d' | '6m' | '12m' | 'all';
export type Period =
  | { kind: 'preset'; key: Preset }
  | { kind: 'month'; month: string }
  | { kind: 'custom'; from: string; to: string };

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '6m', label: '6M' },
  { key: '12m', label: '12M' },
  { key: 'all', label: 'All' },
];

const MYT_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function mytToday(): string {
  return new Date(Date.now() + MYT_MS).toISOString().slice(0, 10);
}

function shiftDays(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS).toISOString().slice(0, 10);
}

function monthsBack(day: string, by: number): string {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - by, 1)).toISOString().slice(0, 10);
}

function lastOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The dates a period means, in Malaysian days. The API clamps "all" to the first order. */
export function resolvePeriod(period: Period): { from: string; to: string } {
  if (period.kind === 'custom') return { from: period.from, to: period.to };
  if (period.kind === 'month') return { from: `${period.month}-01`, to: lastOfMonth(period.month) };
  const today = mytToday();
  if (period.key === 'month') return { from: `${today.slice(0, 7)}-01`, to: lastOfMonth(today.slice(0, 7)) };
  const from = {
    '7d': shiftDays(today, -6),
    '30d': shiftDays(today, -29),
    '90d': shiftDays(today, -89),
    '6m': monthsBack(today, 5),
    '12m': monthsBack(today, 11),
    all: '2000-01-01',
  }[period.key];
  return { from, to: today };
}

export function periodToQuery(period: Period): string {
  if (period.kind === 'custom') return `from=${period.from}&to=${period.to}`;
  if (period.kind === 'month') return `month=${period.month}`;
  return period.key === 'month' ? '' : `period=${period.key}`;
}

export function periodFromQuery(params: URLSearchParams): Period {
  const preset = params.get('period');
  if (preset && PRESETS.some((p) => p.key === preset)) return { kind: 'preset', key: preset as Preset };
  const month = params.get('month');
  if (month && /^\d{4}-\d{2}$/.test(month)) return { kind: 'month', month };
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) return { kind: 'custom', from, to };
  return { kind: 'preset', key: 'month' };
}

const pill = 'h-7 shrink-0 cursor-pointer rounded-full px-3 text-[13px] leading-none font-medium whitespace-nowrap transition-colors duration-100';

export function PeriodBar({ period, months, onChange, busy }: {
  period: Period;
  months: { month: string; label: string; partial: boolean }[];
  onChange: (p: Period) => void;
  busy: boolean;
}) {
  const isCustom = period.kind === 'custom';
  const range = resolvePeriod(period);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 pb-2 lg:flex-nowrap" aria-busy={busy}>
      <div className="flex max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div role="group" aria-label="Period" className="flex items-center gap-0.5 rounded-full bg-surface-elevated p-1">
          {PRESETS.map((p) => {
            const active = period.kind === 'preset' && period.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ kind: 'preset', key: p.key })}
                className={cn(pill, active ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary')}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={isCustom}
            onClick={() => { if (!isCustom) onChange({ kind: 'custom', from: range.from < '2001' ? shiftDays(mytToday(), -29) : range.from, to: range.to }); }}
            className={cn(pill, isCustom ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary')}
          >
            Custom
          </button>
        </div>
      </div>

      {period.kind !== 'custom' && (
        <label className="relative">
          <span className="sr-only">Month</span>
          <select
            value={period.kind === 'month' ? period.month : ''}
            onChange={(e) => { if (e.target.value) onChange({ kind: 'month', month: e.target.value }); }}
            className={cn(
              'h-9 cursor-pointer appearance-none rounded-full! border bg-surface pr-8 pl-3.5 text-[13px] font-medium focus:ring-[3px] focus:ring-primary/15 focus:outline-none',
              period.kind === 'month' ? 'border-primary text-text-primary' : 'border-border text-text-secondary hover:border-border-hover',
            )}
          >
            <option value="">Month</option>
            {months.map((m) => (
              <option key={m.month} value={m.month}>{m.label}{m.partial ? ' (to date)' : ''}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-text-secondary" />
        </label>
      )}

      {period.kind === 'custom' && (
        <div className={cn(MONO, 'flex h-9 shrink-0 items-center gap-1 rounded-full border border-primary bg-surface px-3 text-[13px]')}>
          <input
            aria-label="From"
            type="date"
            value={period.from}
            max={period.to}
            onChange={(e) => { if (e.target.value) onChange({ ...period, from: e.target.value }); }}
            className="bg-transparent outline-none"
          />
          <span className="text-text-muted">to</span>
          <input
            aria-label="To"
            type="date"
            value={period.to}
            min={period.from}
            max={mytToday()}
            onChange={(e) => { if (e.target.value) onChange({ ...period, to: e.target.value }); }}
            className="bg-transparent outline-none"
          />
        </div>
      )}
    </div>
  );
}
