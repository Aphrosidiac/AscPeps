'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { memberVerifyEmail } from '@/lib/api';
import { AccountShell } from '../AccountShell';
import { GROUP_BUY_ENABLED } from '@/lib/features';

type State = 'working' | 'done' | 'failed';

export function VerifyClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  // A link without a token fails before anything is sent.
  const [state, setState] = useState<State>(token ? 'working' : 'failed');
  const [error, setError] = useState(token ? '' : 'This link is missing its confirmation token.');
  // React runs effects twice in development StrictMode. The verify token is
  // single-use, so the second call would legitimately 400 and flip a genuinely
  // successful confirmation to "link expired".
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;

    memberVerifyEmail(token)
      .then(() => setState('done'))
      .catch((err) => {
        const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setError(message || 'This confirmation link is invalid or has expired.');
        setState('failed');
      });
  }, [token]);

  if (state === 'working') {
    return (
      <AccountShell title="Confirming your email">
        <div className="flex items-center justify-center gap-2.5 py-4 text-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">One moment…</span>
        </div>
      </AccountShell>
    );
  }

  if (state === 'failed') {
    return (
      <AccountShell title="Couldn't confirm that link">
        <div className="text-center py-2">
          <XCircle className="w-8 h-8 text-danger mx-auto mb-3" />
          <p className="text-sm text-text-secondary leading-relaxed">{error}</p>
          <Link
            href="/account"
            className="inline-block mt-5 text-sm text-text-primary underline hover:text-primary transition-colors"
          >
            Request a new link
          </Link>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="Email confirmed">
      <div className="text-center py-2">
        <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-3" />
        <p className="text-sm text-text-secondary leading-relaxed">
          {GROUP_BUY_ENABLED
            ? 'You’re all set. Your Group Buy orders and reward codes now show in your account, and you can comment on Insights.'
            : 'You’re all set. You can now comment on Insights.'}
        </p>
        <Link
          href={GROUP_BUY_ENABLED ? '/group-buy/orders' : '/account'}
          className="inline-block mt-5 text-sm text-text-primary underline hover:text-primary transition-colors"
        >
          {GROUP_BUY_ENABLED ? 'See my orders' : 'Go to my account'}
        </Link>
      </div>
    </AccountShell>
  );
}
