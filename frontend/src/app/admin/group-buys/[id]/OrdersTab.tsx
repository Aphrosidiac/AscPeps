'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { adminGroupBuyOrders, type AdminGbOrderRow, type AdminGroupBuy } from '@/lib/group-buy-api';
import { formatPrice, cn } from '@/lib/utils';
import { Card } from '@/components/admin/ui';
import { shortDateTime } from '../shared';

const PAY: Record<string, string> = { PAID: 'text-success', UNPAID: 'text-amber-700', FAILED: 'text-danger', REFUNDED: 'text-text-secondary' };

/** The batch's orders. Each opens the ordinary order page, where it is packed and shipped. */
export function OrdersTab({ gb, token }: { gb: AdminGroupBuy; token: string }) {
  const [rows, setRows] = useState<AdminGbOrderRow[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  useEffect(() => { adminGroupBuyOrders(token, gb.id).then(setRows).catch(() => setRows([])); }, [token, gb.id]);

  const shown = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || (filter === 'paid' ? r.paymentStatus === 'PAID' : r.paymentStatus === 'UNPAID')), [rows, filter]);

  if (rows === null) return <div className="h-40 rounded-[10px] bg-surface-elevated animate-pulse" />;
  if (rows.length === 0) return <Card className="px-6 py-10 text-center text-[14px] text-text-secondary">No orders in this batch yet.</Card>;

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['all', 'paid', 'unpaid'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn('rounded-full border px-3 py-1 text-[13px] capitalize', filter === f ? 'border-text-primary bg-text-primary text-white' : 'border-border text-text-secondary hover:text-text-primary')}>
            {f}
          </button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[14px]">
          <thead className="text-left text-[12px] text-text-secondary">
            <tr className="border-b border-border"><th className="px-5 py-2.5 font-medium">Order</th><th className="px-3 py-2.5 font-medium">Customer</th><th className="px-3 py-2.5 font-medium">Items</th><th className="px-3 py-2.5 font-medium">Payment</th><th className="px-5 py-2.5 text-right font-medium">Total</th></tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                <td className="px-5 py-3">
                  <Link href={`/admin/orders/${o.id}`} className="font-medium text-text-primary hover:underline">{o.orderNumber}</Link>
                  <p className="text-[12px] text-text-secondary">{shortDateTime(o.createdAt)}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="text-text-primary">{o.customerName}</p>
                  <p className="text-[12px] text-text-secondary">{o.email ?? o.phone}</p>
                </td>
                <td className="px-3 py-3 text-[13px]">
                  <p>{o.summary}</p>
                  <p className="text-[12px] text-text-secondary">{o.vials} vials{o.discountCode ? ` · code ${o.discountCode.code}` : ''}</p>
                </td>
                <td className={cn('px-3 py-3 text-[13px] font-medium', PAY[o.paymentStatus])}>
                  {o.paymentStatus.charAt(0) + o.paymentStatus.slice(1).toLowerCase()}
                  <p className="text-[12px] font-normal text-text-secondary">{o.status.charAt(0) + o.status.slice(1).toLowerCase()}</p>
                </td>
                <td className="px-5 py-3 text-right font-medium tabular-nums">{formatPrice(o.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
