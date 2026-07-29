'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, User, Users, FileText, Truck, Trash2, RotateCcw, Mail, ExternalLink,
  Plus, X, Hash, Scale, Package, Coins, Wallet,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetOrder, adminUpdateOrder, adminUpdateOrderCosts, adminUpdateOrderProfitShares,
  adminDeleteOrder, adminRestoreOrder, adminOpenReceiptPdf, adminResendOrderEmail,
} from '@/lib/api';
import { formatPrice, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS } from '@/lib/constants';
import { EMAIL_TYPE_LABELS, emailStatusText } from '@/lib/email-status';
import type { Order, OrderEmail, OrderProfitShareInput } from '@/types';

// ASCEND's pipeline, not a copy of the source design's six purchasing stages —
// this catalogue has no quotation/PO/warehouse chain to model. The stepper and
// the tab bar are two views of the same three sections and stay in sync;
// clicking either moves both.
const STEPS = [
  { key: 'info', label: 'Order Info' },
  { key: 'detail', label: 'Order Detail' },
  { key: 'profit', label: 'Profit Sharing' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

function apiErrorMessage(err: unknown): string | null {
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? null;
  }
  return null;
}

/**
 * Splits `profit` (integer cents, may be negative) across `bps` using the
 * largest-remainder method, so the parts always sum back to exactly `profit`.
 * Rounding each share independently would routinely leave the column one or
 * two cents off the stated profit, which looks like a bug on a page whose
 * whole job is telling people what they're owed.
 */
function allocate(profit: number, bps: number[]): number[] {
  if (bps.length === 0) return [];
  const exact = bps.map((b) => (profit * b) / 10_000);
  const base = exact.map((v) => Math.trunc(v));
  let leftover = profit - base.reduce((a, b) => a + b, 0);

  // Hand the stray cents to whoever was rounded down hardest. Sign-aware, so a
  // loss-making order distributes its remainder the same way.
  const order = exact
    .map((v, i) => ({ i, frac: Math.abs(v - base[i]) }))
    .sort((a, b) => b.frac - a.frac);

  const step = leftover >= 0 ? 1 : -1;
  for (let k = 0; leftover !== 0 && k < order.length * 2; k++) {
    base[order[k % order.length].i] += step;
    leftover -= step;
  }
  return base;
}

const bpsToPercent = (bps: number) => (bps / 100).toFixed(2).replace(/\.00$/, '');

// Ringgit text field <-> integer cents. Empty string is a real state ("not
// entered"), distinct from 0, so it maps to null rather than to zero.
const centsToInput = (cents: number | null | undefined) =>
  cents == null ? '' : (cents / 100).toFixed(2);

function inputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Prefilled on any order that has no split saved yet. Just a starting point —
// it's editable per order, and changing it here never touches an order whose
// split is already recorded.
const DEFAULT_SHARES: OrderProfitShareInput[] = [
  { name: 'Fakhrul', shareBps: 3000 },
  { name: 'Asyraf', shareBps: 3000 },
  { name: 'Investors', shareBps: 4000 },
];

export function OrderDetail({ orderId }: { orderId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<StepKey>('info');

  const load = () => {
    if (!token) return;
    adminGetOrder(token, orderId)
      .then(setOrder)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token, orderId]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-64 bg-surface-elevated rounded-lg" />
        <div className="h-28 bg-surface-elevated rounded-xl" />
        <div className="h-64 bg-surface-elevated rounded-xl" />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="text-center py-16">
        <p className="text-text-muted text-lg mb-1">Order not found</p>
        <p className="text-text-muted text-sm mb-6">It may have been permanently removed.</p>
        <Link href="/admin/orders" className="text-primary text-sm font-medium hover:underline">
          Back to Orders
        </Link>
      </div>
    );
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => router.push('/admin/orders')}
            aria-label="Back to orders"
            className="mt-1 p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-2xl font-bold truncate">{order.orderNumber}</h1>
              <Badge className={ORDER_STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
              <Badge className={PAYMENT_STATUS_COLORS[order.paymentStatus]}>{order.paymentStatus}</Badge>
              {order.deletedAt && <Badge className="bg-red-100 text-red-800">Deleted</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-text-muted flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />{order.customerName}
              </span>
              <span className="text-border">|</span>
              <span>{formatDate(order.createdAt)}</span>
            </div>
          </div>
        </div>
        <button
          onClick={() => adminOpenReceiptPdf(token!, order.id).catch(() => {})}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-border bg-surface text-text-primary rounded-lg text-sm font-medium hover:bg-surface-elevated transition-colors cursor-pointer shrink-0"
        >
          <FileText className="w-3.5 h-3.5" /> Receipt
        </button>
      </div>

      {/* Stepper */}
      <div className="bg-surface border border-border rounded-xl p-5 sm:p-6 mb-6">
        <div className="flex items-start">
          {STEPS.map((s, i) => {
            const isActive = i === activeIndex;
            const isDone = i < activeIndex;
            return (
              <div key={s.key} className="flex items-start flex-1 last:flex-none">
                <button
                  onClick={() => setStep(s.key)}
                  aria-current={isActive ? 'step' : undefined}
                  className="flex flex-col items-center gap-2 cursor-pointer group shrink-0"
                >
                  <span
                    className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-semibold transition-colors ${
                      isActive
                        ? 'border-primary text-primary'
                        : isDone
                          ? 'border-primary/40 text-primary/70'
                          : 'border-border text-text-muted group-hover:border-text-muted'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`text-xs text-center whitespace-nowrap transition-colors ${
                      isActive ? 'font-semibold text-text-primary' : 'text-text-muted group-hover:text-text-secondary'
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span className={`flex-1 h-0.5 mt-5 mx-2 sm:mx-4 rounded ${isDone ? 'bg-primary/40' : 'bg-border'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-6 overflow-x-auto">
        <div className="flex gap-6 min-w-max">
          {STEPS.map((s) => (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap ${
                step === s.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {step === 'info' && <OrderInfoTab order={order} />}
      {step === 'detail' && <OrderDetailTab order={order} onChange={load} />}
      {step === 'profit' && <ProfitSharingTab order={order} onChange={load} />}
    </div>
  );
}

/* ---------------------------------------------------------------- Order Info */

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
        <span className="text-text-muted">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-sm text-text-muted shrink-0">{label}</span>
      <span className="text-sm font-medium text-right break-words">{value || <span className="text-text-muted">—</span>}</span>
    </div>
  );
}

function OrderInfoTab({ order }: { order: Order }) {
  return (
    <div className="space-y-6">
      <Card title="Order Details" icon={<Hash className="w-4 h-4" />}>
        <div className="grid sm:grid-cols-2 gap-x-10">
          <Field label="Customer" value={order.customerName} />
          <Field label="Phone" value={order.phone} />
          <Field label="Email" value={order.email} />
          <Field
            label="Payment Method"
            value={order.paymentMethod === 'WHATSAPP' ? 'WhatsApp (Manual Transfer)' : `Online (${order.paymentGateway || 'Billplz'})`}
          />
          <Field label="Address" value={order.address} />
          <Field label="City / State" value={`${order.city}, ${order.state} ${order.postcode}`} />
          <Field
            label="Tracking"
            value={order.trackingNumber ? <span className="font-mono">{order.trackingNumber}</span> : null}
          />
          <Field label="Discount" value={order.discountCode?.code} />
        </div>
        {order.notes && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">Notes</p>
            <p className="text-sm text-text-secondary whitespace-pre-wrap">{order.notes}</p>
          </div>
        )}
      </Card>

      {/* Items */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                <th className="text-left px-5 py-3">Item</th>
                <th className="text-right px-5 py-3 whitespace-nowrap">Qty</th>
                <th className="text-right px-5 py-3 whitespace-nowrap">Price</th>
                <th className="text-right px-5 py-3 whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-5 py-4">
                    <span className="font-medium">
                      {item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''}
                    </span>
                    <span className="text-text-muted ml-2 text-xs font-mono">{item.variant.code}</span>
                  </td>
                  <td className="px-5 py-4 text-right">{item.quantity}</td>
                  <td className="px-5 py-4 text-right whitespace-nowrap">{formatPrice(item.unitPrice)}</td>
                  <td className="px-5 py-4 text-right font-semibold whitespace-nowrap">
                    {formatPrice(item.unitPrice * item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-surface-elevated px-5 py-4 space-y-1">
          <div className="flex justify-between text-sm text-text-secondary">
            <span>Subtotal</span><span>{formatPrice(order.subtotal || order.total)}</span>
          </div>
          {order.discountAmount > 0 && (
            <div className="flex justify-between text-sm text-success">
              <span>Discount</span><span>-{formatPrice(order.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-text-secondary">
            <span>Shipping</span><span>{!order.shippingFee ? 'Free' : formatPrice(order.shippingFee)}</span>
          </div>
          <div className="flex justify-between font-display font-bold text-base border-t border-border pt-2 mt-1">
            <span>Grand Total</span><span>{formatPrice(order.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Order Detail */

function OrderDetailTab({ order, onChange }: { order: Order; onChange: () => void }) {
  const { token } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(order.trackingNumber ?? '');
  const [notes, setNotes] = useState(order.notes ?? '');
  const [resending, setResending] = useState<string | null>(null);

  // Same single lock as the orders list: an online-gateway payment already
  // confirmed Paid can never be changed again.
  const paymentLocked = order.paymentMethod === 'BILLPLZ' && order.paymentStatus === 'PAID';
  const trackingDirty = tracking !== (order.trackingNumber ?? '');
  const notesDirty = notes !== (order.notes ?? '');

  const patch = async (data: Record<string, unknown>) => {
    if (!token) return;
    setError(null);
    setSaving(true);
    try {
      await adminUpdateOrder(token, order.id, data);
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'Could not save that change.');
    } finally {
      setSaving(false);
    }
  };

  const handlePaymentUpdate = (paymentStatus: string) => {
    if (paymentStatus === 'REFUNDED' && order.paymentGateway === 'toyyibpay') {
      const ok = window.confirm(
        'ToyyibPay has no automatic refund. This only restores stock and marks the order Refunded — you must process the actual refund manually in the ToyyibPay dashboard. Continue?'
      );
      if (!ok) return;
    }
    patch({ paymentStatus });
  };

  const handleDelete = async () => {
    if (!token || !confirm(`Delete order ${order.orderNumber}? It won't be permanently removed — you can restore it from the Deleted tab.`)) return;
    setSaving(true);
    try {
      await adminDeleteOrder(token, order.id);
      router.push('/admin/orders');
    } finally {
      setSaving(false);
    }
  };

  const handleResendEmail = async (type: OrderEmail['type']) => {
    if (!token) return;
    setResending(type);
    try {
      await adminResendOrderEmail(token, order.id, type);
      onChange();
    } catch {
      // Non-critical — the status line simply won't change.
    } finally {
      setResending(null);
    }
  };

  if (order.deletedAt) {
    return (
      <Card title="Deleted Order" icon={<Trash2 className="w-4 h-4" />}>
        <p className="text-sm text-danger mb-4">Deleted on {formatDate(order.deletedAt)}</p>
        <p className="text-sm text-text-muted mb-4">
          Restore this order to edit its status, payment or tracking again.
        </p>
        <button
          onClick={async () => {
            if (!token) return;
            setSaving(true);
            try { await adminRestoreOrder(token, order.id); onChange(); } finally { setSaving(false); }
          }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Restore Order
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title="Status" icon={<Truck className="w-4 h-4" />}>
        {error && <p className="text-sm text-danger mb-4">{error}</p>}
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label htmlFor="order-status" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
              Order Status
            </label>
            <select
              id="order-status"
              value={order.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={saving}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface font-medium disabled:opacity-50"
            >
              {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="payment-status" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
              Payment Status
            </label>
            <select
              id="payment-status"
              value={order.paymentStatus}
              onChange={(e) => handlePaymentUpdate(e.target.value)}
              disabled={saving || paymentLocked}
              title={paymentLocked ? 'Paid via online transfer — locked, can no longer be changed' : undefined}
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface font-medium disabled:opacity-50"
            >
              <option value="UNPAID">Unpaid</option>
              <option value="PAID">Paid</option>
              <option value="FAILED">Failed</option>
              <option value="REFUNDED">Refunded</option>
            </select>
            {paymentLocked && <p className="text-xs text-text-muted mt-1">🔒 Paid online — locked</p>}
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="tracking" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
            Tracking Number
          </label>
          <div className="flex gap-2 items-center max-w-md">
            <div className="relative flex-1">
              <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                id="tracking"
                type="text"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="e.g. MY12345678901"
                maxLength={50}
                className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            {trackingDirty && (
              <button
                onClick={() => patch({ trackingNumber: tracking.trim() })}
                disabled={saving}
                className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer shrink-0"
              >
                Save
              </button>
            )}
          </div>
          {!tracking && order.status === 'CONFIRMED' && (
            <p className="text-xs text-warning mt-1.5">Enter a tracking number before marking as Shipped</p>
          )}
        </div>

        <div className="mt-5">
          <label htmlFor="notes" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
            Notes
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Internal notes about this order..."
            className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          {notesDirty && (
            <button
              onClick={() => patch({ notes })}
              disabled={saving}
              className="mt-2 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer"
            >
              Save Notes
            </button>
          )}
        </div>
      </Card>

      {order.email && (
        <Card title="Emails" icon={<Mail className="w-4 h-4" />}>
          <div className="flex flex-col gap-2">
            {(['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT'] as const)
              // A receipt only makes sense once the order is (or was) paid.
              .filter((type) => type !== 'PAYMENT_RECEIPT' || order.paymentStatus === 'PAID' || order.emails?.some((e) => e.type === type))
              .map((type) => {
                const email = order.emails?.find((e) => e.type === type);
                const { text, className } = emailStatusText(email);
                return (
                  <div key={type} className="flex items-center gap-2 text-sm">
                    <Mail className="w-3.5 h-3.5 text-text-muted" />
                    <span className="font-medium">{EMAIL_TYPE_LABELS[type]}:</span>
                    <span className={className} title={email?.lastError ?? undefined}>{text}</span>
                    <button
                      onClick={() => handleResendEmail(type)}
                      disabled={resending === type}
                      className="px-2 py-0.5 bg-surface-elevated text-text-secondary rounded text-xs font-medium hover:bg-border hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {resending === type ? 'Queuing...' : email ? 'Resend' : 'Send'}
                    </button>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        {order.paymentMethod === 'WHATSAPP' && (
          <a
            href={`https://wa.me/${order.phone.replace(/[^0-9]/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> WhatsApp Customer
          </a>
        )}
        <button
          onClick={handleDelete}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-danger/10 text-danger rounded-lg text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" /> Delete Order
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Profit Sharing */


function ProfitSharingTab({ order, onChange }: { order: Order; onChange: () => void }) {
  const { token } = useAuth();

  // Ringgit text, not cents, while editing — an empty field has to stay empty
  // rather than snapping to "0.00" on every keystroke.
  const [itemCosts, setItemCosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.items.map((i) => [i.id, centsToInput(i.unitCost)]))
  );
  const [extras, setExtras] = useState<{ label: string; amount: string }[]>(() =>
    (order.extraCosts ?? []).map((c) => ({ label: c.label, amount: centsToInput(c.amount) }))
  );
  const [shares, setShares] = useState<OrderProfitShareInput[]>(() => {
    const saved = order.profitShares ?? [];
    return saved.length > 0 ? saved.map((s) => ({ name: s.name, shareBps: s.shareBps })) : DEFAULT_SHARES;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const touch = () => setSaved(false);

  /* ----- revenue: every ringgit the customer actually paid, shipping included */
  const itemsRevenue = order.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const shipping = order.shippingFee;
  const discount = order.discountAmount;
  const revenue = order.total;

  /* ----- costs */
  const lineCost = (itemId: string, quantity: number) => {
    const cents = inputToCents(itemCosts[itemId] ?? '');
    return cents === null ? null : cents * quantity;
  };

  const unpricedCount = order.items.filter((i) => inputToCents(itemCosts[i.id] ?? '') === null).length;
  const itemCostTotal = order.items.reduce((sum, i) => sum + (lineCost(i.id, i.quantity) ?? 0), 0);
  const extrasTotal = extras.reduce((sum, e) => sum + (inputToCents(e.amount) ?? 0), 0);

  // Deliberately withheld until every line is priced. A partial total would
  // render as a plausible-looking profit that is simply wrong, and this page
  // is the input to what people get paid.
  const netProfit = unpricedCount > 0 ? null : revenue - itemCostTotal - extrasTotal;

  const totalBps = shares.reduce((sum, s) => sum + s.shareBps, 0);
  const amounts = netProfit === null ? [] : allocate(netProfit, shares.map((s) => s.shareBps));

  /* ----- dirty tracking, so Save only fires the calls that changed */
  const savedItemCosts = Object.fromEntries(order.items.map((i) => [i.id, centsToInput(i.unitCost)]));
  const savedExtras = (order.extraCosts ?? []).map((c) => ({ label: c.label, amount: centsToInput(c.amount) }));
  const savedShares = (order.profitShares ?? []).map((s) => ({ name: s.name, shareBps: s.shareBps }));

  const normalisedItemCosts = Object.fromEntries(
    order.items.map((i) => [i.id, centsToInput(inputToCents(itemCosts[i.id] ?? ''))])
  );
  const normalisedExtras = extras
    .filter((e) => e.label.trim() !== '' || inputToCents(e.amount) !== null)
    .map((e) => ({ label: e.label.trim(), amount: centsToInput(inputToCents(e.amount)) }));

  const costsDirty =
    JSON.stringify(normalisedItemCosts) !== JSON.stringify(savedItemCosts) ||
    JSON.stringify(normalisedExtras) !== JSON.stringify(savedExtras);
  const sharesDirty = JSON.stringify(shares) !== JSON.stringify(savedShares);
  const dirty = costsDirty || sharesDirty;

  const extrasValid = extras.every((e) => e.label.trim() !== '' && inputToCents(e.amount) !== null);
  const sharesValid =
    shares.length === 0 || (totalBps === 10_000 && shares.every((s) => s.name.trim() !== ''));
  const canSave = extrasValid && sharesValid;

  /* ----- split editing */
  const splitEvenly = (list: OrderProfitShareInput[]) => {
    if (list.length === 0) return list;
    const each = Math.floor(10_000 / list.length);
    return list.map((s, i) => ({ ...s, shareBps: i === list.length - 1 ? 10_000 - each * (list.length - 1) : each }));
  };

  const handleSave = async () => {
    if (!token || !canSave) return;
    setError(null);
    setSaving(true);
    try {
      if (costsDirty) {
        await adminUpdateOrderCosts(token, order.id, {
          itemCosts: order.items.map((i) => ({ itemId: i.id, unitCost: inputToCents(itemCosts[i.id] ?? '') })),
          extraCosts: extras
            .filter((e) => e.label.trim() !== '' && inputToCents(e.amount) !== null)
            .map((e) => ({ label: e.label.trim(), amount: inputToCents(e.amount) as number })),
        });
      }
      if (sharesDirty) {
        await adminUpdateOrderProfitShares(token, order.id, shares.map((s) => ({ ...s, name: s.name.trim() })));
      }
      setSaved(true);
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Revenue — shipping and discount shown as their own lines so the gap
          between the items total and what the customer actually paid is never
          unexplained. */}
      <Card title="Revenue" icon={<Wallet className="w-4 h-4" />}>
        <div className="space-y-1 max-w-md">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Items</span>
            <span className="font-medium">{formatPrice(itemsRevenue)}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-muted">Discount{order.discountCode?.code ? ` (${order.discountCode.code})` : ''}</span>
              <span className="font-medium text-success">-{formatPrice(discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Shipping charged</span>
            <span className="font-medium">{shipping ? formatPrice(shipping) : 'Free'}</span>
          </div>
          <div className="flex justify-between font-display font-bold text-base border-t border-border pt-2 mt-1">
            <span>Total revenue</span>
            <span>{formatPrice(revenue)}</span>
          </div>
        </div>
        {shipping > 0 && (
          <p className="text-xs text-text-muted mt-3">
            Shipping the customer paid counts as revenue. What the courier actually charged belongs
            in Extra Costs below.
          </p>
        )}
      </Card>

      {/* Per-item cost */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
          <Package className="w-4 h-4 text-text-muted" />
          <h2 className="text-sm font-semibold">Item Costs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                <th className="text-left px-5 py-3">Item</th>
                <th className="text-right px-3 py-3">Qty</th>
                <th className="text-right px-3 py-3 whitespace-nowrap">Revenue</th>
                <th className="text-right px-3 py-3 whitespace-nowrap">Unit Cost</th>
                <th className="text-right px-3 py-3 whitespace-nowrap">Line Cost</th>
                <th className="text-right px-5 py-3 whitespace-nowrap">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.map((item) => {
                const lineRevenue = item.unitPrice * item.quantity;
                const cost = lineCost(item.id, item.quantity);
                const lineProfit = cost === null ? null : lineRevenue - cost;
                return (
                  <tr key={item.id}>
                    <td className="px-5 py-3">
                      <span className="font-medium">
                        {item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''}
                      </span>
                      <span className="text-text-muted ml-2 text-xs font-mono">{item.variant.code}</span>
                    </td>
                    <td className="px-3 py-3 text-right">{item.quantity}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">{formatPrice(lineRevenue)}</td>
                    <td className="px-3 py-3">
                      <div className="relative w-32 ml-auto">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted">RM</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={itemCosts[item.id] ?? ''}
                          onChange={(e) => { setItemCosts((p) => ({ ...p, [item.id]: e.target.value })); touch(); }}
                          placeholder="0.00"
                          aria-label={`Unit cost for ${item.variant.product.name}`}
                          className="w-full pl-9 pr-2 py-1.5 border border-border rounded-lg text-sm bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {cost === null ? <span className="text-text-muted">—</span> : formatPrice(cost)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold whitespace-nowrap">
                      {lineProfit === null ? (
                        <span className="text-text-muted font-normal">—</span>
                      ) : (
                        <span className={lineProfit < 0 ? 'text-danger' : 'text-success'}>{formatPrice(lineProfit)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border bg-surface-elevated px-5 py-3 flex justify-between text-sm">
          <span className="text-text-muted">Total item cost</span>
          <span className="font-semibold">
            {unpricedCount > 0 && <span className="text-warning font-normal mr-2">{unpricedCount} not priced</span>}
            {formatPrice(itemCostTotal)}
          </span>
        </div>
      </div>

      {/* Extra costs */}
      <Card title="Extra Costs" icon={<Coins className="w-4 h-4" />}>
        {extras.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm text-text-muted mb-4">No extra costs recorded — fuel, courier charge, packaging.</p>
            <button
              onClick={() => { setExtras([{ label: '', amount: '' }]); touch(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add cost
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {extras.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => { setExtras((p) => p.map((r, j) => (j === i ? { ...r, label: e.target.value } : r))); touch(); }}
                    placeholder="e.g. Fuel, Courier, Packaging"
                    maxLength={60}
                    aria-label={`Extra cost ${i + 1} label`}
                    className="flex-1 min-w-0 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <div className="relative w-36 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">RM</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.amount}
                      onChange={(e) => { setExtras((p) => p.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r))); touch(); }}
                      placeholder="0.00"
                      aria-label={`Extra cost ${i + 1} amount`}
                      className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <button
                    onClick={() => { setExtras((p) => p.filter((_, j) => j !== i)); touch(); }}
                    aria-label={`Remove extra cost ${i + 1}`}
                    className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-border">
              <button
                onClick={() => { setExtras((p) => [...p, { label: '', amount: '' }]); touch(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add cost
              </button>
              <span className="text-sm font-semibold">{formatPrice(extrasTotal)}</span>
            </div>
            {!extrasValid && (
              <p className="text-xs text-danger mt-2">Every extra cost needs both a label and an amount.</p>
            )}
          </>
        )}
      </Card>

      {/* Bottom line */}
      <Card title="Net Profit" icon={<Scale className="w-4 h-4" />}>
        <div className="space-y-1 max-w-md">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Total revenue</span>
            <span className="font-medium">{formatPrice(revenue)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Item costs</span>
            <span className="font-medium text-danger">-{formatPrice(itemCostTotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Extra costs</span>
            <span className="font-medium text-danger">-{formatPrice(extrasTotal)}</span>
          </div>
          <div className="flex justify-between font-display font-bold text-lg border-t border-border pt-2 mt-1">
            <span>Net profit</span>
            {netProfit === null ? (
              <span className="text-text-muted">—</span>
            ) : (
              <span className={netProfit < 0 ? 'text-danger' : 'text-success'}>{formatPrice(netProfit)}</span>
            )}
          </div>
          {netProfit === null ? (
            <p className="text-xs text-warning pt-1">
              Give every item a unit cost to see profit — {unpricedCount} still unpriced.
            </p>
          ) : (
            revenue > 0 && (
              <p className="text-xs text-text-muted pt-1">{((netProfit / revenue) * 100).toFixed(1)}% margin</p>
            )
          )}
        </div>
      </Card>

      {/* Split */}
      <Card title="Split" icon={<Users className="w-4 h-4" />}>
        {shares.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-text-muted mb-4">No split recorded for this order.</p>
            <button
              onClick={() => { setShares(DEFAULT_SHARES); touch(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add people
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {shares.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => { setShares((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r))); touch(); }}
                    placeholder="Name"
                    maxLength={60}
                    aria-label={`Person ${i + 1} name`}
                    className="flex-1 min-w-0 px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <div className="relative w-28 shrink-0">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={bpsToPercent(row.shareBps)}
                      onChange={(e) => { setShares((p) => p.map((r, j) => (j === i ? { ...r, shareBps: Math.round(Number(e.target.value) * 100) || 0 } : r))); touch(); }}
                      aria-label={`Person ${i + 1} share percent`}
                      className="w-full pl-3 pr-7 py-2 border border-border rounded-lg text-sm bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">%</span>
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold">
                    {netProfit === null ? <span className="text-text-muted">—</span> : formatPrice(amounts[i] ?? 0)}
                  </span>
                  <button
                    onClick={() => { setShares((p) => splitEvenly(p.filter((_, j) => j !== i))); touch(); }}
                    aria-label={`Remove person ${i + 1}`}
                    className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 mt-4 pt-4 border-t border-border">
              <div className="flex gap-2">
                <button
                  onClick={() => { setShares((p) => splitEvenly([...p, { name: '', shareBps: 0 }])); touch(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add person
                </button>
                <button
                  onClick={() => { setShares(splitEvenly(shares)); touch(); }}
                  className="px-3 py-1.5 bg-surface-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors cursor-pointer"
                >
                  Split evenly
                </button>
              </div>
              <p className={`text-sm font-medium ${totalBps === 10_000 ? 'text-success' : 'text-danger'}`}>
                {bpsToPercent(totalBps)}%{totalBps !== 10_000 && ' — must be 100%'}
              </p>
            </div>
          </>
        )}
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={!dirty || !canSave || saving}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Profit Sharing'}
        </button>
        {saved && !dirty && <span className="text-sm text-success">Saved</span>}
      </div>
    </div>
  );
}
