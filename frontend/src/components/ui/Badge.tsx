import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  /** Native tooltip — for badges whose label is short enough to need one. */
  title?: string;
}

export function Badge({ children, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', className)}
    >
      {children}
    </span>
  );
}
