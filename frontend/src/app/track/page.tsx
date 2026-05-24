'use client';

import { useState } from 'react';
import { Search, Package } from 'lucide-react';
import { lookupOrders } from '@/lib/api';
import { formatPrice, formatDate } from '@/lib/utils';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/lib/constants';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Order } from '@/types';

export default function TrackPage() {
  const [phone, setPhone] = useState('');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setLoading(true);
    try {
      const result = await lookupOrders(phone.trim());
      setOrders(result);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div className="text-center mb-8">
        <Package className="w-12 h-12 text-text-muted mx-auto mb-4" />
        <h1 className="font-display text-3xl font-bold mb-2">Track Your Order</h1>
        <p className="text-text-secondary">Enter the phone number you used when placing your order.</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 mb-8">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="012-3456789"
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <Button type="submit" disabled={loading} size="lg">
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </form>

      {searched && orders !== null && (
        orders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-muted">No orders found for this phone number.</p>
          </div>
        ) : (
          <div className="space-y-4">
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
                <div className="space-y-2 mb-4">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-text-secondary">{item.product.name} x{item.quantity}</span>
                      <span>{formatPrice(item.unitPrice * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border pt-3 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>{formatPrice(order.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
