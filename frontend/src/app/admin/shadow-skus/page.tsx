'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search, AlertTriangle, Tags, Layers, FileText, Check } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminAssignShadowMapping,
  adminGetShadowCoverage,
  adminGetShadowMapping,
  adminGetShadowSkus,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import type { ShadowCoverage, ShadowMappingRow, ShadowSku } from '@/types';
import { ShadowCodesPanel } from './ShadowCodesPanel';
import { ShadowOrdersPanel } from './ShadowOrdersPanel';
import { PageHeader } from '@/components/admin/ui';

/**
 * Shadow SKUs — what each product is called on internal paperwork.
 *
 * The layout follows the two questions people actually arrive with. The first
 * is "what is still leaking?", which is why coverage is the headline and the
 * unmapped count is a filter rather than a statistic. The second is "what does
 * this product show up as?", which is why the table is one row per REAL SKU and
 * not one row per shadow code — the mapping has a direction, and reading it the
 * other way round means holding the join in your head.
 *
 * Bulk assign is on the main path rather than hidden, because the common shape
 * of this data is many real SKUs collapsing onto one generic line, and doing
 * that a row at a time is the difference between a minute and an afternoon.
 */

const PAGE_SIZE = 100;

function CoverageStrip({
  coverage,
  unmappedOnly,
  onToggleUnmapped,
}: {
  coverage: ShadowCoverage | null;
  unmappedOnly: boolean;
  onToggleUnmapped: () => void;
}) {
  if (!coverage) return null;
  const { activeVariants, mapped, unmapped, activeShadowCount } = coverage;
  const pct = activeVariants === 0 ? 0 : Math.round((mapped / activeVariants) * 100);
  const done = unmapped === 0;

  return (
    <div className="mb-5 p-4 sm:p-5 rounded-xl bg-surface-elevated border border-border">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-3xl font-bold tabular-nums leading-none">
            {pct}
            <span className="text-lg text-text-muted font-normal">%</span>
          </p>
          <p className="text-xs text-text-muted mt-1.5">
            {mapped} of {activeVariants} sellable SKUs mapped
          </p>
        </div>
        {/* The rule separates two stats sitting side by side. Once they wrap
            onto their own lines it is a line hanging off nothing, so it only
            exists at the width where they actually sit together. */}
        <div className="sm:pl-8 sm:border-l border-border">
          <p className="text-3xl font-bold tabular-nums leading-none">{activeShadowCount}</p>
          <p className="text-xs text-text-muted mt-1.5">
            active shadow code{activeShadowCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="ml-auto">
          {done ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-success/10 text-success text-xs font-medium">
              <Check className="w-3.5 h-3.5" /> Everything mapped
            </span>
          ) : (
            <button
              onClick={onToggleUnmapped}
              aria-pressed={unmappedOnly}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                unmappedOnly
                  ? 'bg-warning text-white'
                  : 'bg-warning/10 text-warning hover:bg-warning/20',
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {unmapped} unmapped
              {unmappedOnly && ' · showing'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 h-2 rounded-full bg-border overflow-hidden">
        <div
          className={cn('h-full transition-all', done ? 'bg-success' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>

      {!done && (
        <p className="mt-2.5 text-xs text-text-muted">
          An order containing an unmapped SKU cannot produce an internal summary — it is refused
          rather than falling back to the real product name.
        </p>
      )}
    </div>
  );
}

type View = 'mapping' | 'orders' | 'codes';

// useSearchParams needs a Suspense boundary for this route to prerender —
// the same wrapping the admin Orders and Emails pages use.
export default function AdminShadowSkusPage() {
  return (
    <Suspense fallback={<div className="h-40 rounded-xl bg-surface-elevated animate-pulse" />}>
      <ShadowSkusContent />
    </Suspense>
  );
}

function ShadowSkusContent() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  // The order page links here as ?unmapped=1 ("Map them on Shadow SKUs →")
  // and the sheet dialog as ?view=codes. Read once on arrival; the tabs own
  // the state after that.
  const viewParam = searchParams.get('view');
  const initialView: View =
    viewParam === 'orders' || viewParam === 'codes' ? viewParam : 'mapping';

  const [view, setView] = useState<View>(initialView);
  const [coverage, setCoverage] = useState<ShadowCoverage | null>(null);
  const [shadows, setShadows] = useState<ShadowSku[]>([]);

  const [rows, setRows] = useState<ShadowMappingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [search, setSearch] = useState('');
  const [unmappedOnly, setUnmappedOnly] = useState(searchParams.get('unmapped') === '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');

  const refreshSide = useCallback(() => {
    if (!token) return;
    adminGetShadowCoverage(token).then(setCoverage).catch(() => {});
    adminGetShadowSkus(token, { limit: '100' })
      .then((r) => setShadows(r.data))
      .catch(() => {});
  }, [token]);

  const params = useCallback(
    (which: number) => {
      const p: Record<string, string> = { page: String(which), limit: String(PAGE_SIZE) };
      if (search.trim()) p.search = search.trim();
      if (unmappedOnly) p.unmapped = 'true';
      return p;
    },
    [search, unmappedOnly],
  );

  const load = useCallback(() => {
    if (!token) return;
    setPage(1);
    adminGetShadowMapping(token, params(1))
      .then((r) => {
        setRows(r.data);
        setTotal(r.pagination.total);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [token, params]);

  // Appends rather than replaces, so paging through never loses what you were
  // already looking at — or the selection you had made on it.
  const loadMore = () => {
    if (!token || loadingMore) return;
    const next = page + 1;
    setLoadingMore(true);
    adminGetShadowMapping(token, params(next))
      .then((r) => {
        setRows((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...r.data.filter((x) => !seen.has(x.id))];
        });
        setTotal(r.pagination.total);
        setPage(next);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => { refreshSide(); }, [refreshSide]);

  // Selection is per-row and the row set changes with the filter, so anything
  // no longer on screen is narrowed out here rather than being synced away in
  // an effect. Ids for rows that scrolled out of the filter stay in state but
  // never act — a bulk assign only ever touches what the admin can see.
  const visibleIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const active = useMemo(
    () => new Set([...selected].filter((id) => visibleIds.has(id))),
    [selected, visibleIds],
  );

  const activeShadows = useMemo(() => shadows.filter((s) => s.active), [shadows]);
  const allSelected = rows.length > 0 && active.size === rows.length;

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fail = (e: unknown) => {
    const err = e as { response?: { data?: { error?: string } } };
    setError(err.response?.data?.error ?? 'Could not update the mapping.');
  };

  const assign = async (shadowSkuId: string | null) => {
    if (!token || active.size === 0) return;
    setAssigning(true);
    setError('');
    try {
      await adminAssignShadowMapping(token, { variantIds: [...active], shadowSkuId });
      setSelected(new Set());
      setAssignTo('');
      load();
      refreshSide();
    } catch (e) {
      fail(e);
    } finally {
      setAssigning(false);
    }
  };

  const setRowShadow = async (variantId: string, shadowSkuId: string | null) => {
    if (!token) return;
    setError('');
    try {
      await adminAssignShadowMapping(token, { variantIds: [variantId], shadowSkuId });
      load();
      refreshSide();
    } catch (e) {
      fail(e);
    }
  };

  const hasMore = rows.length < total;

  return (
    <div className="pb-24">
      <Animate variant="fadeUp">
        <PageHeader
          title="Shadow SKUs"
          subtitle="The generalised name each product is listed under on internal paperwork. The storefront, cart, checkout, receipt and confirmation email always show the real product — this vocabulary never reaches a customer."
          className="mb-5"
        />
      </Animate>

      <Animate variant="fadeUp" delay={0.05}>
        <CoverageStrip
          coverage={coverage}
          unmappedOnly={unmappedOnly}
          onToggleUnmapped={() => { setUnmappedOnly(!unmappedOnly); setView('mapping'); }}
        />
      </Animate>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto">
        {([
          ['mapping', 'Mapping', Layers],
          ['orders', 'Order sheets', FileText],
          ['codes', 'Shadow codes', Tags],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
              view === key ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:bg-border',
            )}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</p>
      )}

      {view === 'codes' ? (
        <ShadowCodesPanel shadows={shadows} onChanged={() => { refreshSide(); load(); }} />
      ) : view === 'orders' ? (
        <ShadowOrdersPanel
          onMapped={() => { refreshSide(); load(); }}
          onGoToCodes={() => setView('codes')}
        />
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
            <button
              onClick={() => setUnmappedOnly(!unmappedOnly)}
              aria-pressed={unmappedOnly}
              className={cn(
                'px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap',
                unmappedOnly ? 'bg-warning text-white' : 'bg-surface-elevated text-text-secondary hover:bg-border',
              )}
            >
              Unmapped only
            </button>
          </div>

          {/* The dropdowns only list active codes, so with none of them every
              row offers exactly one option — "not mapped" — and the page
              looks broken rather than empty. Say what is missing and where
              it is fixed. */}
          {shadows.length > 0 && activeShadows.length === 0 && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-warning/10 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-warning font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Every shadow code is inactive
              </span>
              <span className="text-text-secondary">
                Inactive codes are hidden from these dropdowns, so nothing can be mapped until one is turned back on.
              </span>
              <button
                onClick={() => setView('codes')}
                className="font-medium text-primary underline cursor-pointer"
              >
                Reactivate a code →
              </button>
            </div>
          )}
          {shadows.length === 0 && !loading && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-warning/10 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-warning font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0" /> No shadow codes yet
              </span>
              <span className="text-text-secondary">A SKU is mapped to a code, so one has to exist first.</span>
              <button
                onClick={() => setView('codes')}
                className="font-medium text-primary underline cursor-pointer"
              >
                Add a code →
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : loadFailed ? (
            <p className="text-sm text-danger">Could not load the mapping.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-text-muted">
              {unmappedOnly ? 'Every sellable SKU is mapped.' : 'No SKUs match that search.'}
            </p>
          ) : (
            <>
              {/* The table scrolls inside itself rather than with the page,
                  which is what makes the sticky header work at all: the admin
                  layout's <main> carries overflow:auto but never actually
                  scrolls (the document does), so a header sticking to <main>'s
                  scrollport would never move. Capping the height here gives the
                  header a scrollport that really scrolls — and keeps the
                  coverage strip and filters on screen while you work down the
                  list, which is worth having on its own. */}
              <div className="max-h-[65vh] overflow-auto border border-border rounded-xl">
                <table className="w-full text-sm min-w-[42rem]">
                  {/* Sticky: this list is as long as the catalogue, and losing
                      the column headers three rows in makes the middle column
                      unreadable. */}
                  <thead className="text-text-muted text-xs">
                    <tr>
                      <th className="sticky top-0 z-10 bg-surface-elevated p-3 w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          aria-label="Select every SKU shown"
                          className="cursor-pointer"
                          onChange={() =>
                            setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
                          }
                        />
                      </th>
                      <th className="sticky top-0 z-10 bg-surface-elevated p-3 text-left font-medium">Product</th>
                      <th className="sticky top-0 z-10 bg-surface-elevated p-3 text-left font-medium">Real code</th>
                      <th className="sticky top-0 z-10 bg-surface-elevated p-3 text-left font-medium">Listed internally as</th>
                      <th className="sticky top-0 z-10 bg-surface-elevated p-3 text-right font-medium">Order lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const isSelected = active.has(row.id);
                      return (
                        <tr
                          key={row.id}
                          // Clicking anywhere but the dropdown toggles selection:
                          // the checkbox alone is a 13px target in a 67-row list.
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest('select')) return;
                            toggleRow(row.id);
                          }}
                          className={cn(
                            'border-t border-border cursor-pointer transition-colors',
                            isSelected ? 'bg-primary/5' : 'hover:bg-surface-elevated',
                          )}
                        >
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              aria-label={`Select ${row.displayName}`}
                              className="cursor-pointer pointer-events-none"
                              tabIndex={-1}
                              readOnly
                            />
                          </td>
                          <td className="p-3">
                            <span className="font-medium">{row.displayName}</span>
                          </td>
                          <td className="p-3 text-text-muted text-xs font-mono">{row.code}</td>
                          <td className="p-3">
                            <label className="sr-only" htmlFor={`shadow-${row.id}`}>
                              Shadow code for {row.displayName}
                            </label>
                            {/* Neutral, not amber. Most of the catalogue is
                                unmapped at any time, and painting 60 rows with a
                                warning colour makes the colour mean nothing —
                                the coverage chip and the filter carry that
                                signal instead. */}
                            <select
                              id={`shadow-${row.id}`}
                              value={row.shadowSkuId ?? ''}
                              disabled={activeShadows.length === 0 && !row.shadowSkuId}
                              onChange={(e) => setRowShadow(row.id, e.target.value || null)}
                              className={cn(
                                'px-2 py-1.5 border border-border rounded-lg text-xs bg-surface max-w-[20rem] w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60',
                                !row.shadowSkuId && 'text-text-muted',
                              )}
                            >
                              <option value="">
                                {activeShadows.length === 0 ? '— no active code to map to —' : '— not mapped —'}
                              </option>
                              {activeShadows.map((s) => (
                                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                              ))}
                              {/* An inactive code still mapped to this row has to
                                  stay selectable, or opening the dropdown would
                                  silently rewrite it to "not mapped". */}
                              {row.shadowSku && !row.shadowSku.active && (
                                <option value={row.shadowSku.id}>
                                  {row.shadowSku.code} — {row.shadowSku.name} (inactive)
                                </option>
                              )}
                            </select>
                          </td>
                          <td className="p-3 text-right tabular-nums text-text-muted">
                            {row.orderLineCount || <span className="text-border">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <p className="text-xs text-text-muted">Showing {rows.length} of {total}</p>
                {hasMore && (
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-3 py-1.5 rounded-lg bg-surface-elevated text-text-secondary text-xs font-medium hover:bg-border disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </div>
            </>
          )}

          {/* Pinned: mapping a dozen SKUs means scrolling, and an action bar
              that scrolls away with the rows it applies to is no use. */}
          {active.size > 0 && (
            <div className="fixed bottom-0 left-0 lg:left-64 right-0 z-20 border-t border-border bg-surface/95 backdrop-blur">
              <div className="p-3 sm:px-6 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {active.size} SKU{active.size === 1 ? '' : 's'} selected
                </span>
                <button
                  onClick={() => setSelected(new Set())}
                  className="text-xs text-text-muted hover:text-text-primary underline cursor-pointer"
                >
                  Clear
                </button>
                <label className="sr-only" htmlFor="bulk-shadow">Shadow code to assign</label>
                <select
                  id="bulk-shadow"
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  className="ml-auto px-2 py-1.5 border border-border rounded-lg text-xs bg-surface cursor-pointer"
                >
                  <option value="">Choose a shadow code…</option>
                  {activeShadows.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
                <button
                  disabled={!assignTo || assigning}
                  onClick={() => assign(assignTo)}
                  className="px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium disabled:opacity-40 cursor-pointer"
                >
                  {assigning ? 'Saving…' : 'Assign'}
                </button>
                <button
                  disabled={assigning}
                  onClick={() => assign(null)}
                  className="px-3 py-1.5 rounded-lg bg-surface-elevated text-text-secondary text-xs font-medium hover:bg-border cursor-pointer"
                >
                  Unmap
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
