'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, RotateCw, Search } from 'lucide-react';
import posthog from 'posthog-js';
import { lookupOrders } from '@/lib/api';
import { cn, normalizePhone } from '@/lib/utils';
import { forgetTrackedOrder, readTrackedOrder, rememberTrackedOrder } from '@/lib/tracked-order';
import type { TrackedOrder } from '@/lib/order-pipeline';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';
import { OrderPipeline, OrderPipelineSkeleton } from './OrderPipeline';

// useSearchParams needs a Suspense boundary above it or the static build of
// this route bails out to client rendering for the whole page.
export default function TrackPage() {
  return (
    <Suspense fallback={null}>
      <Track />
    </Suspense>
  );
}

type View =
  | { kind: 'form' }
  | { kind: 'loading' }
  | { kind: 'result'; orders: TrackedOrder[]; phone: string; checkedAt: number };

function Track() {
  const params = useSearchParams();
  // A returning customer lands on their order, not on a form. An ?order= link
  // (from a message we sent) wins over whatever this browser remembers. Read
  // during the first render: this subtree only ever renders in the browser
  // (useSearchParams under Suspense), so there is no server markup to disagree.
  const [resume] = useState(() => {
    const linked = params.get('order');
    const saved = readTrackedOrder();
    return saved && (!linked || linked.toUpperCase() === saved.orderNumber.toUpperCase()) ? saved : null;
  });
  const [orderNumber, setOrderNumber] = useState(resume?.orderNumber ?? params.get('order') ?? '');
  const [phone, setPhone] = useState(resume?.phone ?? '');
  const [view, setView] = useState<View>(resume ? { kind: 'loading' } : { kind: 'form' });
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const normalizedPhone = normalizePhone(phone);
  const canSearch = normalizedPhone.length >= 10 && orderNumber.trim().length >= 3;

  // Not an async function: every setState lands in a promise callback, which
  // is what keeps React's set-state-in-effect rule satisfied on the resume
  // path (same pattern as the admin pages).
  const lookup = useCallback((number: string, tel: string, source: 'form' | 'remembered' | 'refresh') =>
    lookupOrders(tel, number)
      .then((orders) => {
        if (orders.length === 0) {
          // A remembered order that no longer matches (deleted, or the phone
          // was corrected) must not trap the customer on an empty page.
          if (source === 'remembered') forgetTrackedOrder();
          setView({ kind: 'form' });
          setError(source === 'remembered' ? '' : 'We couldn’t find that order. Check the order number and use the phone number you checked out with.');
          return;
        }
        setError('');
        rememberTrackedOrder({ orderNumber: orders[0].orderNumber, phone: tel });
        setView({ kind: 'result', orders, phone: tel, checkedAt: Date.now() });
        if (source !== 'refresh') {
          posthog.capture('order_tracked', { orders_found: orders.length, search_type: source });
        }
      })
      .catch((err) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setView((v) => (v.kind === 'result' ? v : { kind: 'form' }));
        setError(
          status === 429
            ? 'Too many tries in a row. Wait a minute, then try again.'
            : 'We couldn’t reach our system just now. Check your connection and try again.',
        );
      }), []);

  useEffect(() => {
    if (resume) void lookup(resume.orderNumber, resume.phone, 'remembered');
  }, [resume, lookup]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSearch) return;
    setView({ kind: 'loading' });
    await lookup(orderNumber.trim().toUpperCase(), normalizedPhone, 'form');
  };

  const refresh = async () => {
    if (view.kind !== 'result') return;
    setRefreshing(true);
    await lookup(view.orders[0].orderNumber, view.phone, 'refresh');
    setRefreshing(false);
  };

  const trackAnother = () => {
    forgetTrackedOrder();
    setOrderNumber('');
    setPhone('');
    setError('');
    setView({ kind: 'form' });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <Animate variant="fadeUp" duration={0.5}>
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold">Track your order</h1>
          <p className="text-text-secondary mt-1.5">
            {view.kind === 'result'
              ? 'Here’s where your order is right now.'
              : 'See every step from payment to your door.'}
          </p>
        </div>
      </Animate>

      {view.kind === 'loading' && <OrderPipelineSkeleton />}

      {view.kind === 'result' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              onClick={trackAnother}
              className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" /> Track another order
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-60"
              aria-label="Check for updates"
            >
              <RotateCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
              {refreshing ? 'Checking…' : 'Refresh'}
            </button>
          </div>
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {view.orders.map((order) => (
            <Animate key={order.id} variant="fadeUp" duration={0.45}>
              <OrderPipeline order={order} phone={view.phone} />
            </Animate>
          ))}
        </div>
      )}

      {view.kind === 'form' && (
        <Animate variant="fadeUp" delay={0.1} duration={0.5}>
          <form onSubmit={submit} className="bg-surface rounded-2xl border border-border p-5 sm:p-7" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="track-order"
                label="Order number"
                hint="In your confirmation email or WhatsApp"
                value={orderNumber}
                onChange={setOrderNumber}
                placeholder="ASC2610/0012"
                autoCapitalize="characters"
                autoComplete="off"
              />
              <Field
                id="track-phone"
                label="Phone number"
                hint="The one you used at checkout"
                value={phone}
                onChange={setPhone}
                placeholder="012-345 6789"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-danger/[0.06] px-3.5 py-2.5 text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="mt-5 w-full" disabled={!canSearch}>
              <Search className="w-4 h-4" /> Track order
            </Button>
            <p className="mt-3 text-center text-xs text-text-muted">
              We ask for both so only you can see your order.
            </p>
          </form>
        </Animate>
      )}
    </div>
  );
}

function Field({
  id, label, hint, value, onChange, ...input
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'id'>) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
        className="w-full rounded-lg border border-border bg-surface px-3.5 py-3 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        {...input}
      />
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-text-muted">{hint}</p>
    </div>
  );
}
