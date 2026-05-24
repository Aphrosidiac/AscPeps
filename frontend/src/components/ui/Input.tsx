import { cn } from '@/lib/utils';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, id, ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted',
          'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
          error && 'border-danger',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
