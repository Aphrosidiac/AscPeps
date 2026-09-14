'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The form vocabulary the settings pages are built from, ported from the
 * SmoothSail admin (components/ui/card.tsx, field.tsx, save-bar.tsx, the
 * TabBar in page.tsx) with that project's ink/line/surface tokens mapped
 * onto this one's: ink-900/800 → text-primary, ink-500 → text-secondary,
 * line-100/200 → border, surface-50 → surface-elevated, primary-600 → primary.
 *
 * The one deliberate departure from what was here before: help text is
 * text-secondary (#525252, 7.5:1), not text-muted (#A3A3A3, 2.4:1). A hint
 * nobody can read is not a hint.
 */

/* ---------- Card ---------- */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[10px] border border-border bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-border px-6 py-4', className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[16px] leading-6 font-semibold text-text-primary">{title}</h3>
        {description ? <p className="mt-0.5 text-[13px] leading-[18px] text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6', className)} {...props} />;
}

/* ---------- Fields ---------- */

const control =
  'w-full rounded-[6px] border bg-surface px-3 text-[15px] text-text-primary placeholder:text-text-muted ' +
  'transition-[border-color,box-shadow] duration-[120ms] ' +
  'focus:outline-none focus:ring-[3px] focus:ring-primary/15 ' +
  'disabled:bg-surface-elevated disabled:text-text-muted disabled:cursor-not-allowed';

export function Field({
  label,
  help,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: React.ReactNode;
  help?: React.ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[14px] leading-5 font-medium text-text-primary">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[13px] leading-[18px] text-danger">{error}</p>
      ) : help ? (
        <p className="text-[13px] leading-[18px] text-text-secondary">{help}</p>
      ) : null}
    </div>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(control, 'h-[38px]', invalid ? 'border-danger' : 'border-border focus:border-primary', className)}
        {...props}
      />
    );
  }
);

export const SelectInput = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function SelectInput({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={cn(control, 'h-[38px] appearance-none pr-9 border-border focus:border-primary', className)} {...props}>
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
);

/** Affix box inside the control border (RM, %, days). */
export function Affixed({
  prefix,
  suffix,
  children,
  className,
}: {
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-[38px] items-stretch overflow-hidden rounded-[6px] border border-border bg-surface transition-[border-color,box-shadow] duration-[120ms] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15',
        className
      )}
    >
      {prefix ? <span className="flex items-center border-r border-border bg-surface-elevated px-3 text-[14px] text-text-secondary">{prefix}</span> : null}
      <div className="min-w-0 flex-1 [&>input]:h-full [&>input]:w-full [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-3 [&>input]:text-[15px] [&>input]:text-text-primary [&>input]:outline-none [&>input]:placeholder:text-text-muted">
        {children}
      </div>
      {suffix ? <span className="flex items-center border-l border-border bg-surface-elevated px-3 text-[14px] text-text-secondary">{suffix}</span> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors duration-[180ms]',
          checked ? 'bg-primary' : 'bg-border-hover'
        )}
      >
        <span
          className={cn(
            'block h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
            'transition-transform duration-[180ms]',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </button>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => !disabled && onChange(!checked)}
          className="flex min-h-6 items-center text-left text-[15px] leading-[22px] text-text-primary cursor-pointer"
        >
          {label}
        </button>
        {description ? <p className="text-[13px] leading-[18px] text-text-secondary">{description}</p> : null}
      </div>
    </div>
  );
}

/* ---------- Tabs ---------- */

export function TabBar<T extends string>({
  tabs,
  current,
  onSelect,
  className,
}: {
  tabs: { id: T; label: string; dot?: boolean }[];
  current: T;
  onSelect: (id: T) => void;
  className?: string;
}) {
  return (
    <nav className={cn('-mb-px overflow-x-auto border-b border-border', className)} aria-label="Sections">
      <div role="tablist" className="flex w-max min-w-full gap-6">
        {tabs.map((t) => {
          const active = t.id === current;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(t.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 pb-3 pt-1 text-[15px] leading-[22px] font-medium transition-colors duration-[160ms] cursor-pointer',
                active ? 'border-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {t.label}
              {t.dot ? <span aria-label="Unsaved changes" className="h-1.5 w-1.5 rounded-full bg-warning" /> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ---------- Save bar ---------- */

/**
 * Pinned to the bottom of the viewport, `bottom-4` so it floats over the
 * page rather than welding a second piece of chrome to the window.
 */
export function SaveBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-4 z-10 flex flex-wrap items-center gap-2 rounded-[10px] border border-border',
        'bg-surface/95 p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] backdrop-blur-md',
        className
      )}
    >
      {children}
    </div>
  );
}
