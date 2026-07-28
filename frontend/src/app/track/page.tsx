'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Package, Truck, FileText } from 'lucide-react';
import posthog from 'posthog-js';
import { lookupOrders } from '@/lib/api';
import { formatPrice, formatDate, normalizePhone } from '@/lib/utils';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate, Stagger } from '@/components/ui/Animate';
import type { Order } from '@/types';

export default function TrackPage() {
  const [phone, setPhone] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const normalizedPhone = normalizePhone(phone);
  const canSearch = normalizedPhone.length >= 10 || orderNumber.trim().length >= 3;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    try {
      const result = await lookupOrders(
        normalizedPhone.length >= 10 ? normalizedPhone : undefined,
        orderNumber.trim() || undefined,
      );
      setOrders(result);
      posthog.capture('order_tracked', {
        orders_found: result.length,
        search_type: normalizedPhone.length >= 10 ? 'phone' : 'order_number',
      });
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <Animate variant="fadeUp" duration={0.6}>
        <div className="text-center mb-8">
          <Package className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h1 className="font-display text-3xl font-bold mb-2">Track Your Order</h1>
          <p className="text-text-secondary">Enter your order number or the phone number you used when placing your order.</p>
        </div>
      </Animate>

      <Animate variant="fadeUp" delay={0.15} duration={0.5}>
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3 mb-8">
        <div className="relative flex-1">
          <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="Order number"
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="012-3456789"
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <Button type="submit" disabled={loading || !canSearch} size="lg">
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </form>
      </Animate>

      {searched && orders !== null && (
        orders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-muted">No order found. Check your order number and phone number and try again.</p>
          </div>
        ) : (
          <Stagger className="space-y-4" stagger={0.08}>
            {orders.map((order) => (
              <div key={order.id} className="bg-surface rounded-xl border border-border p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="font-display font-bold">{order.orderNumber}</p>
                    <p className="text-sm text-text-muted">{formatDate(order.createdAt)}</p>
                  </div>
                  <Badge className={ORDER_STATUS_COLORS[order.status]}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                </div>
                {order.trackingNumber && (order.status === 'SHIPPED' || order.status === 'DELIVERED') && (
                  <div className="flex items-center gap-2 bg-surface-elevated rounded-lg px-4 py-2.5 mb-4">
                    <Truck className="w-4 h-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs text-text-muted">Tracking Number</p>
                      <p className="text-sm font-semibold font-mono">{order.trackingNumber}</p>
                    </div>
                  </div>
                )}
                <div className="space-y-2 mb-4">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-text-secondary">{item.variant.product.name}{item.variant.size ? ` ${item.variant.size}` : ''} x{item.quantity}</span>
                      <span>{formatPrice(item.unitPrice * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-3 flex items-center justify-between">
                  <div className="font-semibold">
                    <span>Total: </span>
                    <span>{formatPrice(order.total)}</span>
                  </div>
                  <Link
                    href={`/receipt/${order.orderNumber}${normalizedPhone.length >= 10 ? `?phone=${encodeURIComponent(normalizedPhone)}` : ''}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-surface-elevated hover:bg-border rounded-lg transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" /> Receipt
                  </Link>
                </div>
              </div>
            ))}
          </Stagger>
        )
      )}
    </div>
  );
}
