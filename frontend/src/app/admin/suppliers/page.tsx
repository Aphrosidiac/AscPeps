'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Handshake, Plus, Search, Check } from 'lucide-react';
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
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, Field, TextInput, PageHeader, SaveBar } from '@/components/admin/ui';
import { Dialog, ConfirmDialog } from '@/components/admin/Dialog';
import type { Supplier, SupplierSheet } from '@/types';

/**
 * Suppliers — who the business buys from, and what each of them charges per
 * unit of each SKU.
 *
 * Two cards. The first is the list of suppliers, where they are added,
 * renamed, retired and (while nothing has been costed from them) removed.
 * The second is the sheet the partners already keep by hand: one row per
 * sellable SKU, one column per supplier, a price in each cell. The order
 * page's costing sheet reads this to offer "YL,C · RM65.00" from a dropdown
 * instead of a blank box, which is what makes the same vial stop being costed
 * at four different figures across a month.
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

const draftFromSheet = (sheet: SupplierSheet) =>
  Object.fromEntries(
    sheet.rows.flatMap((r) => sheet.suppliers.map((s) => [cellKey(s.id, r.variantId), centsToInput(r.costs[s.id])])),
  );

/* ------------------------------------------------------------- dialogs */

/** Add a supplier, or rename one — the same one-field form. */
function SupplierDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [name, setName] = useState(supplier?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = name.trim();
  const unchanged = supplier ? trimmed === supplier.name : false;

  const submit = async (close: () => void) => {
    if (!token || !trimmed || unchanged) return;
    setBusy(true);
    setError('');
    try {
      if (supplier) await adminUpdateSupplier(token, supplier.id, { name: trimmed });
      else await adminCreateSupplier(token, { name: trimmed });
      onSaved();
      close();
    } catch (e) {
      setError(apiError(e, supplier ? 'Could not rename that supplier.' : 'Could not add that supplier.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={supplier ? `Rename ${supplier.name}` : 'Add a supplier'}
      description={supplier ? 'Orders already costed from them keep the new name.' : 'They appear as a column on the price list and in the costing dropdown once priced.'}
      onClose={onClose}
    >
      {(close) => (
        <form id="supplier-form" onSubmit={(e) => { e.preventDefault(); submit(close); }} className="space-y-4">
          <Field label="Name" htmlFor="supplier-name" error={error || null} help={supplier ? undefined : 'The name the partners use — e.g. Chris, YL,C, Zuwa.'}>
            <TextInput
              id="supplier-name"
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              maxLength={60}
              placeholder="Supplier name"
              invalid={!!error}
            />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy || !trimmed || unchanged}>
              {busy ? 'Saving…' : supplier ? 'Rename' : 'Add supplier'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------- pieces */

function Pill({ tone, children }: { tone: 'active' | 'retired'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-[2px] text-[12px] leading-4 font-semibold',
        tone === 'active' ? 'bg-green-100 text-green-800' : 'bg-surface-elevated text-text-secondary',
      )}
    >
      {children}
    </span>
  );
}

/** Ghost text action used along a supplier row. */
function RowAction({ onClick, tone = 'neutral', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'neutral' | 'danger' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors cursor-pointer',
        tone === 'danger'
          ? 'text-text-secondary hover:bg-danger/10 hover:text-danger'
          : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function SupplierList({
  suppliers,
  skuCount,
  onRename,
  onRemove,
  onChanged,
  onError,
}: {
  suppliers: Supplier[];
  skuCount: number;
  onRename: (s: Supplier) => void;
  onRemove: (s: Supplier) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const { token } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (s: Supplier) => {
    if (!token) return;
    setBusyId(s.id);
    try {
      await adminUpdateSupplier(token, s.id, { active: !s.active });
      onChanged();
    } catch (e) {
      onError(apiError(e, 'Could not update that supplier.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ul className="divide-y divide-border">
      {suppliers.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={cn('text-[15px] leading-[22px] font-medium truncate', !s.active && 'text-text-secondary')}>{s.name}</span>
            <Pill tone={s.active ? 'active' : 'retired'}>{s.active ? 'Active' : 'Retired'}</Pill>
          </div>
          <p className="w-full sm:w-auto text-[13px] leading-[18px] text-text-secondary tabular-nums sm:text-right">
            {s.priceCount === 0 ? 'No prices yet' : `${s.priceCount} of ${skuCount} SKUs priced`}
            <span className="text-text-muted"> · </span>
            {s.orderLineCount === 0 ? 'no order lines' : `${s.orderLineCount} order line${s.orderLineCount === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center -mx-2.5">
            <RowAction onClick={() => onRename(s)} disabled={busyId === s.id}>Rename</RowAction>
            <RowAction
              onClick={() => toggle(s)}
              disabled={busyId === s.id}
              title={s.active ? 'Take them out of the costing dropdown. Prices and history stay.' : 'Put them back in the costing dropdown.'}
            >
              {s.active ? 'Retire' : 'Bring back'}
            </RowAction>
            {/* Delete only while nothing has been costed against them; the
                API refuses otherwise, so the button is not offered. */}
            {s.orderLineCount === 0 && (
              <RowAction tone="danger" onClick={() => onRemove(s)} disabled={busyId === s.id}>Remove</RowAction>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-border px-6 py-4 last:border-0">
          <div className="h-4 rounded bg-surface-elevated" style={{ width: r % 2 ? '26%' : '34%' }} />
          <div className="ml-auto h-4 w-24 rounded bg-surface-elevated" />
          <div className="h-4 w-24 rounded bg-surface-elevated" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- page */

type DialogState = { kind: 'add' } | { kind: 'rename'; supplier: Supplier } | { kind: 'remove'; supplier: Supplier } | null;

export default function AdminSuppliersPage() {
  const { token } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sheet, setSheet] = useState<SupplierSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [removeError, setRemoveError] = useState('');
  // Ringgit text per cell, keyed supplier:variant. Empty is "no price".
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    Promise.all([adminGetSuppliers(token), adminGetSupplierSheet(token)])
      .then(([list, data]) => {
        setSuppliers(list);
        setSheet(data);
        setDraft(draftFromSheet(data));
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
  const changedSuppliers = useMemo(() => {
    const ids = new Set(changes.map((c) => c.supplierId));
    return (sheet?.suppliers ?? []).filter((s) => ids.has(s.id)).map((s) => s.name);
  }, [changes, sheet]);

  const save = async () => {
    if (!token || !dirty || invalidCount > 0) return;
    setSaving(true);
    setError('');
    try {
      await adminSetSupplierCosts(token, changes.map(({ supplierId, variantId, cost }) => ({ supplierId, variantId, cost })));
      setJustSaved(true);
      load();
    } catch (e) {
      setError(apiError(e, 'Could not save the prices.'));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => { if (sheet) setDraft(draftFromSheet(sheet)); };
  const edit = (k: string, v: string) => { setJustSaved(false); setDraft((p) => ({ ...p, [k]: v })); };

  const remove = async (s: Supplier) => {
    if (!token) return false;
    setRemoveError('');
    try {
      await adminDeleteSupplier(token, s.id);
      load();
      return true;
    } catch (e) {
      setRemoveError(apiError(e, 'Could not remove that supplier.'));
      return false;
    }
  };

  // Spreadsheet keys: Enter walks down the column, Shift+Enter back up, so a
  // supplier's whole column can be typed in one pass without touching the
  // mouse. Tab already walks across the row.
  const sheetRef = useRef<HTMLTableElement>(null);
  const onCellKey = (e: KeyboardEvent<HTMLInputElement>, supplierId: string) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const inputs = Array.from(sheetRef.current?.querySelectorAll<HTMLInputElement>(`input[data-supplier="${supplierId}"]`) ?? []);
    const i = inputs.indexOf(e.currentTarget);
    if (i === -1) return;
    const next = inputs[e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? i - 1 : i + 1];
    if (!next) return;
    e.preventDefault();
    next.focus();
    next.select();
  };

  const retiredCount = (sheet?.suppliers ?? []).filter((s) => !s.active).length;
  const skuCount = sheet?.rows.length ?? 0;
  const emptySheet = !loading && !loadFailed && suppliers.length === 0;

  return (
    <div className="pb-6">
      <Animate variant="fadeUp">
        <PageHeader
          icon={Handshake}
          title="Suppliers"
          subtitle="Who the business buys from and what each of them charges per unit. The costing sheet on an order picks from this list."
          actions={
            !emptySheet && (
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}>
                <Plus className="w-4 h-4" /> Add supplier
              </Button>
            )
          }
        />
      </Animate>

      {error && <p className="mb-4 rounded-[6px] bg-danger/10 px-3 py-2 text-[13px] leading-[18px] text-danger">{error}</p>}

      {loading ? (
        <Card><SkeletonRows /></Card>
      ) : loadFailed ? (
        <Card className="px-6 py-12 text-center">
          <h3 className="text-[16px] leading-6 font-semibold">Could not load the price list</h3>
          <p className="mx-auto mt-1.5 max-w-md text-[15px] leading-[22px] text-text-secondary">Check the connection and try again.</p>
          <div className="mt-5"><Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}>Retry</Button></div>
        </Card>
      ) : emptySheet ? (
        <Animate variant="fadeUp" delay={0.05}>
          <Card className="px-6 py-12 text-center">
            <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-elevated text-text-secondary">
              <Handshake className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="text-[16px] leading-6 font-semibold">No suppliers yet</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[15px] leading-[22px] text-text-secondary">
              Add the people the business buys from — Chris, YL,C, Zuwa — and a price sheet with a column for each appears here.
              The costing sheet on an order then offers their prices from a dropdown.
            </p>
            <div className="mt-5">
              <Button size="sm" onClick={() => setDialog({ kind: 'add' })}><Plus className="w-4 h-4" /> Add the first supplier</Button>
            </div>
          </Card>
        </Animate>
      ) : (
        <div className="space-y-6">
          <Animate variant="fadeUp" delay={0.05}>
            <Card>
              <CardHeader
                title={<>Suppliers <span className="ml-1 text-text-secondary font-normal tabular-nums">{suppliers.length}</span></>}
                description="Retire a supplier to take them out of the costing dropdown — their prices and the orders costed from them stay. Remove is only offered while no order has been costed from them."
              />
              <SupplierList
                suppliers={suppliers}
                skuCount={skuCount}
                onRename={(s) => setDialog({ kind: 'rename', supplier: s })}
                onRemove={(s) => { setRemoveError(''); setDialog({ kind: 'remove', supplier: s }); }}
                onChanged={() => { setError(''); load(); }}
                onError={setError}
              />
            </Card>
          </Animate>

          <Animate variant="fadeUp" delay={0.1}>
            <Card>
              <CardHeader
                title="Price list"
                description="What each supplier charges per unit, in ringgit. A blank cell means they don't sell it — not a price of zero. Enter moves down a column."
                className="flex-col sm:flex-row sm:items-center"
                actions={
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
                      <TextInput
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search products"
                        aria-label="Search SKUs"
                        className="pl-9 text-[14px]"
                      />
                    </div>
                    {retiredCount > 0 && (
                      <Button
                        type="button"
                        variant={showRetired ? 'secondary' : 'outline'}
                        size="sm"
                        aria-pressed={showRetired}
                        onClick={() => setShowRetired(!showRetired)}
                        className="h-[38px]"
                      >
                        {showRetired ? 'Hide' : 'Show'} retired <span className="tabular-nums text-text-secondary">{retiredCount}</span>
                      </Button>
                    )}
                  </div>
                }
              />

              {columns.length === 0 ? (
                <p className="px-6 py-10 text-center text-[15px] leading-[22px] text-text-secondary">Every supplier is retired. Bring one back to edit prices.</p>
              ) : rows.length === 0 ? (
                <p className="px-6 py-10 text-center text-[15px] leading-[22px] text-text-secondary">
                  No SKUs match “{search.trim()}”.{' '}
                  <button type="button" onClick={() => setSearch('')} className="text-text-primary underline underline-offset-2 cursor-pointer">Clear the search</button>
                </p>
              ) : (
                <div className="relative max-h-[65vh] overflow-auto rounded-b-[10px]">
                  <table ref={sheetRef} className="w-full border-collapse text-left" style={{ minWidth: `${9 + columns.length * 9}rem` }}>
                    <thead>
                      <tr>
                        {/* Both sticky: the item column so a phone can scroll the
                            supplier columns sideways without losing which row it is
                            on, the header so the supplier names survive scrolling
                            down a 60-row catalogue. */}
                        <th scope="col" className="sticky left-0 top-0 z-20 min-w-[8.5rem] sm:min-w-[16rem] bg-surface-elevated px-4 py-3 text-[12px] leading-4 font-semibold uppercase tracking-[0.08em] text-text-secondary sm:px-6">
                          Item
                        </th>
                        {columns.map((s) => (
                          <th
                            key={s.id}
                            scope="col"
                            className={cn(
                              'sticky top-0 z-10 w-[9.5rem] whitespace-nowrap bg-surface-elevated px-3 py-3 text-right text-[12px] leading-4 font-semibold uppercase tracking-[0.08em] text-text-secondary',
                              !s.active && 'text-text-muted',
                            )}
                          >
                            {s.name}
                            {!s.active && <span className="ml-1.5 font-medium normal-case tracking-normal">(retired)</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(([productId, g]) => (
                        <GroupRows
                          key={productId}
                          name={g.name}
                          rows={g.rows}
                          columns={columns}
                          draft={draft}
                          sheet={sheet!}
                          onChange={edit}
                          onKey={onCellKey}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </Animate>

          <SaveBar>
            <p className="flex-1 min-w-[10rem] px-1 text-[13px] leading-[18px]">
              {invalidCount > 0 ? (
                <span className="text-danger">
                  {invalidCount} {invalidCount === 1 ? 'cell is' : 'cells are'} not a price — fix or clear {invalidCount === 1 ? 'it' : 'them'} to save
                </span>
              ) : justSaved && !dirty ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-success"><Check className="w-4 h-4" /> Prices saved</span>
              ) : dirty ? (
                <span className="text-text-secondary">
                  <span className="font-medium text-text-primary">{changes.length} {changes.length === 1 ? 'price' : 'prices'} changed</span>
                  {' '}for {changedSuppliers.join(', ')}
                </span>
              ) : (
                <span className="text-text-secondary">No unsaved changes</span>
              )}
            </p>
            {dirty && (
              <Button type="button" variant="outline" size="sm" onClick={discard} disabled={saving}>Discard</Button>
            )}
            <Button type="button" size="sm" onClick={save} disabled={saving || !dirty || invalidCount > 0}>
              {saving ? 'Saving…' : 'Save prices'}
            </Button>
          </SaveBar>
        </div>
      )}

      {dialog?.kind === 'add' && (
        <SupplierDialog supplier={null} onClose={() => setDialog(null)} onSaved={() => { setError(''); load(); }} />
      )}
      {dialog?.kind === 'rename' && (
        <SupplierDialog supplier={dialog.supplier} onClose={() => setDialog(null)} onSaved={() => { setError(''); load(); }} />
      )}
      {dialog?.kind === 'remove' && (
        <ConfirmDialog
          title={`Remove ${dialog.supplier.name}?`}
          body={
            dialog.supplier.priceCount === 0
              ? 'They have no prices yet, so nothing else is lost.'
              : `Their ${dialog.supplier.priceCount} price${dialog.supplier.priceCount === 1 ? '' : 's'} go with them. If you only want them out of the dropdown, retire them instead — that keeps the prices.`
          }
          confirmLabel="Remove"
          tone="danger"
          error={removeError}
          onConfirm={() => remove(dialog.supplier)}
          onClose={() => setDialog(null)}
        />
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
  onKey,
}: {
  name: string;
  rows: SupplierSheet['rows'];
  columns: SupplierSheet['suppliers'];
  draft: Record<string, string>;
  sheet: SupplierSheet;
  onChange: (key: string, value: string) => void;
  onKey: (e: KeyboardEvent<HTMLInputElement>, supplierId: string) => void;
}) {
  return (
    <>
      <tr className="border-t border-border">
        <td colSpan={columns.length + 1} className="sticky left-0 bg-surface px-4 pb-1.5 pt-3 text-[13px] leading-[18px] font-semibold text-text-primary sm:px-6">
          {name}
        </td>
      </tr>
      {rows.map((r) => {
        const saved = sheet.rows.find((x) => x.variantId === r.variantId)?.costs ?? {};
        // The lowest figure across the visible columns, so "who is cheapest
        // for this vial" is read off the sheet rather than worked out.
        const priced = columns.map((s) => inputToCents(draft[cellKey(s.id, r.variantId)] ?? '')).filter((c): c is number => c !== null);
        const lowest = priced.length >= 2 ? Math.min(...priced) : null;
        return (
          <tr key={r.variantId} className="group/row hover:bg-surface-elevated/50">
            <td className="sticky left-0 z-[5] bg-surface px-4 py-1.5 align-middle group-hover/row:bg-background sm:px-6">
              <span className="block text-[15px] leading-[22px] sm:inline">{r.size ?? r.displayName}</span>
              <span className="block font-mono text-[12px] leading-4 text-text-secondary sm:ml-2 sm:inline">{r.code}</span>
            </td>
            {columns.map((s) => {
              const key = cellKey(s.id, r.variantId);
              const value = draft[key] ?? '';
              const cents = inputToCents(value);
              const invalid = value.trim() !== '' && cents === null;
              const changed = invalid || cents !== (saved[s.id] ?? null);
              const cheapest = lowest !== null && cents === lowest;
              return (
                <td key={s.id} className="px-3 py-1.5 text-right align-middle">
                  <span
                    className={cn(
                      'inline-flex h-9 w-[7.5rem] items-stretch overflow-hidden rounded-[6px] border bg-surface transition-[border-color,box-shadow] duration-[120ms] focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15',
                      invalid ? 'border-danger' : changed ? 'border-primary' : 'border-border',
                    )}
                  >
                    <span className="flex items-center border-r border-border bg-surface-elevated px-2 text-[12px] text-text-secondary">RM</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={value}
                      data-supplier={s.id}
                      onChange={(e) => onChange(key, e.target.value)}
                      onKeyDown={(e) => onKey(e, s.id)}
                      placeholder="—"
                      aria-label={`${s.name} price for ${r.displayName}`}
                      aria-invalid={invalid || undefined}
                      className={cn(
                        'h-full w-full min-w-0 bg-transparent px-2 text-right text-[14px] tabular-nums outline-none placeholder:text-text-muted [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                        cheapest && !invalid ? 'font-semibold text-green-700' : 'text-text-primary',
                      )}
                    />
                  </span>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
