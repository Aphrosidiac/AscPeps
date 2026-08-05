'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { memberVerifyEmail } from '@/lib/api';
import { AccountShell } from '../AccountShell';

type State = 'working' | 'done' | 'failed';

export function VerifyClient() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<State>('working');
  const [error, setError] = useState('');
  // React runs effects twice in development StrictMode. The verify token is
  // single-use, so the second call would legitimately 400 and flip a genuinely
  // successful confirmation to "link expired".
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState('failed');
      setError('This link is missing its confirmation token.');
      return;
    }

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
          You're all set. Sign in and you can comment on any Insights article.
        </p>
        <Link
          href="/account/login"
          className="inline-block mt-5 text-sm text-text-primary underline hover:text-primary transition-colors"
        >
          Sign in
        </Link>
      </div>
    </AccountShell>
  );
}
