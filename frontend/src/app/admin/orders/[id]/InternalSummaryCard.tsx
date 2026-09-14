'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, Tags, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { adminGetShadowSummary } from '@/lib/api';
import { InternalSheetDialog } from '@/components/admin/InternalSheetDialog';
import { formatPrice } from '@/lib/utils';
import type { Order, ShadowSummary } from '@/types';

/**
 * This order in the generalised internal vocabulary.
 *
 * Deliberately a panel on the Info tab rather than a fifth tab: the order's tab
 * bar is tuned to exactly four labels on a phone (see the note above it), and
 * this belongs next to the real item table anyway — the point of it is the
 * comparison.
 *
 * Everything here is a live read of the current mapping — nothing is stored,
 * nothing is frozen, and the same is true of the sheet itself. Change a shadow
 * name and this panel says the new thing on the next load.
 */
export function InternalSummaryCard({ order }: { order: Order }) {
  const { token } = useAuth();
  const [summary, setSummary] = useState<ShadowSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    adminGetShadowSummary(token, order.id)
      .then(setSummary)
      .catch(() => setError('Could not load the internal summary.'))
      .finally(() => setLoading(false));
  }, [token, order.id]);

  useEffect(load, [load]);

  if (loading) return null;

  return (
    <div className="mt-6 border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 bg-surface-elevated border-b border-border">
        <Tags className="w-4 h-4 text-text-muted shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Internal summary</h3>
          <p className="text-xs text-text-muted">
            Generalised item names. Not a receipt — the customer&apos;s receipt is unchanged.
          </p>
        </div>
        {/* The same dialog either way: it shows the sheet when every line
            resolves, and lets the missing lines be mapped when they don't. */}
        {summary && (
          <button
            onClick={() => setViewing(true)}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-light transition-colors cursor-pointer shrink-0"
          >
            {summary.complete ? (
              <><Eye className="w-3.5 h-3.5" /> View sheet</>
            ) : (
              <><Tags className="w-3.5 h-3.5" /> Map items</>
            )}
          </button>
        )}
      </div>

      {error && <p className="px-5 py-3 text-xs text-danger">{error}</p>}

      {summary && !summary.complete ? (
        <div className="px-5 py-4">
          <p className="flex items-start gap-2 text-sm text-warning">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {summary.unmapped.length} item{summary.unmapped.length === 1 ? '' : 's'} on this order
              {summary.unmapped.length === 1 ? ' has' : ' have'} no shadow code, so no sheet can be
              produced. Falling back to the real product name would defeat the point.
            </span>
          </p>
          <ul className="mt-2 ml-6 text-xs text-text-muted list-disc">
            {summary.unmapped.map((u) => (
              <li key={u.itemId}>
                {u.realName} <span className="font-mono">({u.realCode})</span>
              </li>
            ))}
          </ul>
          <Link
            href="/admin/shadow-skus?unmapped=1"
            className="inline-block mt-3 text-xs font-medium text-primary underline"
          >
            Map them on Shadow SKUs →
          </Link>
        </div>
      ) : summary ? (
        <>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {summary.lines.map((line) => (
                <tr key={line.itemId}>
                  <td className="px-5 py-3">
                    <span className="font-medium">{line.name}</span>
                    <span className="text-text-muted ml-2 text-xs font-mono">{line.code}</span>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">{line.quantity}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {formatPrice(line.unitPrice * line.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border bg-surface-elevated px-5 py-3 flex justify-between text-sm">
            <span className="text-text-secondary">Total — same as the real order</span>
            <span className="font-semibold">{formatPrice(summary.order.total)}</span>
          </div>
        </>
      ) : null}

      {viewing && (
        <InternalSheetDialog
          orderId={order.id}
          orderNumber={order.orderNumber}
          onClose={() => setViewing(false)}
          onMapped={load}
        />
      )}
    </div>
  );
}
