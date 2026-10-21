'use client';

/**
 * Pieces every Ascend Money screen shares: the section tabs, the period
 * picker, money parsing, and the labels for each kind of bank movement.
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { BankSource, SplitRuleShare } from '@/types';
import { cn } from '@/lib/utils';

export const SECTIONS = [
  { href: '/admin/money', label: 'Overview' },
  { href: '/admin/money/share', label: 'Profit sharing' },
  { href: '/admin/money/bank', label: 'Bank' },
  { href: '/admin/money/partners', label: 'Partners' },
  { href: '/admin/money/expenses', label: 'Expenses' },
] as const;

/** The TabBar look, as links — each section is its own address. */
export function SectionTabs() {
  const pathname = usePathname();
  const current =
    [...SECTIONS].reverse().find((s) => (s.href === '/admin/money' ? pathname === s.href : pathname.startsWith(s.href)))?.href ??
    '/admin/money';
  // On a phone the last tab sits off the edge; the one you are on must not.
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [current]);
  return (
    <nav
      className="mb-6 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-sm:[mask-image:linear-gradient(to_right,black_85%,transparent)]"
      aria-label="Ascend Money sections"
    >
      <div className="flex w-max min-w-full gap-6 pr-8 sm:pr-0">
        {SECTIONS.map((s) => {
          const active = s.href === current;
          return (
            <Link
              key={s.href}
              href={s.href}
              ref={active ? activeRef : undefined}
              aria-current={active ? 'page' : undefined}
              className={cn(
                '-mb-px shrink-0 border-b-2 pb-3 pt-1 text-[15px] leading-[22px] font-medium transition-colors duration-[160ms]',
                active ? 'border-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ---------- period ---------- */

export type PeriodKey = 'month' | 'last' | 'all';

const MYT_MS = 8 * 60 * 60 * 1000;

/** Calendar month in Malaysia time, as the instants the API filters on. */
function mytMonth(offset: number) {
  const now = new Date(Date.now() + MYT_MS);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + offset;
  const from = new Date(Date.UTC(y, m, 1) - MYT_MS);
  const to = new Date(Date.UTC(y, m + 1, 1) - MYT_MS);
  const label = new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', year: 'numeric' }).format(from);
  return { from: from.toISOString(), to: to.toISOString(), label };
}

export function periodRange(key: PeriodKey): { from: string | null; to: string | null; label: string } {
  if (key === 'month') return mytMonth(0);
  if (key === 'last') return mytMonth(-1);
  return { from: null, to: null, label: 'All time' };
}

export function PeriodPicker({ value, onChange }: { value: PeriodKey; onChange: (k: PeriodKey) => void }) {
  const options: { key: PeriodKey; label: string }[] = [
    { key: 'month', label: 'This month' },
    { key: 'last', label: 'Last month' },
    { key: 'all', label: 'All time' },
  ];
  return (
    <div role="radiogroup" aria-label="Period" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer',
            value === o.key ? 'bg-surface-elevated text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- money ---------- */

/** "1,234.50" or "RM 12" → cents. Null when it isn't a number. */
export function parseRinggit(input: string): number | null {
  const cleaned = input.replace(/rm/i, '').replace(/,/g, '').trim();
  if (cleaned === '' || !/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Money on Ascend Money: "RM 2,802.40". The admin-wide formatPrice prints
 * "RM2802.40", which is fine for a product price but hard to read down a
 * column of balances. A real minus sign for anything below zero.
 */
export function rm(cents: number): string {
  const n = (Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '−' : ''}RM ${n}`;
}

/** Kept for readability at call sites that are about a signed balance. */
export const signedPrice = rm;

export const todayIso = () => new Date(Date.now() + MYT_MS).toISOString().slice(0, 10);

/** A YYYY-MM-DD from a date input → midnight Malaysia time that day. */
export const mytDayStart = (day: string) => new Date(`${day}T00:00:00+08:00`).toISOString();

/** Same day, but now-ish if it is today — so a movement typed today sorts after the morning's orders. */
export function mytDayOrNow(day: string): string {
  return day === todayIso() ? new Date().toISOString() : `${day}T12:00:00+08:00`;
}

export const bpsLabel = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

export function apiError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { error?: string; message?: string; details?: { message?: string }[] } } }).response?.data;
    return data?.details?.[0]?.message ?? data?.error ?? data?.message ?? fallback;
  }
  return fallback;
}

/* ---------- bank movement labels ---------- */

export const SOURCE: Record<BankSource, { label: string; chip: string }> = {
  OPENING: { label: 'Opening', chip: 'bg-surface-elevated text-text-secondary' },
  SALE: { label: 'Sale', chip: 'bg-green-100 text-green-800' },
  REFUND: { label: 'Refund', chip: 'bg-red-100 text-red-800' },
  CAPITAL: { label: 'Capital in', chip: 'bg-blue-100 text-blue-800' },
  MONEY_IN: { label: 'Money in', chip: 'bg-blue-100 text-blue-800' },
  EXPENSE: { label: 'Expense', chip: 'bg-surface-elevated text-text-secondary' },
  PAYOUT: { label: 'Profit share', chip: 'bg-purple-100 text-purple-800' },
  REPAYMENT: { label: 'Repayment', chip: 'bg-yellow-100 text-yellow-800' },
  MONEY_OUT: { label: 'Money out', chip: 'bg-surface-elevated text-text-secondary' },
};

/* ---------- the split, drawn ---------- */

const PERSON_TONES = ['bg-primary', 'bg-[#3155D9]', 'bg-[#8B5CF6]', 'bg-[#F59E0B]'];

/** A stacked bar of the split: people in tones, Ascend in green. */
export function SplitBar({ shares, className }: { shares: Pick<SplitRuleShare, 'name' | 'kind' | 'shareBps'>[]; className?: string }) {
  let person = 0;
  return (
    <div className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated', className)} aria-hidden="true">
      {shares.map((s) => (
        <span
          key={s.name}
          style={{ width: `${s.shareBps / 100}%` }}
          className={cn('h-full', s.kind === 'COMPANY' ? 'bg-success' : PERSON_TONES[person++ % PERSON_TONES.length])}
        />
      ))}
    </div>
  );
}

/** The legend under a SplitBar, same tones in the same order. */
export function SplitLegend({ shares, amounts }: { shares: Pick<SplitRuleShare, 'name' | 'kind' | 'shareBps'>[]; amounts?: (number | null)[] }) {
  let person = 0;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
      {shares.map((s, i) => (
        <li key={s.name} className="flex items-center gap-2 text-[13px] text-text-secondary">
          <span className={cn('h-2 w-2 rounded-full', s.kind === 'COMPANY' ? 'bg-success' : PERSON_TONES[person++ % PERSON_TONES.length])} />
          <span className="text-text-primary font-medium">{s.name}</span>
          <span className="tabular-nums">{bpsLabel(s.shareBps)}</span>
          {amounts && amounts[i] !== undefined && amounts[i] !== null ? (
            <span className="tabular-nums text-text-primary">· {rm(amounts[i] as number)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** A link that looks like one: underlined, with an arrow. */
export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-medium text-text-primary underline decoration-border-hover underline-offset-4 hover:decoration-text-primary">
      {children} <ArrowRight className="w-3.5 h-3.5" />
    </Link>
  );
}
