'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Check, X, Receipt, CreditCard, Package, Truck, Home,
  Copy, ExternalLink, ChevronDown, FileText, MessageCircle,
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import {
  orderSteps, orderHeadline, shortDate, shortTime,
  type TrackedOrder, type Step, type Tone,
} from '@/lib/order-pipeline';

const WHATSAPP = '601161092723';

const STEP_ICON = {
  placed: Receipt,
  paid: CreditCard,
  packing: Package,
  shipped: Truck,
  delivered: Home,
  cancelled: X,
} as const;

export function OrderPipeline({ order, phone }: { order: TrackedOrder; phone: string }) {
  const steps = orderSteps(order);
  const headline = orderHeadline(order);
  const shipped = order.status === 'SHIPPED' || order.status === 'DELIVERED';
  const helpUrl = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi, about my order ${order.orderNumber}`)}`;

  return (
    <article className="bg-surface rounded-2xl border border-border overflow-hidden">
      <header className="flex items-start justify-between gap-4 px-5 sm:px-7 pt-5 sm:pt-6">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Order</p>
          <h2 className="font-display text-lg font-bold tabular-nums truncate">{order.orderNumber}</h2>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Total</p>
          <p className="font-display text-lg font-bold tabular-nums">{formatPrice(order.total)}</p>
        </div>
      </header>

      <Headline headline={headline} order={order} />

      <div className="px-5 sm:px-7 pb-6">
        <Stepper steps={steps} />
      </div>

      {shipped && order.tracking && (
        // While it is in transit the headline already carries "Track parcel".
        <ParcelCard tracking={order.tracking} showLink={order.status === 'DELIVERED' || order.delivery?.status === 'SCHEDULED'} />
      )}

      <Details order={order} phone={phone} />

      <footer className="flex flex-wrap items-center justify-between gap-2 px-5 sm:px-7 py-4 border-t border-border bg-background/60 text-sm">
        <span className="text-text-muted">Something not right?</span>
        <a href={helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium text-text-primary hover:underline">
          <MessageCircle className="w-4 h-4" /> Message us on WhatsApp
        </a>
      </footer>
    </article>
  );
}

// -------------------------------------------------------------- headline

const TONE: Record<Tone, { box: string; dot: string }> = {
  progress: { box: 'bg-surface-elevated', dot: 'bg-primary' },
  action: { box: 'bg-warning/10 ring-1 ring-inset ring-warning/30', dot: 'bg-warning' },
  success: { box: 'bg-success/10 ring-1 ring-inset ring-success/30', dot: 'bg-success' },
  stopped: { box: 'bg-danger/[0.06] ring-1 ring-inset ring-danger/25', dot: 'bg-danger' },
};

function Headline({ headline, order }: { headline: ReturnType<typeof orderHeadline>; order: TrackedOrder }) {
  const tone = TONE[headline.tone];
  const live = headline.tone === 'progress' || headline.tone === 'action';

  // The one thing the customer can do about this step, if there is one.
  let action: React.ReactNode = null;
  if (order.status !== 'CANCELLED' && order.paymentStatus === 'UNPAID') {
    if (order.paymentUrl && !order.proofSubmitted) {
      action = <ActionLink href={order.paymentUrl}><CreditCard className="w-4 h-4" /> Complete payment</ActionLink>;
    } else if (order.paymentMethod === 'WHATSAPP' && !order.paymentUrl) {
      action = (
        <ActionLink href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(`Hi, I'd like to pay for order ${order.orderNumber}`)}`} external>
          <MessageCircle className="w-4 h-4" /> Get payment details
        </ActionLink>
      );
    }
  } else if (order.status === 'CANCELLED') {
    action = <ActionLink href="/products" variant="outline">Shop again</ActionLink>;
  } else if (order.status === 'SHIPPED' && order.tracking?.url && order.delivery?.status !== 'SCHEDULED') {
    action = (
      <ActionLink href={order.tracking.url} external>
        <Truck className="w-4 h-4" /> Track parcel
      </ActionLink>
    );
  }

  return (
    <div className={cn('mx-5 sm:mx-7 my-5 rounded-xl px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4', tone.box)}>
      <div className="flex gap-3 min-w-0 flex-1">
        <span className="relative mt-[7px] flex h-2.5 w-2.5 shrink-0" aria-hidden>
          {live && <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping', tone.dot)} />}
          <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', tone.dot)} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-xl font-bold leading-tight" role="status">{headline.title}</p>
          <p className="text-sm text-text-secondary mt-1 leading-relaxed">{headline.detail}</p>
        </div>
      </div>
      {action && <div className="shrink-0 pl-5 sm:pl-0">{action}</div>}
    </div>
  );
}

function ActionLink({ href, external, variant = 'primary', children }: { href: string; external?: boolean; variant?: 'primary' | 'outline'; children: React.ReactNode }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors',
        variant === 'primary' ? 'bg-primary text-white hover:bg-primary-light' : 'border border-border bg-surface hover:bg-surface-elevated',
      )}
    >
      {children}
    </a>
  );
}

// --------------------------------------------------------------- stepper

function Stepper({ steps }: { steps: Step[] }) {
  // The bar fills to the last step that has happened. Grown from zero after
  // mount so the customer sees the order travel, not just a static picture.
  const lastDone = steps.reduce((acc, s, i) => (s.state === 'done' ? i : acc), 0);
  const target = steps.length > 1 ? (lastDone / (steps.length - 1)) * 100 : 0;
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFill(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  const inset = `${50 / steps.length}%`;

  return (
    <ol
      aria-label="Order progress"
      className="relative grid"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {/* Track and fill, running between the first and last node centres. */}
      <div aria-hidden className="absolute top-4 h-0.5 -translate-y-1/2 bg-border rounded-full" style={{ left: inset, right: inset }}>
        <div
          className="h-full rounded-full bg-success transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${fill}%` }}
        />
      </div>

      {steps.map((step) => {
        const Icon = step.state === 'done' ? Check : STEP_ICON[step.key];
        return (
          <li key={step.key} className="relative flex flex-col items-center text-center px-0.5" aria-current={step.state === 'current' ? 'step' : undefined}>
            <span className="relative flex h-8 w-8 items-center justify-center">
              {step.state === 'current' && (
                <span aria-hidden className="absolute inset-0 rounded-full bg-primary/15 motion-safe:animate-ping" />
              )}
              <span
                className={cn(
                  'relative flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  step.state === 'done' && 'bg-success text-white',
                  step.state === 'current' && 'bg-primary text-white ring-4 ring-primary/10',
                  step.state === 'upcoming' && 'bg-surface text-text-muted ring-1 ring-inset ring-border',
                  step.state === 'stopped' && 'bg-danger text-white',
                )}
              >
                <Icon className="w-4 h-4" strokeWidth={step.state === 'done' ? 3 : 2} />
              </span>
            </span>
            <span
              className={cn(
                'mt-2 text-xs leading-tight',
                step.state === 'current' || step.state === 'stopped' ? 'font-semibold text-text-primary' : 'font-medium',
                step.state === 'done' && 'text-text-secondary',
                step.state === 'upcoming' && 'text-text-muted',
              )}
            >
              {step.label}
            </span>
            <span className="sr-only">
              {step.state === 'done' ? ' — done' : step.state === 'current' ? ' — in progress' : step.state === 'stopped' ? '' : ' — not yet'}
            </span>
            {step.at && step.state !== 'upcoming' ? (
              <time dateTime={step.at} className="mt-0.5 text-[11px] leading-tight text-text-muted tabular-nums">
                {shortDate(step.at)}
                <span className="hidden sm:inline"> · {shortTime(step.at)}</span>
              </time>
            ) : (
              <span className="mt-0.5 text-[11px] leading-tight text-transparent select-none" aria-hidden>–</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- parcel

function ParcelCard({ tracking, showLink }: { tracking: NonNullable<TrackedOrder['tracking']>; showLink: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tracking.number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the number is selectable */
    }
  };

  return (
    <div className="mx-5 sm:mx-7 mb-6 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-border px-4 py-3.5">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-elevated">
          <Truck className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-text-muted">{tracking.courier ?? 'Courier'} tracking number</p>
          <p className="font-mono text-[15px] font-semibold tracking-wide select-all truncate">{tracking.number}</p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          type="button"
          onClick={copy}
          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-elevated transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        {showLink && tracking.url && (
          <a
            href={tracking.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-surface-elevated transition-colors"
          >
            Open {tracking.courier?.split(' ')[0] ?? 'courier'} <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- details

function Details({ order, phone }: { order: TrackedOrder; phone: string }) {
  const count = order.items.reduce((n, i) => n + i.quantity, 0);
  return (
    <details className="group border-t border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 sm:px-7 py-4 text-sm font-medium hover:bg-surface-elevated/60 transition-colors [&::-webkit-details-marker]:hidden">
        <span>
          Order details <span className="text-text-muted font-normal">· {count} {count === 1 ? 'item' : 'items'} · placed {shortDate(order.createdAt)}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180" />
      </summary>

      <div className="px-5 sm:px-7 pb-5">
        <ul className="divide-y divide-border">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-3">
              <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-surface-elevated">
                {item.variant.imageUrl ? (
                  <img src={item.variant.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Package className="m-3.5 w-4 h-4 text-text-muted" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">
                  {item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''}
                </span>
                <span className="block text-xs text-text-muted">Qty {item.quantity} · {formatPrice(item.unitPrice)} each</span>
              </span>
              <span className="text-sm tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-2 space-y-1.5 border-t border-border pt-3 text-sm">
          <Row label="Subtotal" value={formatPrice(order.subtotal)} />
          <Row label="Shipping" value={order.shippingFee ? formatPrice(order.shippingFee) : 'Free'} />
          {order.discountAmount > 0 && <Row label="Discount" value={`−${formatPrice(order.discountAmount)}`} />}
          <Row label="Total" value={formatPrice(order.total)} strong />
          {order.refundedAmount > 0 && <Row label="Refunded" value={`−${formatPrice(order.refundedAmount)}`} />}
        </dl>

        <Link
          href={`/receipt/${order.orderNumber}?phone=${encodeURIComponent(phone)}`}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-surface-elevated px-3 py-2 text-sm font-medium hover:bg-border transition-colors"
        >
          <FileText className="w-4 h-4" /> View receipt
        </Link>
      </div>
    </details>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4', strong ? 'font-semibold text-text-primary' : 'text-text-secondary')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Placeholder while a remembered order loads — same shape, no jump. */
export function OrderPipelineSkeleton() {
  return (
    <div className="bg-surface rounded-2xl border border-border p-5 sm:p-7 animate-pulse" aria-hidden>
      <div className="flex justify-between">
        <div className="h-10 w-36 rounded bg-surface-elevated" />
        <div className="h-10 w-20 rounded bg-surface-elevated" />
      </div>
      <div className="mt-5 h-20 rounded-xl bg-surface-elevated" />
      <div className="mt-6 grid grid-cols-5 gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-surface-elevated" />
            <div className="h-3 w-12 rounded bg-surface-elevated" />
          </div>
        ))}
      </div>
    </div>
  );
}

