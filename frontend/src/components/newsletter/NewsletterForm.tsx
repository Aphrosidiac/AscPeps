'use client';

import { useState, type FormEvent } from 'react';
import posthog from 'posthog-js';
import { Check, Loader2 } from 'lucide-react';
import { subscribeToNewsletter } from '@/lib/api';
import { cn } from '@/lib/utils';

interface NewsletterFormProps {
  source: 'FOOTER' | 'CHECKOUT';
  ctaLabel?: string;
  /** 'dark' sits on the near-black footer, 'light' inside the popup card. */
  tone?: 'dark' | 'light';
  className?: string;
  /** Called after a successful submit — the popup uses it to close itself. */
  onSuccess?: () => void;
}

// Locally remembering "this browser has subscribed" is what stops the popup
// re-asking someone who already joined. Read by NewsletterPopup; written here
// so every capture point sets it, not just the popup.
export const SUBSCRIBED_KEY = 'ascend-newsletter-subscribed';

export function NewsletterForm({
  source,
  ctaLabel = 'Subscribe',
  tone = 'dark',
  className,
  onSuccess,
}: NewsletterFormProps) {
  const [email, setEmail] = useState('');
  // The honeypot's own state. Real users never touch it; bots that fill every
  // input in the DOM do, and the server drops those submissions silently.
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (status === 'sending' || status === 'done') return;

    setStatus('sending');
    try {
      await subscribeToNewsletter({ email, source, website });
      // Deliberately set even when the address was already on the list — the
      // API answers identically either way (it won't confirm whether an
      // address is a subscriber), and from this browser's point of view the
      // outcome is the same: stop asking.
      try {
        localStorage.setItem(SUBSCRIBED_KEY, '1');
      } catch {
        // Private browsing / storage disabled. The signup still worked; the
        // only cost is that this browser may be asked again.
      }
      posthog.capture('newsletter_subscribed', { source });
      setStatus('done');
      onSuccess?.();
    } catch {
      setStatus('error');
    }
  }

  const dark = tone === 'dark';

  if (status === 'done') {
    return (
      <p
        className={cn(
          'flex items-start gap-2 text-sm',
          dark ? 'text-neutral-300' : 'text-text-secondary',
          className
        )}
      >
        <Check className="w-4 h-4 mt-0.5 shrink-0 text-success" aria-hidden />
        <span>Check your inbox — your reference links are on the way.</span>
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn('space-y-2', className)} noValidate>
      {/* Off-screen rather than display:none — some bots skip hidden inputs,
          and this one only works if they can find it. aria-hidden + tabIndex
          -1 keep it away from screen readers and the tab order. */}
      <div className="absolute left-[-9999px] top-auto w-px h-px overflow-hidden" aria-hidden="true">
        <label htmlFor={`nl-website-${source}`}>Website</label>
        <input
          id={`nl-website-${source}`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <label htmlFor={`nl-email-${source}`} className="sr-only">
          Email address
        </label>
        <input
          id={`nl-email-${source}`}
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={status === 'error'}
          className={cn(
            'flex-1 min-w-0 px-3 py-2 rounded-lg text-sm outline-none transition-colors',
            dark
              ? 'bg-neutral-900 border border-neutral-700 text-white placeholder:text-neutral-500 focus:border-neutral-500'
              : 'bg-surface border border-border text-text-primary placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20'
          )}
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className={cn(
            'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
            dark ? 'bg-white text-primary hover:bg-neutral-200' : 'bg-primary text-white hover:bg-primary-light'
          )}
        >
          {status === 'sending' && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
          {ctaLabel}
        </button>
      </div>

      {status === 'error' && (
        <p role="alert" className={cn('text-sm', dark ? 'text-red-400' : 'text-danger')}>
          That didn&apos;t go through. Check the address and try again.
        </p>
      )}
    </form>
  );
}
