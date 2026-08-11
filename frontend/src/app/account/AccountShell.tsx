import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared chrome for the four /account screens. Deliberately plain — these sit
 * inside the normal storefront layout (navbar + footer), unlike the admin
 * login's full-bleed dark hero.
 */
export function AccountShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted mt-1.5 leading-relaxed">{subtitle}</p>}
      </div>

      <div className="bg-surface-elevated border border-border rounded-xl p-5 sm:p-6">{children}</div>

      {footer && <div className="mt-5 text-sm text-text-muted text-center">{footer}</div>}

      <p className="mt-8 text-xs text-text-muted leading-relaxed text-center">
        An Ascend MY account is only used to post comments on{' '}
        <Link href="/insights" className="underline hover:text-text-secondary transition-colors">
          Insights
        </Link>
        . Orders are placed without an account, as before.
      </p>
    </div>
  );
}
