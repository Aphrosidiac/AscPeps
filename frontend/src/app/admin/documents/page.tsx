'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText, Image as ImageIcon, Plus, Search, FolderOpen, ShoppingBag, Receipt, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetDocuments } from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import { Animate } from '@/components/ui/Animate';
import type { Document } from '@/types';
import { UploadDocumentDialog } from './UploadDocumentDialog';
import { DocumentDetail } from './DocumentDetail';

/**
 * The filing cabinet.
 *
 * Two things drive the layout. First, the question people actually arrive with
 * is "do we have the paperwork for X" — so search covers order numbers as well
 * as titles, and what each document is filed against is on the row rather than
 * one click away. Second, the failure mode of any document store is stuff piling
 * up unfiled, so "Unfiled" is a first-class filter with a live count rather than
 * something you would have to go looking for.
 */

const isPdf = (mime: string) => mime === 'application/pdf';

function DocumentIcon({ mimeType }: { mimeType: string }) {
  return isPdf(mimeType) ? (
    <FileText className="w-4 h-4 text-danger shrink-0" />
  ) : (
    <ImageIcon className="w-4 h-4 text-primary shrink-0" />
  );
}

/** What a document is attached to, as compact chips. */
function FiledChips({ doc }: { doc: Document }) {
  if (doc.links.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <AlertTriangle className="w-3 h-3" /> Unfiled
      </span>
    );
  }
  const shown = doc.links.slice(0, 3);
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((l) => (
        <span
          key={l.id}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-surface-elevated text-[11px] text-text-secondary max-w-[11rem]"
        >
          {l.order ? <ShoppingBag className="w-3 h-3 shrink-0" /> : <Receipt className="w-3 h-3 shrink-0" />}
          <span className="truncate">{l.order?.orderNumber ?? l.expense?.description}</span>
        </span>
      ))}
      {doc.links.length > shown.length && (
        <span className="text-[11px] text-text-muted">+{doc.links.length - shown.length}</span>
      )}
    </span>
  );
}

export default function AdminDocumentsPage() {
  const { token } = useAuth();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [unfiledOnly, setUnfiledOnly] = useState(false);
  // Filtered on the DOCUMENT's own date, not the upload time. "The August
  // receipts" is the obvious question to ask a filing cabinet, and the date on
  // the paper is the only answer to it that means anything.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Document | null>(null);

  // Filtering happens server-side so it narrows the whole collection, not just
  // the page that happened to arrive.
  const params = useCallback(
    (which: number) => {
      const p: Record<string, string> = { page: String(which), limit: '50' };
      if (search.trim()) p.search = search.trim();
      if (kind) p.kind = kind;
      if (unfiledOnly) p.unlinked = 'true';
      if (from) p.from = from;
      if (to) p.to = to;
      return p;
    },
    [search, kind, unfiledOnly, from, to]
  );

  const load = useCallback(() => {
    if (!token) return;
    setPage(1);
    adminGetDocuments(token, params(1))
      .then((res) => {
        setDocuments(res.documents);
        setKinds(res.kinds);
        setTotal(res.total);
        setHasMore(res.hasMore);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [token, params]);

  // Appends rather than replaces, so paging through a long list never loses
  // what you were already looking at.
  const loadMore = () => {
    if (!token || loadingMore) return;
    const next = page + 1;
    setLoadingMore(true);
    adminGetDocuments(token, params(next))
      .then((res) => {
        // Guard against a document arriving twice if one was added between
        // pages and pushed the offsets along.
        setDocuments((prev) => {
          const seen = new Set(prev.map((d) => d.id));
          return [...prev, ...res.documents.filter((d) => !seen.has(d.id))];
        });
        setTotal(res.total);
        setHasMore(res.hasMore);
        setPage(next);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoadingMore(false));
  };

  // Debounced on the search text only — a keystroke should not fire a request,
  // but flipping a filter chip should feel immediate.
  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const retry = () => { setLoading(true); setLoadFailed(false); load(); };

  const totals = useMemo(() => {
    const withAmount = documents.filter((d) => d.amount != null);
    return {
      count: documents.length,
      value: withAmount.reduce((sum, d) => sum + (d.amount ?? 0), 0),
      unfiled: documents.filter((d) => d.links.length === 0).length,
    };
  }, [documents]);

  const filtering = search.trim() !== '' || kind !== '' || unfiledOnly || from !== '' || to !== '';
  const clearFilters = () => { setSearch(''); setKind(''); setUnfiledOnly(false); setFrom(''); setTo(''); };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <Animate variant="fadeUp">
          <div>
            <h1 className="font-display text-2xl font-bold">Documents</h1>
            <p className="text-xs text-text-muted mt-0.5">
              {total} document{total === 1 ? '' : 's'}
              {totals.value > 0 && <> · {formatPrice(totals.value)} of recorded amounts</>}
            </p>
          </div>
        </Animate>
        <Animate variant="fadeUp" delay={0.05}>
          <button
            onClick={() => setUploading(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Upload
          </button>
        </Animate>
      </div>

      {/* Filters */}
      <Animate variant="fadeUp" delay={0.1}>
        <div className="mb-5 space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, description, filename — or paste an order number"
              aria-label="Search documents"
              className="w-full pl-9 pr-3 py-2.5 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setKind(''); setUnfiledOnly(false); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                !kind && !unfiledOnly ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:bg-border'
              )}
            >
              All
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => { setKind(kind === k ? '' : k); setUnfiledOnly(false); }}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                  kind === k ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:bg-border'
                )}
              >
                {k}
              </button>
            ))}
            {/* Kept last and styled apart: this is a housekeeping view, not
                another category. */}
            <label className="flex items-center gap-1.5 text-xs text-text-muted ml-auto">
              <span className="hidden sm:inline">From</span>
              <input
                type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                aria-label="Documents dated from"
                className="px-2 py-1.5 border border-border rounded-lg text-xs bg-surface"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="hidden sm:inline">to</span>
              <input
                type="date" value={to} onChange={(e) => setTo(e.target.value)}
                aria-label="Documents dated to"
                className="px-2 py-1.5 border border-border rounded-lg text-xs bg-surface"
              />
            </label>
            {filtering && (
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => { setUnfiledOnly(!unfiledOnly); setKind(''); }}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                unfiledOnly ? 'bg-warning text-white' : 'bg-warning/10 text-warning hover:bg-warning/20'
              )}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              Unfiled{!unfiledOnly && !filtering && totals.unfiled > 0 && ` · ${totals.unfiled}`}
            </button>
          </div>
        </div>
      </Animate>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-surface-elevated rounded-xl" />)}
        </div>
      ) : loadFailed ? (
        <div className="text-center py-16">
          <FolderOpen className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted mb-1">Could not load documents.</p>
          <p className="text-sm text-text-muted mb-4">The request failed or timed out.</p>
          <button onClick={retry} className="text-sm font-medium text-primary underline cursor-pointer">Try again</button>
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-16">
          <FolderOpen className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted mb-1">
            {filtering ? 'Nothing matches those filters.' : 'No documents yet.'}
          </p>
          <p className="text-sm text-text-muted max-w-md mx-auto">
            {filtering
              ? 'Clear the filters, or widen the date range.'
              : 'Receipts, supplier invoices, courier bills, bank slips. Upload one and file it against the order or expense it belongs to.'}
          </p>
        </div>
      ) : (
        <Animate variant="fadeUp" delay={0.15}>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            {/* Cards on phones: the table wants ~900px, and on a 375px screen
                the amount and what it's filed against were both off the edge. */}
            <div className="divide-y divide-border md:hidden">
              {documents.map((d, i) => (
                <button
                  key={d.id}
                  onClick={() => setSelected(d)}
                  style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                  className="row-rise w-full text-left px-4 py-3 hover:bg-surface-elevated transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="mt-0.5"><DocumentIcon mimeType={d.mimeType} /></span>
                      <p className="font-medium text-sm min-w-0 truncate">{d.title}</p>
                    </div>
                    {d.amount != null && (
                      <span className="text-sm font-semibold tabular-nums shrink-0">{formatPrice(d.amount)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-text-muted pl-6">
                    <span className="px-2 py-0.5 rounded-full bg-surface-elevated">{d.kind}</span>
                    <span>{formatShortDate(d.occurredAt)}</span>
                  </div>
                  <div className="mt-1.5 pl-6"><FiledChips doc={d} /></div>
                </button>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                    <th className="text-left px-5 py-3">Document</th>
                    <th className="text-left px-3 py-3">Kind</th>
                    <th className="text-left px-3 py-3">Date</th>
                    <th className="text-left px-3 py-3">Filed against</th>
                    <th className="text-right px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {documents.map((d, i) => (
                    <tr
                      key={d.id}
                      onClick={() => setSelected(d)}
                      style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                      className="row-rise hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <DocumentIcon mimeType={d.mimeType} />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{d.title}</p>
                            {d.description && (
                              <p className="text-xs text-text-muted truncate max-w-md">{d.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="px-2 py-0.5 rounded-full bg-surface-elevated text-xs whitespace-nowrap">{d.kind}</span>
                      </td>
                      <td className="px-3 py-3 text-text-muted whitespace-nowrap">{formatShortDate(d.occurredAt)}</td>
                      <td className="px-3 py-3"><FiledChips doc={d} /></td>
                      <td className="px-5 py-3 text-right tabular-nums whitespace-nowrap">
                        {d.amount == null ? <span className="text-text-muted">—</span> : formatPrice(d.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Animate>
      )}

      {!loading && !loadFailed && documents.length > 0 && (
        <div className="text-center mt-5">
          {hasMore ? (
            <>
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 border border-border bg-surface rounded-lg text-sm font-medium hover:bg-surface-elevated transition-colors cursor-pointer disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
              <p className="text-xs text-text-muted mt-2">
                Showing {documents.length} of {total}
              </p>
            </>
          ) : (
            total > documents.length && (
              <p className="text-xs text-text-muted">Showing {documents.length} of {total}</p>
            )
          )}
        </div>
      )}

      {uploading && (
        <UploadDocumentDialog
          kinds={kinds}
          onClose={() => setUploading(false)}
          onSaved={() => { setUploading(false); load(); }}
        />
      )}

      {selected && (
        <DocumentDetail
          document={selected}
          kinds={kinds}
          onClose={() => setSelected(null)}
          onChanged={(next) => {
            setSelected(next);
            setDocuments((prev) => prev.map((d) => (d.id === next.id ? next : d)));
          }}
          onDeleted={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
