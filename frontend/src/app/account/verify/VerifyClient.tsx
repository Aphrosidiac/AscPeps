'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle, Loader2, Copy, Check } from 'lucide-react';
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
  // The sign-up code confirming just unlocked, shown here and then (it is
  // emailed too) — the popup promised it.
  const [bonus, setBonus] = useState<{ code: string; percent: number } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;

    memberVerifyEmail(token)
      .then((r) => {
        setBonus(r.signupBonus ?? null);
        setState('done');
      })
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

  if (bonus) {
    return (
      <AccountShell title="Email confirmed">
        <div className="text-center py-2">
          <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-3" />
          <p className="text-sm text-text-secondary leading-relaxed">Here is your one-time code — it&apos;s in your inbox too.</p>
          <div className="mt-5 rounded-xl border border-dashed border-text-primary bg-surface px-4 py-5">
            <p className="text-[11px] font-bold tracking-[0.09em] text-text-muted">{bonus.percent}% OFF YOUR FIRST ORDER</p>
            <p className="mt-2 font-mono text-[24px] font-bold tracking-[0.12em]">{bonus.code}</p>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(bonus.code).then(() => setCopied(true)).catch(() => {}); }}
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-border-hover px-4 text-[13px] font-semibold hover:border-text-primary cursor-pointer"
            >
              {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy code</>}
            </button>
            <p className="mt-3 text-xs text-text-muted leading-relaxed">One use, at checkout with this email. Signed in, checkout offers it to you.</p>
          </div>
          <Link href="/products" className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-white hover:bg-primary-light">
            Start shopping
          </Link>
          <Link href="/account" className="inline-block mt-3 text-sm text-text-primary underline hover:text-primary transition-colors">Go to my account</Link>
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
            ? 'You’re all set. Your Group Buy orders and reward codes now show in your account.'
            : 'You’re all set.'}
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
