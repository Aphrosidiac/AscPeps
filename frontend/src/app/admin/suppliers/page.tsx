'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Handshake, Plus, Pencil, Check, X, Search, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminCreateSupplier,
  adminDeleteSupplier,
  adminGetSupplierSheet,
  adminGetSuppliers,
  adminSetSupplierCosts,
  adminUpdateSupplier,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import { PageHeader, SaveBar } from '@/components/admin/ui';
import type { Supplier, SupplierSheet } from '@/types';

/**
 * Suppliers — who the business buys from, and what each of them charges per
 * unit of each SKU.
 *
 * It is laid out as the sheet the partners already keep by hand: one row per
 * sellable SKU, one column per supplier, a price in each cell. The order page's
 * costing sheet reads this to offer "YL,C · RM65.00" from a dropdown instead
 * of a blank box, which is what makes the same vial stop being costed at four
 * different figures across a month.
 *
 * A price changed here never rewrites an order already costed: the order line
 * copied the figure when it was picked and records whose it was.
 */

const centsToInput = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

function inputToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const cellKey = (supplierId: string, variantId: string) => `${supplierId}:${variantId}`;

function apiError(e: unknown, fallback: string) {
  const err = e as { response?: { data?: { error?: string; details?: { message: string }[] } } };
  return err.response?.data?.details?.[0]?.message ?? err.response?.data?.error ?? fallback;
}

/* ------------------------------------------------------------------ chips */

function SupplierStrip({
  suppliers,
  onChanged,
  onError,
}: {
  suppliers: Supplier[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const add = async () => {
    if (!token || !name.trim()) return;
    setBusy(true);
    try {
      await adminCreateSupplier(token, { name: name.trim() });
      setName('');
      onChanged();
    } catch (e) {
      onError(apiError(e, 'Could not add that supplier.'));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (s: Supplier) => {
    if (!token || !draft.trim()) return;
    setBusy(true);
    try {
      await adminUpdateSupplier(token, s.id, { name: draft.trim() });
      setEditingId(null);
      onChanged();
    } catch (e) {
      onError(apiError(e, 'Could not rename that supplier.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: Supplier) => {
    if (!token) return;
    try {
      await adminUpdateSupplier(token, s.id, { active: !s.active });
      onChanged();
    } catch (e) {
      onError(apiError(e, 'Could not update that supplier.'));
    }
  };

  const remove = async (s: Supplier) => {
    if (!token) return;
    if (!confirm(`Remove ${s.name} and their ${s.priceCount} price${s.priceCount === 1 ? '' : 's'}?`)) return;
    try {
      await adminDeleteSupplier(token, s.id);
      onChanged();
    } catch (e) {
      onError(apiError(e, 'Could not remove that supplier.'));
    }
  };

  return (
    <div className="mb-5 p-4 sm:p-5 rounded-xl bg-surface-elevated border border-border">
      <div className="flex flex-wrap items-center gap-2">
        {suppliers.map((s) =>
          editingId === s.id ? (
            <form
              key={s.id}
              onSubmit={(e) => { e.preventDefault(); rename(s); }}
              className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border border-primary bg-surface"
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={`New name for ${s.name}`}
                className="w-28 text-sm bg-transparent focus:outline-none"
              />
              <button type="submit" disabled={busy || !draft.trim()} aria-label="Save name" className="p-1 rounded-full hover:bg-surface-elevated text-success cursor-pointer disabled:opacity-40">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename" className="p-1 rounded-full hover:bg-surface-elevated text-text-muted cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <span
              key={s.id}
              className={cn(
                'group inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border text-sm',
                s.active ? 'border-border bg-surface' : 'border-dashed border-border text-text-muted',
              )}
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-text-muted ml-1 tabular-nums" title={`${s.priceCount} prices · ${s.orderLineCount} costed order lines`}>
                {s.priceCount}
              </span>
              {!s.active && <span className="text-[10px] uppercase tracking-wider ml-1">retired</span>}
              <button
                onClick={() => { setEditingId(s.id); setDraft(s.name); }}
                aria-label={`Rename ${s.name}`}
                title="Rename"
                className="p-1 rounded-full hover:bg-surface-elevated text-text-muted hover:text-text-primary cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => toggle(s)}
                title={s.active ? 'Retire — drops out of the dropdown, prices and history stay' : 'Bring back'}
                aria-label={s.active ? `Retire ${s.name}` : `Reactivate ${s.name}`}
                className="px-1.5 py-0.5 rounded-full text-[11px] hover:bg-surface-elevated text-text-muted hover:text-text-primary cursor-pointer"
              >
                {s.active ? 'retire' : 'bring back'}
              </button>
              {/* Delete only while nothing has been costed against them; the
                  API refuses otherwise, so the button is not offered. */}
              {s.orderLineCount === 0 && (
                <button
                  onClick={() => remove(s)}
                  aria-label={`Remove ${s.name}`}
                  title="Remove"
                  className="p-1 rounded-full hover:bg-danger/10 text-text-muted hover:text-danger cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          ),
        )}

        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="inline-flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={suppliers.length === 0 ? 'First supplier, e.g. Chris' : 'Add a supplier'}
            aria-label="New supplier name"
            className="w-44 px-3 py-1.5 border border-border rounded-full text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-white text-xs font-medium disabled:opacity-40 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </form>
      </div>
      <p className="mt-3 text-xs text-text-muted">
        The number on each chip is how many SKUs that supplier has a price for. Retire a supplier to
        take them out of the dropdown without losing their prices or the orders costed from them.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function AdminSuppliersPage() {
  const { token } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sheet, setSheet] = useState<SupplierSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  // Ringgit text per cell, keyed supplier:variant. Empty is "no price".
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    Promise.all([adminGetSuppliers(token), adminGetSupplierSheet(token)])
      .then(([list, data]) => {
        setSuppliers(list);
        setSheet(data);
        setDraft(
          Object.fromEntries(
            data.rows.flatMap((r) => data.suppliers.map((s) => [cellKey(s.id, r.variantId), centsToInput(r.costs[s.id])])),
          ),
        );
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo(
    () => (sheet?.suppliers ?? []).filter((s) => showRetired || s.active),
    [sheet, showRetired],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = sheet?.rows ?? [];
    return q ? all.filter((r) => r.displayName.toLowerCase().includes(q) || r.code.toLowerCase().includes(q)) : all;
  }, [sheet, search]);

  // Grouped by product so the sheet reads the way the catalogue does; the
  // group header is the product, the rows are its sizes.
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: typeof rows }>();
    for (const r of rows) {
      const g = map.get(r.productId) ?? { name: r.productName, rows: [] };
      g.rows.push(r);
      map.set(r.productId, g);
    }
    return [...map.entries()];
  }, [rows]);

  // Compared in cents: "60", "60.0" and "60.00" are the same price.
  const changes = useMemo(() => {
    if (!sheet) return [];
    const out: { supplierId: string; variantId: string; cost: number | null; invalid: boolean }[] = [];
    for (const r of sheet.rows) {
      for (const s of sheet.suppliers) {
        const typed = draft[cellKey(s.id, r.variantId)] ?? '';
        const cents = inputToCents(typed);
        const saved = r.costs[s.id] ?? null;
        const invalid = typed.trim() !== '' && cents === null;
        if (invalid || cents !== saved) out.push({ supplierId: s.id, variantId: r.variantId, cost: cents, invalid });
      }
    }
    return out;
  }, [sheet, draft]);
  const invalidCount = changes.filter((c) => c.invalid).length;
  const dirty = changes.length > 0;

  const save = async () => {
    if (!token || !dirty || invalidCount > 0) return;
    setSaving(true);
    setError('');
    try {
      await adminSetSupplierCosts(token, changes.map(({ supplierId, variantId, cost }) => ({ supplierId, variantId, cost })));
      setSavedAt(Date.now());
      load();
    } catch (e) {
      setError(apiError(e, 'Could not save the prices.'));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    if (!sheet) return;
    setDraft(
      Object.fromEntries(
        sheet.rows.flatMap((r) => sheet.suppliers.map((s) => [cellKey(s.id, r.variantId), centsToInput(r.costs[s.id])])),
      ),
    );
  };

  const retiredCount = (sheet?.suppliers ?? []).filter((s) => !s.active).length;

  return (
    <div className="pb-24">
      <Animate variant="fadeUp">
        <PageHeader
          icon={Handshake}
          title="Suppliers"
          subtitle="Who the business buys from and what each of them charges per unit. The costing sheet on an order picks a unit cost from this list — a price changed here never rewrites an order already costed."
          className="mb-5"
        />
      </Animate>

      {error && <p className="mb-4 px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</p>}

      <Animate variant="fadeUp" delay={0.05}>
        <SupplierStrip suppliers={suppliers} onChanged={() => { setError(''); load(); }} onError={setError} />
      </Animate>

      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : loadFailed ? (
        <p className="text-sm text-danger">Could not load the price list.</p>
      ) : suppliers.length === 0 ? (
        <div className="px-4 py-3 rounded-xl bg-warning/10 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-warning font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" /> No suppliers yet
          </span>
          <span className="text-text-secondary">Add one above and the price sheet appears here.</span>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a product or SKU code"
                aria-label="Search SKUs"
                className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            {retiredCount > 0 && (
              <button
                onClick={() => setShowRetired(!showRetired)}
                aria-pressed={showRetired}
                className={cn(
                  'px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                  showRetired ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:bg-border',
                )}
              >
                {showRetired ? 'Hide' : 'Show'} retired ({retiredCount})
              </button>
            )}
          </div>

          {columns.length === 0 ? (
            <p className="text-sm text-text-muted">Every supplier is retired. Bring one back to edit prices.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-text-muted">No SKUs match that search.</p>
          ) : (
            <div className="max-h-[65vh] overflow-auto border border-border rounded-xl">
              <table className="w-full text-sm" style={{ minWidth: `${18 + columns.length * 8}rem` }}>
                <thead className="text-text-muted text-xs">
                  <tr>
                    {/* Both sticky: the item column so a phone can scroll the
                        supplier columns sideways without losing which row it is
                        on, the header so the supplier names survive scrolling
                        down a 60-row catalogue. */}
                    <th className="sticky top-0 left-0 z-20 bg-surface-elevated p-3 text-left font-medium min-w-[18rem]">Item</th>
                    {columns.map((s) => (
                      <th key={s.id} className={cn('sticky top-0 z-10 bg-surface-elevated p-3 text-right font-medium whitespace-nowrap', !s.active && 'text-text-muted/70')}>
                        {s.name}
                        {!s.active && <span className="block text-[10px] font-normal uppercase tracking-wider">retired</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([productId, g]) => (
                    <GroupRows key={productId} name={g.name} rows={g.rows} columns={columns} draft={draft} sheet={sheet!} onChange={(k, v) => setDraft((p) => ({ ...p, [k]: v }))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-xs text-text-muted">
            An empty cell means that supplier does not sell the item — it is not a price of zero. Per unit, in ringgit.
          </p>

          {dirty && (
            <SaveBar className="mt-4">
              <span className="text-sm font-medium">
                {changes.length} price{changes.length === 1 ? '' : 's'} changed
              </span>
              {invalidCount > 0 && (
                <span className="text-xs text-danger">
                  {invalidCount} {invalidCount === 1 ? 'is' : 'are'} not a number
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button onClick={discard} disabled={saving} className="px-3 py-1.5 rounded-lg bg-surface-elevated text-text-secondary text-xs font-medium hover:bg-border cursor-pointer">
                  Discard
                </button>
                <button
                  onClick={save}
                  disabled={saving || invalidCount > 0}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-40 cursor-pointer"
                >
                  {saving ? 'Saving…' : 'Save prices'}
                </button>
              </div>
            </SaveBar>
          )}
          {!dirty && savedAt && (
            <p className="mt-3 text-xs text-success inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Prices saved
            </p>
          )}
        </>
      )}
    </div>
  );
}

function GroupRows({
  name,
  rows,
  columns,
  draft,
  sheet,
  onChange,
}: {
  name: string;
  rows: SupplierSheet['rows'];
  columns: SupplierSheet['suppliers'];
  draft: Record<string, string>;
  sheet: SupplierSheet;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <>
      <tr className="border-t border-border bg-surface-elevated/60">
        <td colSpan={columns.length + 1} className="sticky left-0 px-3 py-1.5 text-xs font-semibold text-text-secondary bg-surface-elevated/60">
          {name}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.variantId} className="border-t border-border hover:bg-surface-elevated/40">
          <td className="sticky left-0 z-[5] bg-surface p-3">
            <span className="font-medium">{r.size ?? r.displayName}</span>
            <span className="text-text-muted ml-2 text-xs font-mono">{r.code}</span>
          </td>
          {columns.map((s) => {
            const key = cellKey(s.id, r.variantId);
            const value = draft[key] ?? '';
            const saved = sheet.rows.find((x) => x.variantId === r.variantId)?.costs[s.id] ?? null;
            const cents = inputToCents(value);
            const invalid = value.trim() !== '' && cents === null;
            const changed = invalid || cents !== saved;
            return (
              <td key={s.id} className="p-2 text-right">
                <span className="relative inline-block w-28">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted">RM</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={value}
                    onChange={(e) => onChange(key, e.target.value)}
                    placeholder="—"
                    aria-label={`${s.name} price for ${r.displayName}`}
                    aria-invalid={invalid || undefined}
                    className={cn(
                      'w-full pl-9 pr-2 py-1.5 border rounded-lg text-sm bg-surface text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary',
                      invalid ? 'border-danger' : changed ? 'border-primary' : 'border-border',
                    )}
                  />
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
