import Link from 'next/link';
import type { ReactNode } from 'react';
import { GROUP_BUY_ENABLED } from '@/lib/features';

/**
 * Shared chrome for the /account and /account/verify screens (sign in and
 * create account use components/account/AuthScreen). Deliberately plain — these sit
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
        {GROUP_BUY_ENABLED ? (
          <>
            Your account follows your{' '}
            <Link href="/group-buy/orders" className="underline hover:text-text-secondary transition-colors">
              Group Buy orders
            </Link>{' '}
            and fills in your details at checkout. Buying as a guest still works.
          </>
        ) : (
          <>Your account fills in your details at checkout. Buying as a guest still works.</>
        )}
      </p>
    </div>
  );
}
