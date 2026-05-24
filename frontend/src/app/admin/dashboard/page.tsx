'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShoppingBag, DollarSign, Package, AlertTriangle, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetDashboard } from '@/lib/api';
import { formatPrice, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/lib/constants';

interface DashboardStats {
  todayOrders: number;
  todayRevenue: number;
  totalProducts: number;
  lowStockProducts: { id: string; code: string; name: string; stock: number }[];
  ordersByStatus: Record<string, number>;
  recentOrders: {
    id: string;
    orderNumber: string;
    customerName: string;
    total: number;
    status: string;
    createdAt: string;
    items: { product: { name: string; code: string } }[];
  }[];
}

export default function AdminDashboardPage() {
  const { token } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    if (token) {
      adminGetDashboard(token).then(setStats).catch(() => {});
    }
  }, [token]);

  if (!stats) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 bg-surface-elevated rounded w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 bg-surface-elevated rounded-xl" />)}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="h-64 bg-surface-elevated rounded-xl" />
          <div className="h-64 bg-surface-elevated rounded-xl" />
        </div>
      </div>
    );
  }

  const statCards = [
    { label: "Today's Orders", value: stats.todayOrders, icon: ShoppingBag, href: '/admin/orders' },
    { label: "Today's Revenue", value: formatPrice(stats.todayRevenue), icon: DollarSign, href: '/admin/orders' },
    { label: 'Total Products', value: stats.totalProducts, icon: Package, href: '/admin/products' },
    { label: 'Low Stock Items', value: stats.lowStockProducts.length, icon: AlertTriangle, href: '/admin/products' },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <Link key={card.label} href={card.href} className="bg-surface rounded-xl border border-border p-5 hover:border-border-hover hover:shadow-sm transition-all group">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-secondary">{card.label}</span>
              <card.icon className="w-4 h-4 text-text-muted group-hover:text-text-primary transition-colors" />
            </div>
            <p className="font-display text-2xl font-bold">{card.value}</p>
          </Link>
        ))}
      </div>

      {/* Order Status Breakdown */}
      {Object.keys(stats.ordersByStatus).length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-6 mb-6">
          <h2 className="font-display font-semibold text-lg mb-4">Orders by Status</h2>
          <div className="flex flex-wrap gap-3">
            {Object.entries(stats.ordersByStatus).map(([status, count]) => (
              <div key={status} className="flex items-center gap-2">
                <Badge className={ORDER_STATUS_COLORS[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
                <span className="text-sm font-semibold">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Orders */}
        <div className="bg-surface rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-lg">Recent Orders</h2>
            <Link href="/admin/orders" className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors flex items-center gap-1">
              View All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {stats.recentOrders.length === 0 ? (
            <div className="text-center py-8">
              <ShoppingBag className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">No orders yet</p>
              <p className="text-xs text-text-muted mt-1">Orders will appear here once customers start purchasing.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.recentOrders.map((order) => (
                <Link key={order.id} href="/admin/orders" className="flex items-center justify-between py-2.5 border-b border-border last:border-0 hover:bg-surface-elevated/50 -mx-2 px-2 rounded transition-colors">
                  <div>
                    <p className="font-medium text-sm">{order.orderNumber}</p>
                    <p className="text-xs text-text-muted">{order.customerName} &middot; {formatDate(order.createdAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display font-semibold text-sm">{formatPrice(order.total)}</p>
                    <Badge className={ORDER_STATUS_COLORS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Low Stock */}
        <div className="bg-surface rounded-xl border border-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-lg">Low Stock Alerts</h2>
            <Link href="/admin/products" className="text-xs font-medium text-text-muted hover:text-text-primary transition-colors flex items-center gap-1">
              Manage <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {stats.lowStockProducts.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm text-text-muted">All products are well stocked</p>
            </div>
          ) : (
            <div className="space-y-3">
              {stats.lowStockProducts.map((p) => (
                <Link key={p.id} href="/admin/products" className="flex items-center justify-between py-2.5 border-b border-border last:border-0 hover:bg-surface-elevated/50 -mx-2 px-2 rounded transition-colors">
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs text-text-muted font-mono">{p.code}</p>
                  </div>
                  <Badge className={p.stock === 0 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}>
                    {p.stock === 0 ? 'Out of stock' : `${p.stock} left`}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
