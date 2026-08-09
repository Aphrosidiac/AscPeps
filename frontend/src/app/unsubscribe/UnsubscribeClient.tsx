'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { unsubscribeNewsletter } from '@/lib/api';

/**
 * Completes the opt-out on load rather than behind a confirm button.
 *
 * Someone arriving here has already decided — a "are you sure?" step between
 * them and the outcome is the pattern that turns an unsubscribe into a spam
 * complaint, which costs the sending domain far more than the subscriber did.
 * The re-subscribe link below is the undo for a mis-click.
 */
export function UnsubscribeClient() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');

  useEffect(() => {
    if (!token) {
      setState('error');
      return;
    }
    let cancelled = false;
    unsubscribeNewsletter(token)
      .then(() => !cancelled && setState('done'))
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === 'working') {
    return (
      <div className="flex items-center gap-3 text-text-secondary">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
        <p>Updating your preferences…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div>
        <AlertCircle className="w-8 h-8 text-danger" aria-hidden />
        <h1 className="mt-4 font-display text-2xl font-bold text-text-primary">
          That link didn&apos;t work
        </h1>
        <p className="mt-2 text-text-secondary leading-relaxed">
          It may have been cut short by your email client. Copy the full address from the
          unsubscribe link and try again, or message us and we&apos;ll take you off the list by hand.
        </p>
        <a
          href="https://wa.me/601161092723"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-6 text-sm font-medium text-primary underline underline-offset-4"
        >
          Message us on WhatsApp
        </a>
      </div>
    );
  }

  return (
    <div>
      <Check className="w-8 h-8 text-success" aria-hidden />
      <h1 className="mt-4 font-display text-2xl font-bold text-text-primary">You&apos;re unsubscribed</h1>
      <p className="mt-2 text-text-secondary leading-relaxed">
        You won&apos;t get any more research updates or restock alerts from us. Order confirmations and
        receipts for anything you buy will still arrive — those aren&apos;t part of this list.
      </p>
      <p className="mt-6 text-sm text-text-muted">
        Didn&apos;t mean to?{' '}
        <Link href="/#newsletter" className="text-primary underline underline-offset-4">
          Sign back up from the footer
        </Link>
        .
      </p>
    </div>
  );
}
