'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X, ShoppingBag, Receipt } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetOrder, adminGetOrders, adminGetExpenses } from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import type { CompanyExpense, Order } from '@/types';

/**
 * Choosing what a document is evidence for.
 *
 * Two lists rather than one search box across both, because the two questions
 * are asked differently: an order is looked up by a number you are reading off
 * something ("ASC2608/0022"), while an expense is recognised on sight from a
 * short list you already know. Merging them into one ranked result set would
 * make the common case — paste an order number — worse.
 *
 * Selection is held by the parent so the same component serves both the upload
 * form (links chosen before the document exists) and the detail panel (links
 * edited afterwards).
 */
export interface LinkSelection {
  orderIds: string[];
  expenseIds: string[];
}

export function LinkPicker({
  value,
  onChange,
}: {
  value: LinkSelection;
  onChange: (next: LinkSelection) => void;
}) {
  const { token } = useAuth();
  const [tab, setTab] = useState<'orders' | 'expenses'>('orders');

  const [orderQuery, setOrderQuery] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<CompanyExpense[]>([]);
  const [loading, setLoading] = useState(false);

  // Everything ever selected, kept so a chosen row still renders its name after
  // the search that found it has been typed over. Without this, picking an
  // order and then searching for another makes the first one look unselected.
  const [seenOrders, setSeenOrders] = useState<Record<string, Order>>({});
  const [seenExpenses, setSeenExpenses] = useState<Record<string, CompanyExpense>>({});

  useEffect(() => {
    if (!token || tab !== 'orders') return;
    let cancelled = false;
    // Debounced: this fires on every keystroke otherwise, and an order number
    // is a dozen characters. `setLoading` sits inside the timer rather than in
    // the effect body — React flags a synchronous setState there, and the
    // spinner belongs to the request, not to the wait before it starts.
    const timer = setTimeout(() => {
      setLoading(true);
      adminGetOrders(token, { limit: '8', ...(orderQuery.trim() ? { search: orderQuery.trim() } : {}) })
        .then((res) => {
          if (cancelled) return;
          setOrders(res.data);
          setSeenOrders((prev) => ({ ...prev, ...Object.fromEntries(res.data.map((o) => [o.id, o])) }));
        })
        .catch(() => { if (!cancelled) setOrders([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [token, tab, orderQuery]);

  // A preselected order — opened from that order's own page, or already linked
  // on a document being edited — is not necessarily in the first page of
  // results, and an unresolved chip reads as a bare "Order" with no way to tell
  // which. Fetch the ones we cannot name.
  useEffect(() => {
    if (!token) return;
    const missing = value.orderIds.filter((id) => !seenOrders[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(missing.map((id) => adminGetOrder(token, id).catch(() => null))).then((rows) => {
      if (cancelled) return;
      const found = rows.filter(Boolean) as Order[];
      if (found.length) setSeenOrders((prev) => ({ ...prev, ...Object.fromEntries(found.map((o) => [o.id, o])) }));
    });
    return () => { cancelled = true; };
  }, [token, value.orderIds, seenOrders]);

  useEffect(() => {
    if (!token || tab !== 'expenses' || expenses.length > 0) return;
    let cancelled = false;
    // Wrapped rather than called straight from the effect body, for the same
    // reason as above: a synchronous setState in an effect cascades a render.
    const run = async () => {
      setLoading(true);
      try {
        const res = await adminGetExpenses(token);
        if (cancelled) return;
        setExpenses(res.expenses);
        setSeenExpenses(Object.fromEntries(res.expenses.map((e) => [e.id, e])));
      } catch {
        if (!cancelled) setExpenses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [token, tab, expenses.length]);

  const toggleOrder = (id: string) =>
    onChange({
      ...value,
      orderIds: value.orderIds.includes(id)
        ? value.orderIds.filter((x) => x !== id)
        : [...value.orderIds, id],
    });

  const toggleExpense = (id: string) =>
    onChange({
      ...value,
      expenseIds: value.expenseIds.includes(id)
        ? value.expenseIds.filter((x) => x !== id)
        : [...value.expenseIds, id],
    });

  const selectedCount = value.orderIds.length + value.expenseIds.length;

  const chips = useMemo(
    () => [
      ...value.orderIds.map((id) => ({
        id,
        kind: 'order' as const,
        label: seenOrders[id]?.orderNumber ?? 'Order',
        onRemove: () => toggleOrder(id),
      })),
      ...value.expenseIds.map((id) => ({
        id,
        kind: 'expense' as const,
        label: seenExpenses[id]?.description ?? 'Expense',
        onRemove: () => toggleExpense(id),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, seenOrders, seenExpenses]
  );

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {(['orders', 'expenses'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer capitalize',
              tab === t ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:bg-border'
            )}
          >
            {t}
          </button>
        ))}
        <span className="text-xs text-text-muted ml-auto">
          {selectedCount === 0 ? 'Nothing selected' : `${selectedCount} selected`}
        </span>
      </div>

      {/* Selected things stay visible above the list, so what you have chosen
          never depends on what the list currently happens to show. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {chips.map((chip) => (
            <span
              key={`${chip.kind}-${chip.id}`}
              className={cn(
                'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs',
                chip.kind === 'order' ? 'bg-primary/10 text-primary' : 'bg-blue-100 text-blue-800'
              )}
            >
              <span className="truncate max-w-[12rem]">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove ${chip.label}`}
                className="p-0.5 rounded-full hover:bg-black/10 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div className="relative mb-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={orderQuery}
            onChange={(e) => setOrderQuery(e.target.value)}
            placeholder="Order number, customer or phone"
            aria-label="Search orders"
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      )}

      <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-6 text-center text-xs text-text-muted">Loading…</p>
        ) : tab === 'orders' ? (
          orders.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-muted">No orders found.</p>
          ) : (
            orders.map((o) => {
              const on = value.orderIds.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleOrder(o.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer',
                    on ? 'bg-primary/5' : 'hover:bg-surface-elevated'
                  )}
                >
                  <ShoppingBag className={cn('w-4 h-4 shrink-0', on ? 'text-primary' : 'text-text-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{o.orderNumber}</span>
                    <span className="block text-xs text-text-muted truncate">
                      {o.customerName} · {formatShortDate(o.createdAt)}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-text-secondary shrink-0">{formatPrice(o.total)}</span>
                </button>
              );
            })
          )
        ) : expenses.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-muted">No company spending recorded yet.</p>
        ) : (
          expenses.map((e) => {
            const on = value.expenseIds.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => toggleExpense(e.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer',
                  on ? 'bg-primary/5' : 'hover:bg-surface-elevated'
                )}
              >
                <Receipt className={cn('w-4 h-4 shrink-0', on ? 'text-primary' : 'text-text-muted')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{e.description}</span>
                  <span className="block text-xs text-text-muted truncate">
                    {e.category} · {formatShortDate(e.occurredAt)}
                  </span>
                </span>
                <span className="text-xs tabular-nums text-text-secondary shrink-0">{formatPrice(e.amount)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
