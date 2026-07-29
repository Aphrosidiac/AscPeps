'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, User, FileText, Truck, Trash2, RotateCcw, Mail, ExternalLink, Plus, X, Hash, Scale,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetOrder, adminUpdateOrder, adminUpdateOrderProfitShares,
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
  const [cost, setCost] = useState(order.costAmount != null ? (order.costAmount / 100).toFixed(2) : '');
  const [rows, setRows] = useState<OrderProfitShareInput[]>(
    () => (order.profitShares ?? []).map((s) => ({ name: s.name, shareBps: s.shareBps }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const revenue = order.total;
  const costCents = cost.trim() === '' ? null : Math.round(Number(cost) * 100);
  const costValid = costCents === null || (Number.isFinite(costCents) && costCents >= 0);
  const profit = costCents === null || !costValid ? null : revenue - costCents;

  const totalBps = rows.reduce((sum, r) => sum + r.shareBps, 0);
  const amounts = profit === null ? [] : allocate(profit, rows.map((r) => r.shareBps));

  const costDirty = (order.costAmount ?? null) !== (costValid ? costCents : order.costAmount ?? null);
  const rowsDirty = JSON.stringify(rows) !== JSON.stringify((order.profitShares ?? []).map((s) => ({ name: s.name, shareBps: s.shareBps })));
  const dirty = costDirty || rowsDirty;

  // Re-splits evenly across every row, giving the remainder to the last person
  // so the total is exactly 100% (3 people => 33.33 / 33.33 / 33.34).
  const splitEvenly = (list: OrderProfitShareInput[]) => {
    if (list.length === 0) return list;
    const each = Math.floor(10_000 / list.length);
    return list.map((r, i) => ({ ...r, shareBps: i === list.length - 1 ? 10_000 - each * (list.length - 1) : each }));
  };

  const addRow = () => {
    setSaved(false);
    setRows((prev) => splitEvenly([...prev, { name: '', shareBps: 0 }]));
  };

  const removeRow = (index: number) => {
    setSaved(false);
    setRows((prev) => splitEvenly(prev.filter((_, i) => i !== index)));
  };

  const updateRow = (index: number, patch: Partial<OrderProfitShareInput>) => {
    setSaved(false);
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const canSave =
    costValid &&
    (rows.length === 0 || (totalBps === 10_000 && rows.every((r) => r.name.trim() !== '')));

  const handleSave = async () => {
    if (!token || !canSave) return;
    setError(null);
    setSaving(true);
    try {
      if (costDirty) await adminUpdateOrder(token, order.id, { costAmount: costCents });
      if (rowsDirty) await adminUpdateOrderProfitShares(token, order.id, rows.map((r) => ({ ...r, name: r.name.trim() })));
      setSaved(true);
      onChange();
    } catch (err) {
      setError(apiErrorMessage(err) ?? 'Could not save the profit split.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-surface-elevated border border-border rounded-xl px-5 py-3.5 text-sm text-text-secondary">
        First pass — profit is revenue minus one manually-entered cost figure, since nothing in the
        catalogue tracks cost per product yet. The split is stored per order, so changing it later
        never rewrites what a past order already recorded.
      </div>

      <Card title="Profit" icon={<Scale className="w-4 h-4" />}>
        <div className="grid sm:grid-cols-3 gap-5">
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">Revenue</p>
            <p className="font-display text-xl font-bold">{formatPrice(revenue)}</p>
            <p className="text-xs text-text-muted mt-1">Order total paid</p>
          </div>
          <div>
            <label htmlFor="cost" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
              Cost of Goods
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">RM</span>
              <input
                id="cost"
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(e) => { setCost(e.target.value); setSaved(false); }}
                placeholder="0.00"
                className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            {!costValid && <p className="text-xs text-danger mt-1">Enter a valid amount.</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1.5">Gross Profit</p>
            {profit === null ? (
              <>
                <p className="font-display text-xl font-bold text-text-muted">—</p>
                <p className="text-xs text-text-muted mt-1">Enter a cost to calculate</p>
              </>
            ) : (
              <>
                <p className={`font-display text-xl font-bold ${profit < 0 ? 'text-danger' : 'text-success'}`}>
                  {formatPrice(profit)}
                </p>
                <p className="text-xs text-text-muted mt-1">
                  {revenue > 0 ? `${((profit / revenue) * 100).toFixed(1)}% margin` : '—'}
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title="Split" icon={<User className="w-4 h-4" />}>
        {rows.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-text-muted mb-4">No split recorded for this order yet.</p>
            <button
              onClick={addRow}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add person
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(i, { name: e.target.value })}
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
                      onChange={(e) => updateRow(i, { shareBps: Math.round(Number(e.target.value) * 100) || 0 })}
                      aria-label={`Person ${i + 1} share percent`}
                      className="w-full pl-3 pr-7 py-2 border border-border rounded-lg text-sm bg-surface text-right focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">%</span>
                  </div>
                  <span className="w-24 shrink-0 text-right text-sm font-semibold">
                    {profit === null ? <span className="text-text-muted">—</span> : formatPrice(amounts[i] ?? 0)}
                  </span>
                  <button
                    onClick={() => removeRow(i)}
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
                  onClick={addRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Add person
                </button>
                <button
                  onClick={() => { setRows(splitEvenly(rows)); setSaved(false); }}
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
