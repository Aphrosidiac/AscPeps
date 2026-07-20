interface SkuBadgeProps {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl sm:text-3xl',
};

// The customer-recognizable identifier (e.g. "RT10") shown boldest/first —
// the descriptive name (e.g. "Retatrutide 10mg") stays as smaller secondary
// text wherever this appears. Purely presentational: no links, no logic.
export function SkuBadge({ code, size = 'md', className = '' }: SkuBadgeProps) {
  return (
    <span className={`font-display font-bold tracking-wide text-text-primary ${SIZES[size]} ${className}`}>
      {code}
    </span>
  );
}
