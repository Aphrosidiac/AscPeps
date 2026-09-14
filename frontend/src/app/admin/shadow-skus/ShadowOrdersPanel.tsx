'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Search, FileText, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetShadowOrders } from '@/lib/api';
import { InternalSheetDialog } from '@/components/admin/InternalSheetDialog';
import { cn, formatPrice, formatShortDate } from '@/lib/utils';
import type { ShadowOrderRow } from '@/types';

/**
 * The backlog: every order and whether its internal summary can be produced.
 *
 * Both states are filtered server-side so the counts mean the whole collection
 * and not the page that happened to arrive:
 *   Ready   — every line resolves to a shadow code
 *   Blocked — at least one SKU has none, so no sheet is possible
 *
 * The whole row opens the sheet, because "let me look at this one" is the only
 * thing anyone comes to this list to do. There is no produce-then-download
 * step: the sheet is regenerated from the current mapping every time it is
 * asked for, so viewing it costs nothing and changes nothing.
 */

type State = '' | 'ready' | 'blocked';

const FILTERS: { key: State; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'ready', label: 'Ready' },
  { key: 'blocked', label: 'Blocked' },
];

export function ShadowOrdersPanel({
  onMapped,
  onGoToCodes,
}: {
  /** A SKU was mapped from inside a sheet dialog — coverage and the table above need refetching. */
  onMapped?: () => void;
  onGoToCodes?: () => void;
}) {
  const { token } = useAuth();
  const [rows, setRows] = useState<ShadowOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<State>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<ShadowOrderRow | null>(null);

  const params = useCallback(
    (which: number) => {
      const p: Record<string, string> = { page: String(which), limit: '50' };
      if (state) p.state = state;
      if (search.trim()) p.search = search.trim();
      return p;
    },
    [state, search],
  );

  const load = useCallback(() => {
    if (!token) return;
    setPage(1);
    adminGetShadowOrders(token, params(1))
      .then((r) => {
        setRows(r.data);
        setTotal(r.pagination.total);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [token, params]);

  const loadMore = () => {
    if (!token || loadingMore) return;
    const next = page + 1;
    setLoadingMore(true);
    adminGetShadowOrders(token, params(next))
      .then((r) => {
        setRows((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...r.data.filter((x) => !seen.has(x.id))];
        });
        setTotal(r.pagination.total);
        setPage(next);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  return (
    <div>
      <div className="mb-4 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search an order number"
            aria-label="Search orders"
            className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              onClick={() => setState(f.key)}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                state === f.key
                  ? 'bg-primary text-white'
                  : 'bg-surface-elevated text-text-secondary hover:bg-border',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : failed ? (
        <p className="text-sm text-danger">Could not load orders.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">No orders match that.</p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm min-w-[42rem]">
            <thead className="bg-surface-elevated text-text-muted text-xs">
              <tr>
                <th className="p-3 text-left font-medium">Order</th>
                <th className="p-3 text-left font-medium">Date</th>
                <th className="p-3 text-right font-medium">Total</th>
                <th className="p-3 text-left font-medium">Sheet</th>
                <th className="p-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setOpen(row)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open the internal summary for ${row.orderNumber}`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpen(row);
                    }
                  }}
                  className="border-t border-border cursor-pointer hover:bg-surface-elevated focus:bg-surface-elevated focus:outline-none transition-colors"
                >
                  <td className="p-3">
                    <span className="font-medium">{row.orderNumber}</span>
                    <span className="block text-xs text-text-muted">
                      {row.lineCount} line{row.lineCount === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="p-3 text-text-muted text-xs whitespace-nowrap">
                    {formatShortDate(row.createdAt)}
                  </td>
                  <td className="p-3 text-right tabular-nums whitespace-nowrap">
                    {formatPrice(row.total)}
                  </td>
                  <td className="p-3">
                    {row.complete ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <FileText className="w-3.5 h-3.5" /> Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {row.unmappedCount} unmapped
                      </span>
                    )}
                  </td>
                  {/* The row is the affordance; this is the arrow that says so. */}
                  <td className="p-3 text-right">
                    <ChevronRight className="w-4 h-4 text-text-muted inline-block" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="mt-3 flex items-center gap-3">
          <p className="text-xs text-text-muted">Showing {rows.length} of {total}</p>
          {rows.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated text-text-secondary text-xs font-medium hover:bg-border disabled:opacity-40 transition-colors cursor-pointer"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      {open && (
        <InternalSheetDialog
          orderId={open.id}
          orderNumber={open.orderNumber}
          onClose={() => setOpen(null)}
          // The row's "N unmapped" badge is server-counted, so it only moves
          // when the list is refetched.
          onMapped={() => { load(); onMapped?.(); }}
          onGoToCodes={onGoToCodes}
        />
      )}
    </div>
  );
}
