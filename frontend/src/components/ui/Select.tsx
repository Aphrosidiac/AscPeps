import { cn } from '@/lib/utils';
import type { SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className, id, ...props }: SelectProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cn(
          'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          error && 'border-danger',
          className
        )}
        {...props}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
