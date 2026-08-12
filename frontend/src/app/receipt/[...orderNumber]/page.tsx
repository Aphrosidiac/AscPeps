'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { FileText, Download, ArrowLeft, Search } from 'lucide-react';
import { getReceiptData, getReceiptPdfUrl } from '@/lib/api';
import { formatPrice, formatDate, normalizePhone, paymentMethodLabel } from '@/lib/utils';
import { ORDER_STATUS_LABELS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Animate } from '@/components/ui/Animate';
import type { Order } from '@/types';

export default function ReceiptPage() {
  const params = useParams<{ orderNumber: string[] }>();
  const orderNumber = (params.orderNumber as string[]).join('/');
  const searchParams = useSearchParams();
  const phoneParam = searchParams.get('phone') || '';

  const [order, setOrder] = useState<Order | null>(null);
  const [phone, setPhone] = useState(phoneParam);
  const [verifiedPhone, setVerifiedPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchReceipt = async (p: string) => {
    const normalized = normalizePhone(p);
    if (normalized.length < 10) {
      setError('Please enter a valid phone number');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getReceiptData(orderNumber, normalized);
      setOrder(data);
      setVerifiedPhone(normalized);
    } catch (err: unknown) {
      const status = err && typeof err === 'object' && 'response' in err
        ? (err as { response: { status: number } }).response?.status
        : 0;
      if (status === 403) {
        setError('Phone number does not match this order');
      } else if (status === 404) {
        setError('Order not found');
      } else {
        setError('Failed to load receipt');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (phoneParam) fetchReceipt(phoneParam);
  }, []);

  if (!order) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Animate variant="fadeUp" duration={0.6}>
          <div className="text-center mb-8">
            <FileText className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h1 className="font-display text-2xl font-bold mb-2">View Receipt</h1>
            <p className="text-text-secondary text-sm">
              Enter the phone number you used when placing order <span className="font-semibold">{orderNumber}</span>
            </p>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); fetchReceipt(phone); }}
            className="space-y-4"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(''); }}
                placeholder="012-3456789"
                className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            {error && <p className="text-sm text-danger text-center">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? 'Verifying...' : 'View Receipt'}
            </Button>
          </form>
        </Animate>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-16">
      <Animate variant="fadeUp" duration={0.5}>
        {/* Back + Download */}
        <div className="flex items-center justify-between mb-6">
          <Link href="/track" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" /> Track Order
          </Link>
          <a
            href={getReceiptPdfUrl(orderNumber, verifiedPhone)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors"
          >
            <Download className="w-4 h-4" /> Download PDF
          </a>
        </div>

        {/* Receipt Card */}
        <div className="bg-surface rounded-xl border border-border p-6 sm:p-8 space-y-6 print:border-0 print:shadow-none">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Image src="/images/pill-icon.png" alt="Ascend MY" width={36} height={36} className="invert dark:invert-0" />
              <span className="font-display text-xl font-bold">Ascend MY</span>
            </div>
            <div className="text-right">
              <p className="font-display text-lg font-bold text-text-muted">RECEIPT</p>
            </div>
          </div>

          {/* Order Info */}
          <div className="flex flex-wrap justify-between gap-4 text-sm">
            <div>
              <p className="text-text-muted text-xs uppercase tracking-wider font-medium mb-1">Order</p>
              <p className="font-semibold">{order.orderNumber}</p>
              <p className="text-text-secondary">{formatDate(order.createdAt)}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-text-secondary">{ORDER_STATUS_LABELS[order.status]}</p>
              <p className="text-text-muted text-xs">{order.paymentStatus}</p>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Customer */}
          <div>
            <p className="text-text-muted text-xs uppercase tracking-wider font-medium mb-2">Bill To</p>
            <p className="font-semibold">{order.customerName}</p>
            <p className="text-sm text-text-secondary">{order.phone}</p>
            {order.email && <p className="text-sm text-text-secondary">{order.email}</p>}
            <p className="text-sm text-text-secondary">{order.address}</p>
            <p className="text-sm text-text-secondary">{order.city}, {order.state} {order.postcode}</p>
          </div>

          <div className="border-t border-border" />

          {/* Items */}
          <div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-0 text-xs text-text-muted uppercase tracking-wider font-medium pb-2 border-b border-border">
              <span>Item</span>
              <span className="text-right w-12">Qty</span>
              <span className="text-right w-20">Amount</span>
            </div>
            {order.items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_auto_auto] gap-x-4 py-3 border-b border-border/50 text-sm">
                <div>
                  <p className="font-display font-bold">{item.variant.code}</p>
                  <p className="text-xs text-text-muted">
                    {item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''} &middot; {formatPrice(item.unitPrice)} each
                  </p>
                </div>
                <span className="text-right text-text-secondary w-12">{item.quantity}</span>
                <span className="text-right font-medium w-20">{formatPrice(item.unitPrice * item.quantity)}</span>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-text-secondary">
              <span>Subtotal</span>
              <span>{formatPrice(order.subtotal || order.total)}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-success">
                <span>Discount{order.discountCode ? ` (${order.discountCode.code})` : ''}</span>
                <span>-{formatPrice(order.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-text-secondary">
              <span>Shipping</span>
              <span>{!order.shippingFee ? 'Free' : formatPrice(order.shippingFee)}</span>
            </div>
            <div className="flex justify-between font-display font-bold text-lg border-t border-border pt-3">
              <span>Total</span>
              <span>{formatPrice(order.total)}</span>
            </div>
          </div>

          {/* Payment */}
          <div className="text-sm text-text-secondary">
            <p>
              Payment: {paymentMethodLabel(order)}
            </p>
          </div>

          {/* Tracking */}
          {order.trackingNumber && (order.status === 'SHIPPED' || order.status === 'DELIVERED') && (
            <div className="bg-surface-elevated rounded-lg px-4 py-3 flex items-center gap-3">
              <span className="text-xs text-text-muted uppercase tracking-wider font-medium">Tracking</span>
              <span className="font-mono text-sm font-semibold">{order.trackingNumber}</span>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-border pt-4 text-center">
            <p className="text-xs text-text-muted">All products are for research and laboratory use only.</p>
            <p className="text-xs text-text-muted mt-1">Thank you for your purchase.</p>
          </div>
        </div>
      </Animate>
    </div>
  );
}
