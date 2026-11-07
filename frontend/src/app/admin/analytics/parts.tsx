'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Grouped, because a period runs to four and five digits. */
export function rm(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}RM${(Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rm0(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}RM${Math.round(Math.abs(cents) / 100).toLocaleString('en-MY')}`;
}

export function compact(cents: number): string {
  const value = cents / 100;
  const abs = Math.abs(value);
  if (abs >= 1000) return `RM${(value / 1000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `RM${Math.round(value)}`;
}

export function changePct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

export const MONO = 'font-[family-name:var(--font-dm-mono)]';
const GOOD = 'text-[#15803D]';

/** Small caps data label, the same one everywhere. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(MONO, 'text-[11px] leading-4 font-medium tracking-[0.06em] text-text-muted uppercase', className)}>{children}</span>;
}

export function Change({ value, suffix = '%', className }: { value: number | null; suffix?: string; className?: string }) {
  if (value === null) return <span className={cn('text-text-muted', className)}>—</span>;
  if (value === 0) return <span className={cn('text-text-secondary', className)}>Level</span>;
  return (
    <span className={cn('tabular-nums', value > 0 ? GOOD : 'text-danger', className)}>
      {value > 0 ? '+' : '−'}
      {Math.abs(value).toLocaleString('en-MY', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 })}
      {suffix}
    </span>
  );
}

export function Panel({ eyebrow, title, description, actions, className, bodyClassName, children, flush }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className={cn('min-w-0 rounded-[8px] border border-border bg-surface', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-2.5">
        <div className="min-w-0">
          {eyebrow ? <Label className="block">{eyebrow}</Label> : null}
          <h2 className="font-display text-[15px] leading-[22px] font-semibold text-text-primary">{title}</h2>
          {description ? <p className="mt-0.5 text-[13px] leading-[18px] text-text-secondary">{description}</p> : null}
        </div>
        {actions ? <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2">{actions}</div> : null}
      </header>
      <div className={cn(!flush && 'p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A line of the period at a glance. Bucketed so a year reads as smoothly as a week. */
export function Spark({ values }: { values: readonly number[] }) {
  const buckets = 28;
  const points = values.length <= buckets
    ? [...values]
    : Array.from({ length: buckets }, (_, i) => {
        const start = Math.floor((i * values.length) / buckets);
        const end = Math.floor(((i + 1) * values.length) / buckets);
        return values.slice(start, end).reduce((a, b) => a + b, 0);
      });
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i / (points.length - 1)) * 100} ${28 - ((v - min) / span) * 26}`).join(' ');
  return (
    <svg className="h-7 w-full max-w-16" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke="var(--color-text-primary)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Stat({ label, value, note, spark, tone }: { label: string; value: ReactNode; note?: ReactNode; spark?: readonly number[]; tone?: 'bad' }) {
  return (
    <div className="min-w-0 rounded-[8px] border border-border bg-surface px-4 py-3 sm:px-5">
      <Label className="block">{label}</Label>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className={cn('min-w-0 font-display text-[24px] leading-[30px] font-semibold tracking-[-0.02em] whitespace-nowrap tabular-nums sm:text-[24px]', tone === 'bad' && 'text-danger')}>{value}</p>
        {spark ? <span className="hidden min-w-0 flex-1 justify-end xl:flex"><Spark values={spark} /></span> : null}
      </div>
      <p className="mt-0.5 truncate text-[13px] leading-[18px] text-text-secondary lg:h-[18px]">{note}</p>
    </div>
  );
}

export function Stats({ columns = 4, children }: { columns?: 3 | 4 | 5; children: ReactNode }) {
  const grid = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' }[columns];
  return <div className={cn('grid grid-cols-2 gap-3 [&>*]:min-w-0', grid)}>{children}</div>;
}

export function Meter({ label, value, pct, tone = 'ink', note }: { label: ReactNode; value: ReactNode; pct: number; tone?: 'ink' | 'cobalt' | 'danger'; note?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[14px] leading-5">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-text-secondary">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
        <div className={cn('h-full rounded-full', tone === 'cobalt' ? 'bg-cobalt' : tone === 'danger' ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, Math.max(pct > 0 ? 1.5 : 0, pct))}%` }} />
      </div>
      {note ? <p className="mt-1 text-[13px] leading-[18px] text-text-muted">{note}</p> : null}
    </div>
  );
}

export function Chip({ tone = 'neutral', children }: { tone?: 'good' | 'bad' | 'warn' | 'info' | 'neutral'; children: ReactNode }) {
  const tones = {
    good: 'bg-[#DCFCE7] text-[#166534]',
    bad: 'bg-[#FEE2E2] text-[#B91C1C]',
    warn: 'bg-[#FEF3C7] text-[#92400E]',
    info: 'bg-[#E4E9FB] text-cobalt-deep',
    neutral: 'bg-surface-elevated text-text-secondary',
  };
  return <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[13px] leading-none font-medium whitespace-nowrap', tones[tone])}>{children}</span>;
}

export function PillButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-border-hover bg-surface px-3.5 text-[14px] font-medium text-text-primary transition-colors duration-100 hover:border-primary', className)}
      {...props}
    />
  );
}

export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-5 text-text-secondary">{children}</p>;
}

const edge = 'first:pl-5 last:pr-5';

export function Th({ children, right, className, ...rest }: { children?: ReactNode; right?: boolean } & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn(MONO, 'px-3 py-2.5 text-[11px] leading-4 font-medium tracking-[0.06em] whitespace-nowrap text-text-muted uppercase', edge, right ? 'text-right' : 'text-left', className)} {...rest}>
      {children}
    </th>
  );
}

export function Td({ children, right, className, ...rest }: { children?: ReactNode; right?: boolean } & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-3 py-2.5 text-[14px] leading-5 whitespace-nowrap', edge, right && 'text-right tabular-nums', className)} {...rest}>
      {children}
    </td>
  );
}

/** Table heads sit over one ink rule; rows are hairlines. */
export function TableScroll({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead><tr className="border-b border-primary">{head}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-border [&>tr:last-child]:border-0">{children}</tbody>
      </table>
    </div>
  );
}

/** wa.me wants the number with its country code and no leading zero. */
export function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits.startsWith('0') ? `6${digits}` : digits}`;
}
