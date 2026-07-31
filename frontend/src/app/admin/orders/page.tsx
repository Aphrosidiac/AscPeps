'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, ChevronDown, ChevronUp, ExternalLink, Truck, FileText, Trash2, RotateCcw, Mail } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetOrders, adminUpdateOrder, adminDeleteOrder, adminRestoreOrder, adminOpenReceiptPdf, adminResendOrderEmail } from '@/lib/api';
import { formatPrice, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS, PAYMENT_STATUS_COLORS } from '@/lib/constants';
import { EMAIL_TYPE_LABELS, emailStatusText } from '@/lib/email-status';
import { orderProgress } from '@/lib/order-progress';
import type { Order, OrderEmail } from '@/types';

// "DELETED" is a pseudo-status (not a real OrderStatus value) — it's a
// dedicated filter tab showing only soft-deleted orders, which every other
// tab excludes.
const STATUSES = ['ALL', 'PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'DELETED'];

// useSearchParams needs a Suspense boundary for this route to prerender —
// mirrors the same wrapping the admin Emails page uses.
export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<OrdersPageSkeleton />}>
      <AdminOrdersContent />
    </Suspense>
  );
}

function OrdersPageSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-surface-elevated rounded-xl" />)}
    </div>
  );
}

function AdminOrdersContent() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  // The admin Emails page links here as ?orderId=<id> ("Order #" column) —
  // auto-expand and scroll to that order once it's loaded.
  const orderIdParam = searchParams.get('orderId');
  const didAutoExpand = useRef(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [trackingInputs, setTrackingInputs] = useState<Record<string, string>>({});
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);

  const getTrackingValue = (order: Order) =>
    trackingInputs[order.id] ?? order.trackingNumber ?? '';

  const setTrackingValue = (orderId: string, value: string) => {
    setTrackingInputs((prev) => ({ ...prev, [orderId]: value }));
    setTrackingError(null);
  };

  const load = () => {
    if (!token) return;
    const params: Record<string, string> = { limit: '50' };
    if (statusFilter !== 'ALL') params.status = statusFilter;
    if (search) params.search = search;
    adminGetOrders(token, params)
      .then((r) => setOrders(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token, statusFilter, search]);

  // Runs once the target order has actually loaded — a plain status filter
  // (e.g. the order is CANCELLED) could otherwise leave this waiting forever,
  // so it only ever fires the one time and never fights a later manual
  // collapse/expand.
  useEffect(() => {
    if (didAutoExpand.current || !orderIdParam || orders.length === 0) return;
    if (!orders.some((o) => o.id === orderIdParam)) return;
    didAutoExpand.current = true;
    // Deferred to a frame rather than called synchronously here — same
    // "sync setState in an effect body" pattern the lint rule flags, and the
    // scroll needs the expanded row's layout to exist anyway.
    requestAnimationFrame(() => {
      setExpandedOrder(orderIdParam);
      document.getElementById(`order-${orderIdParam}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [orderIdParam, orders]);

  const handleStatusUpdate = async (orderId: string, status: string) => {
    if (!token) return;
    setTrackingError(null);
    setUpdating(orderId);
    try {
      const payload: Record<string, string> = { status };
      // Send tracking number along when marking as Shipped
      if (status === 'SHIPPED') {
        const tracking = trackingInputs[orderId]?.trim();
        if (tracking) payload.trackingNumber = tracking;
      }
      await adminUpdateOrder(token, orderId, payload);
      load();
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response: { data: { message?: string } } }).response?.data?.message
        : undefined;
      if (message) setTrackingError(message);
    } finally {
      setUpdating(null);
    }
  };

  const handleSaveTracking = async (orderId: string) => {
    if (!token) return;
    setTrackingError(null);
    const tracking = trackingInputs[orderId]?.trim() || '';
    setUpdating(orderId);
    try {
      await adminUpdateOrder(token, orderId, { trackingNumber: tracking });
      setTrackingInputs((prev) => { const next = { ...prev }; delete next[orderId]; return next; });
      load();
    } finally {
      setUpdating(null);
    }
  };

  const handlePaymentUpdate = async (orderId: string, paymentStatus: string, paymentGateway?: string | null) => {
    if (!token) return;
    if (paymentStatus === 'REFUNDED' && paymentGateway === 'toyyibpay') {
      const ok = window.confirm(
        'ToyyibPay has no automatic refund. This only restores stock and marks the order Refunded — you must process the actual refund manually in the ToyyibPay dashboard. Continue?'
      );
      if (!ok) return;
    }
    setUpdating(orderId);
    try {
      await adminUpdateOrder(token, orderId, { paymentStatus });
      load();
    } finally {
      setUpdating(null);
    }
  };

  const handleDelete = async (order: Order) => {
    if (!token || !confirm(`Delete order ${order.orderNumber}? It won't be permanently removed — you can restore it from the Deleted tab.`)) return;
    setUpdating(order.id);
    try {
      await adminDeleteOrder(token, order.id);
      load();
    } finally {
      setUpdating(null);
    }
  };

  const handleRestore = async (order: Order) => {
    if (!token) return;
    setUpdating(order.id);
    try {
      await adminRestoreOrder(token, order.id);
      load();
    } finally {
      setUpdating(null);
    }
  };

  const handleResendEmail = async (orderId: string, type: OrderEmail['type']) => {
    if (!token) return;
    setResendingEmail(`${orderId}:${type}`);
    try {
      await adminResendOrderEmail(token, orderId, type);
      load();
    } catch {
      // Non-critical — the status line simply won't change.
    } finally {
      setResendingEmail(null);
    }
  };

  const statusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">Orders</h1>
        <p className="text-sm text-text-muted">{orders.length} order{orders.length !== 1 ? 's' : ''}</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by order #, name, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                statusFilter === s
                  ? s === 'DELETED' ? 'bg-danger text-white' : 'bg-primary text-white'
                  : s === 'DELETED' ? 'bg-danger/10 text-danger hover:bg-danger/20' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
              }`}
            >
              {s === 'ALL' ? 'All' : s === 'DELETED' ? 'Deleted' : ORDER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-surface-elevated rounded-xl" />)}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-text-muted text-lg mb-1">No orders found</p>
          <p className="text-text-muted text-sm">
            {search ? 'Try a different search term.' : statusFilter !== 'ALL' ? 'No orders with this status.' : 'Orders will appear here once customers start purchasing.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order, rowIndex) => {
            const isExpanded = expandedOrder === order.id;
            const isUpdating = updating === order.id;
            const progress = orderProgress(order);
            // Only lock: an online-transfer payment that's already confirmed
            // Paid can't be changed further. Everything else (order status,
            // WhatsApp/manual-transfer payment status) is freely editable.
            const paymentLocked = order.paymentMethod === 'BILLPLZ' && order.paymentStatus === 'PAID';
            return (
              <div
                key={order.id}
                id={`order-${order.id}`}
                style={{ animationDelay: `${Math.min(rowIndex * 30, 300)}ms` }}
                className={`row-rise bg-surface rounded-xl border transition-all ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border hover:border-border-hover'}`}
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-surface-elevated/50 transition-colors"
                  onClick={() => { setExpandedOrder(isExpanded ? null : order.id); setTrackingError(null); }}
                >
                  <div className="flex items-center gap-4 sm:gap-6 min-w-0">
                    <div className="min-w-0">
                      {/* The order number is the way into the full detail page;
                          the rest of the row still toggles the inline expand,
                          so stop the click here from doing both. */}
                      <Link
                        href={`/admin/orders/${order.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-display font-semibold hover:text-primary hover:underline transition-colors"
                      >
                        {order.orderNumber}
                      </Link>
                      <p className="text-xs text-text-muted">{formatDate(order.createdAt)}</p>
                    </div>
                    <div className="hidden sm:block min-w-0">
                      <p className="text-sm font-medium truncate">{order.customerName}</p>
                      <p className="text-xs text-text-muted">{order.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <p className="font-display font-bold hidden sm:block">{formatPrice(order.total)}</p>
                    <Badge className={ORDER_STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                    <Badge className={`hidden sm:inline-flex ${PAYMENT_STATUS_COLORS[order.paymentStatus]}`}>{order.paymentStatus}</Badge>
                    {/* Whether the books are done with this order — separate
                        from its delivery status, because an order can be
                        delivered and still have no cost against it. */}
                    {progress.state !== 'NONE' && (
                      <Badge className={progress.className} title={progress.hint}>{progress.label}</Badge>
                    )}
                    {order.trackingNumber && (order.status === 'SHIPPED' || order.status === 'DELIVERED') && (
                      <span className="hidden lg:inline-flex items-center gap-1 text-xs text-text-muted font-mono"><Truck className="w-3 h-3" />{order.trackingNumber}</span>
                    )}
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="panel-reveal border-t border-border p-4 sm:p-6 space-y-5">
                    {/* Customer & Address */}
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Customer</p>
                        <p className="text-sm font-medium">{order.customerName}</p>
                        <p className="text-sm text-text-secondary">{order.phone}</p>
                        {order.email && <p className="text-sm text-text-secondary">{order.email}</p>}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Shipping Address</p>
                        <p className="text-sm text-text-secondary">{order.address}</p>
                        <p className="text-sm text-text-secondary">{order.city}, {order.state} {order.postcode}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Payment</p>
                        <p className="text-sm text-text-secondary">{order.paymentMethod === 'WHATSAPP' ? 'WhatsApp (Manual Transfer)' : `Online (${order.paymentGateway || 'Billplz'})`}</p>
                        {order.discountCode?.code && (
                          <p className="text-xs text-success mt-1">Discount: {order.discountCode.code}</p>
                        )}
                      </div>
                    </div>

                    {/* Items */}
                    <div>
                      <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Items ({order.items.length})</p>
                      <div className="bg-surface-elevated rounded-lg divide-y divide-border">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between px-4 py-3">
                            <div>
                              <p className="text-sm font-medium">{item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''}</p>
                              <p className="text-xs text-text-muted">{item.variant.code} &times; {item.quantity}</p>
                            </div>
                            <p className="text-sm font-semibold">{formatPrice(item.unitPrice * item.quantity)}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Price Breakdown */}
                    <div className="bg-surface-elevated rounded-lg px-4 py-3 space-y-1">
                      <div className="flex justify-between text-sm text-text-secondary">
                        <span>Subtotal</span>
                        <span>{formatPrice(order.subtotal || order.total)}</span>
                      </div>
                      {order.discountAmount > 0 && (
                        <div className="flex justify-between text-sm text-success">
                          <span>Discount</span>
                          <span>-{formatPrice(order.discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm text-text-secondary">
                        <span>Shipping</span>
                        <span>{!order.shippingFee ? 'Free' : formatPrice(order.shippingFee)}</span>
                      </div>
                      <div className="flex justify-between font-display font-bold text-base border-t border-border pt-1">
                        <span>Total</span>
                        <span>{formatPrice(order.total)}</span>
                      </div>
                    </div>

                    {order.notes && (
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">Notes</p>
                        <p className="text-sm text-text-secondary bg-surface-elevated rounded-lg px-4 py-3">{order.notes}</p>
                      </div>
                    )}

                    {/* Transactional Emails */}
                    {order.email && (
                      <div>
                        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">Emails</p>
                        <div className="flex flex-col gap-1.5">
                          {(['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT'] as const)
                            // A receipt only makes sense once the order is (or was) paid.
                            .filter((type) => type !== 'PAYMENT_RECEIPT' || order.paymentStatus === 'PAID' || order.emails?.some((e) => e.type === type))
                            .map((type) => {
                              const email = order.emails?.find((e) => e.type === type);
                              const { text, className } = emailStatusText(email);
                              const isResending = resendingEmail === `${order.id}:${type}`;
                              return (
                                <div key={type} className="flex items-center gap-2 text-sm">
                                  <Mail className="w-3.5 h-3.5 text-text-muted" />
                                  <span className="font-medium">{EMAIL_TYPE_LABELS[type]}:</span>
                                  <span className={className} title={email?.lastError ?? undefined}>{text}</span>
                                  {!order.deletedAt && (
                                    <button
                                      onClick={() => handleResendEmail(order.id, type)}
                                      disabled={isResending}
                                      className="px-2 py-0.5 bg-surface-elevated text-text-secondary rounded text-xs font-medium hover:bg-border hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      {isResending ? 'Queuing...' : email ? 'Resend' : 'Send'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {/* Tracking Number */}
                    {order.status !== 'CANCELLED' && (
                      <div className="pt-3 border-t border-border">
                        <label className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Tracking Number</label>
                        <div className="flex gap-2 items-center max-w-md">
                          <div className="relative flex-1">
                            <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                            <input
                              type="text"
                              value={getTrackingValue(order)}
                              onChange={(e) => setTrackingValue(order.id, e.target.value)}
                              placeholder="e.g. MY12345678901"
                              maxLength={50}
                              className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                            />
                          </div>
                          {(trackingInputs[order.id] !== undefined && trackingInputs[order.id] !== (order.trackingNumber ?? '')) && (
                            <button
                              onClick={() => handleSaveTracking(order.id)}
                              disabled={isUpdating}
                              className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                            >
                              Save
                            </button>
                          )}
                        </div>
                        {trackingError && expandedOrder === order.id && (
                          <p className="text-xs text-danger mt-1.5">{trackingError}</p>
                        )}
                        {!getTrackingValue(order) && order.status === 'CONFIRMED' && (
                          <p className="text-xs text-warning mt-1.5">Enter a tracking number before marking as Shipped</p>
                        )}
                      </div>
                    )}

                    {/* Status Controls */}
                    {order.deletedAt ? (
                      <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border">
                        <p className="text-sm text-danger">Deleted on {formatDate(order.deletedAt)}</p>
                        <button
                          onClick={() => handleRestore(order)}
                          disabled={isUpdating}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                        <button
                          onClick={() => adminOpenReceiptPdf(token!, order.id).catch(() => {})}
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5" /> Receipt
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-4 pt-3 border-t border-border">
                        <div>
                          <label className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Order Status</label>
                          <select
                            value={order.status}
                            onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                            disabled={isUpdating}
                            className="px-3 py-2 border border-border rounded-lg text-sm bg-surface font-medium disabled:opacity-50"
                          >
                            {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Payment Status</label>
                          <select
                            value={order.paymentStatus}
                            onChange={(e) => handlePaymentUpdate(order.id, e.target.value, order.paymentGateway)}
                            disabled={isUpdating || paymentLocked}
                            title={paymentLocked ? 'Paid via online transfer — locked, can no longer be changed' : undefined}
                            className="px-3 py-2 border border-border rounded-lg text-sm bg-surface font-medium disabled:opacity-50"
                          >
                            <option value="UNPAID">Unpaid</option>
                            <option value="PAID">Paid</option>
                            <option value="FAILED">Failed</option>
                            <option value="REFUNDED">Refunded</option>
                          </select>
                          {paymentLocked && (
                            <p className="text-xs text-text-muted mt-1">🔒 Paid online — locked</p>
                          )}
                        </div>
                        {order.paymentMethod === 'WHATSAPP' && (
                          <div className="flex items-end">
                            <a
                              href={`https://wa.me/${order.phone.replace(/[^0-9]/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" /> WhatsApp Customer
                            </a>
                          </div>
                        )}
                        <div className="flex items-end">
                          <button
                            onClick={() => adminOpenReceiptPdf(token!, order.id).catch(() => {})}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-surface-elevated text-text-primary rounded-lg text-sm font-medium hover:bg-border transition-colors cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" /> Receipt
                          </button>
                        </div>
                        <div className="flex items-end ml-auto">
                          <button
                            onClick={() => handleDelete(order)}
                            disabled={isUpdating}
                            className="inline-flex items-center gap-1.5 px-3 py-2 bg-danger/10 text-danger rounded-lg text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
