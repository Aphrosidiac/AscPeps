import { cn } from '@/lib/utils';
import type { InputHTMLAttributes, ComponentType } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ComponentType<{ className?: string }>;
}

export function Input({ label, error, icon: Icon, className, id, ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />}
        <input
          id={id}
          className={cn(
            'w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted',
            'focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
            Icon && 'pl-10',
            error && 'border-danger',
            className
          )}
          {...props}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
