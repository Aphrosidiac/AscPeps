'use client';

import { useState } from 'react';
import { Activity, RefreshCw, ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminCheckOrderPayment, adminSetOrderTest } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ATTEMPT_STATUS,
  SOURCE_LABELS,
  describeEvent,
  deviceText,
  formatMoment,
  gatewayName,
  sinceOrder,
} from '@/lib/payment-trail';
import type { Order, PaymentAttempt, PaymentEvent } from '@/types';

/**
 * Everything recorded about this order's payment (backend utils/payment-trail.ts):
 * the facts that decide why a payment did or didn't happen, every attempt the
 * gateway lists, and every event in order — each with the raw data behind it,
 * one click away. "Check now" asks the gateway again and acts on its answer.
 *
 * A panel on the Info tab, like the Internal summary: the tab bar is tuned to
 * four labels on a phone.
 */
export function PaymentTrailCard({ order, onChange }: { order: Order; onChange: () => void }) {
  const { token } = useAuth();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [savingTest, setSavingTest] = useState(false);

  const events = order.paymentEvents ?? [];
  const attempts = order.paymentAttempts ?? [];
  const checkable = !!order.paymentRef && (order.paymentGateway === 'billplz' || order.paymentGateway === 'toyyibpay');
  const online = order.paymentMethod === 'BILLPLZ' || checkable;
  if (!online && events.length === 0) return null;

  const placed = events.find((e) => e.type === 'ORDER_PLACED');
  const opens = events.filter((e) => e.type === 'PAGE_OPENED');
  const returns = events.filter((e) => e.type === 'RETURNED');
  const callbacks = events.filter((e) => e.type === 'CALLBACK');
  const tracked = events.some((e) => e.type === 'BILL_CREATED');
  const real = attempts.filter((a) => a.status !== 'opened');
  const views = attempts.filter((a) => a.status === 'opened');
  const released = [...events].reverse().find((e) => e.type === 'RELEASED');
  const gw = gatewayName(order.paymentGateway);

  const check = async () => {
    if (!token) return;
    setChecking(true);
    setError('');
    try {
      await adminCheckOrderPayment(token, order.id);
      onChange();
    } catch (err) {
      const data = (err as { response?: { data?: { message?: string; error?: string } } }).response?.data;
      setError(data?.message ?? data?.error ?? `Could not check with ${gw}.`);
      // The failed check is on the trail too; show it.
      onChange();
    } finally {
      setChecking(false);
    }
  };

  const toggleTest = async () => {
    if (!token) return;
    setSavingTest(true);
    try {
      await adminSetOrderTest(token, order.id, !order.isTest);
      onChange();
    } finally {
      setSavingTest(false);
    }
  };

  const attemptLine = real.length
    ? real
        .map((a) => `${ATTEMPT_STATUS[a.status].label.toLowerCase()}${a.channel ? ` (${a.channel})` : ''}`)
        .join(', ')
    : 'none — never chose a payment method';

  return (
    <div className="row-rise bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-5 py-3.5 border-b border-border">
        <Activity className="w-4 h-4 text-text-muted shrink-0" />
        <h2 className="text-sm font-semibold">Payment trail</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleTest}
            disabled={savingTest}
            title="Test orders are left out of Admin → Payments"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50',
              order.isTest
                ? 'bg-warning/10 border-warning/30 text-warning'
                : 'border-border text-text-secondary hover:text-text-primary hover:border-border-hover'
            )}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {order.isTest ? 'Test order' : 'Mark as test'}
          </button>
          {checkable && (
            <button
              onClick={check}
              disabled={checking}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-light transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
              {checking ? 'Checking…' : `Check with ${gw}`}
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-6">
        {error && <p className="text-sm text-danger">{error}</p>}

        {/* The facts, one per line, each answerable from the trail below. */}
        <dl className="grid sm:grid-cols-2 gap-x-10">
          <Fact label="Device at checkout">
            {placed?.data?.source === 'assistant'
              ? 'Keyed in by the assistant'
              : placed
                ? deviceText(placed.data?.client?.device, placed.data?.client?.country)
                : <Muted>Not recorded (before tracking)</Muted>}
          </Fact>
          <Fact label="Payment page opened">
            {opens.length
              ? `${opens.length}× — first ${sinceOrder(opens[0].at, order.createdAt)}, from ${[...new Set(opens.map((o) => SOURCE_LABELS[o.data?.src] ?? o.data?.src))].join(', ')}`
              : tracked
                ? <span className="text-warning">Never</span>
                : views.length
                  ? `${views.length} page view${views.length === 1 ? '' : 's'} on ${gw}`
                  : <Muted>Not recorded (before tracking)</Muted>}
          </Fact>
          <Fact label="Payment attempts">{attemptLine}</Fact>
          <Fact label={`Came back from ${gw}`}>
            {returns.length
              ? returns
                  .map((r) => {
                    const p = r.data?.params ?? {};
                    const paid = p['billplz[paid]'] ?? (p.status_id === '1' ? 'true' : 'false');
                    return paid === 'true' ? 'paid' : 'not paid';
                  })
                  .join(', ')
              : tracked
                ? 'No — closed the page or the bank tab'
                : <Muted>Not recorded (before tracking)</Muted>}
          </Fact>
          <Fact label={`${gw} callbacks`}>
            {callbacks.length
              ? `${callbacks.length} (${callbacks.filter((c) => c.data?.signatureValid).length} verified)`
              : !tracked
                ? <Muted>Not recorded (before tracking)</Muted>
                : order.paymentGateway === 'billplz'
                  ? 'None — Billplz only calls back on a payment'
                  : 'None'}
          </Fact>
          <Fact label="Bill">
            {order.paymentRef ? (
              <span className="font-mono text-xs">{order.paymentRef}</span>
            ) : (
              <Muted>None</Muted>
            )}
            {released && <span className="text-text-muted"> · released {sinceOrder(released.at, order.createdAt)}</span>}
          </Fact>
        </dl>

        {attempts.length > 0 && <AttemptsTable attempts={attempts} createdAt={order.createdAt} />}

        <Timeline events={events} createdAt={order.createdAt} />
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-text-muted shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right break-words">{children}</dd>
    </div>
  );
}

const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-text-muted font-normal">{children}</span>;

function AttemptsTable({ attempts, createdAt }: { attempts: PaymentAttempt[]; createdAt: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
        Attempts the gateway lists ({attempts.length})
      </h3>
      <div className="border border-border rounded-lg divide-y divide-border">
        {attempts.map((a) => {
          const when = a.completedAt ?? a.attemptedAt;
          return (
            <div key={a.id}>
              <button
                onClick={() => setOpen(open === a.id ? null : a.id)}
                className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                {open === a.id ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ATTEMPT_STATUS[a.status].tone)}>
                  {ATTEMPT_STATUS[a.status].label}
                </span>
                <span className="font-medium">{a.channel ?? '—'}</span>
                <span className="font-mono text-xs text-text-muted">{a.externalId}</span>
                <span className="ml-auto text-xs text-text-muted tabular-nums">
                  {when
                    ? `${formatMoment(when)} (${sinceOrder(when, createdAt)})`
                    : `no time given · first seen ${formatMoment(a.firstSeenAt)}`}
                </span>
              </button>
              {open === a.id && <Raw value={a.raw} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  good: 'bg-success',
  bad: 'bg-danger',
  warn: 'bg-warning',
};

function Timeline({ events, createdAt }: { events: PaymentEvent[]; createdAt: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!events.length) {
    return (
      <p className="text-sm text-text-muted">
        Nothing recorded yet. Orders placed before the payment trail went live only have the attempts above (from the backfill).
      </p>
    );
  }
  return (
    <div>
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Everything that happened</h3>
      <ol className="relative border-l border-border ml-1.5 space-y-0.5">
        {events.map((e) => {
          const { title, detail, tone } = describeEvent(e);
          return (
            <li key={e.id} className="pl-4 relative">
              <span className={cn('absolute -left-[5px] top-3 w-2.5 h-2.5 rounded-full border-2 border-surface', tone ? TONE[tone] : 'bg-text-muted')} />
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                className="w-full text-left py-2 px-2 -mx-2 rounded-lg hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs text-text-muted tabular-nums">
                    {formatMoment(e.at)} · {sinceOrder(e.at, createdAt)}
                  </span>
                </div>
                {detail && <p className="text-xs text-text-secondary mt-0.5 break-words">{detail}</p>}
              </button>
              {open === e.id && <Raw value={e.data} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Raw({ value }: { value: unknown }) {
  return (
    <pre className="mx-3 mb-3 p-3 rounded-lg bg-surface-elevated text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
