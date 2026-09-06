'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Download, Trash2, Pencil, Check, FileText, ShoppingBag, Receipt, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminDeleteDocument,
  adminDownloadDocument,
  adminFetchDocumentBlob,
  adminSetDocumentLinks,
  adminUpdateDocument,
} from '@/lib/api';
import { formatPrice, formatShortDate } from '@/lib/utils';
import type { Document } from '@/types';
import { LinkPicker, type LinkSelection } from './LinkPicker';

const isoDate = (value: string) => new Date(value).toISOString().slice(0, 10);

/**
 * One document, in a side panel rather than its own route: you are almost
 * always checking a document against the list you just came from, and losing
 * your filters to look at one receipt is the wrong trade.
 *
 * The preview is the reason this component holds state at all. The file is not
 * a public URL — it is fetched with the admin token and turned into an object
 * URL, which has to be revoked when the panel closes or every document opened
 * in a session stays in memory.
 */
export function DocumentDetail({
  document: doc,
  kinds,
  onClose,
  onChanged,
  onDeleted,
}: {
  document: Document;
  kinds: string[];
  onClose: () => void;
  onChanged: (next: Document) => void;
  onDeleted: () => void;
}) {
  const { token } = useAuth();

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingLinks, setEditingLinks] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    title: doc.title,
    description: doc.description ?? '',
    kind: doc.kind,
    occurredAt: isoDate(doc.occurredAt),
    amount: doc.amount == null ? '' : (doc.amount / 100).toFixed(2),
  });
  const [links, setLinks] = useState<LinkSelection>({
    orderIds: doc.links.filter((l) => l.orderId).map((l) => l.orderId as string),
    expenseIds: doc.links.filter((l) => l.expenseId).map((l) => l.expenseId as string),
  });

  const previewable =
    doc.mimeType === 'application/pdf' ||
    doc.mimeType === 'image/jpeg' ||
    doc.mimeType === 'image/png' ||
    doc.mimeType === 'image/webp';

  // Fetch the bytes with the token attached. A plain <img src> cannot work:
  // the token is in localStorage, not a cookie, so the browser's own request
  // would arrive unauthenticated and 401.
  useEffect(() => {
    if (!token || !previewable) return;
    let revoked = false;
    let url: string | null = null;

    adminFetchDocumentBlob(token, doc.id)
      .then((u) => {
        if (revoked) { URL.revokeObjectURL(u); return; }
        url = u;
        setBlobUrl(u);
      })
      .catch(() => setPreviewFailed(true));

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, doc.id, previewable]);

  // Unsaved work, so closing can ask before throwing it away. Editing is opened
  // with a pencil and saved with a tick, which makes it entirely possible to
  // retype a title and then dismiss the panel with the backdrop or Escape —
  // losing it silently, with no hint anything was thrown away.
  const metaDirty =
    editing &&
    (form.title !== doc.title ||
      form.description !== (doc.description ?? '') ||
      form.kind !== doc.kind ||
      form.occurredAt !== isoDate(doc.occurredAt) ||
      form.amount !== (doc.amount == null ? '' : (doc.amount / 100).toFixed(2)));

  const savedLinks = {
    orderIds: doc.links.filter((l) => l.orderId).map((l) => l.orderId as string),
    expenseIds: doc.links.filter((l) => l.expenseId).map((l) => l.expenseId as string),
  };
  const sameSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const linksDirty =
    editingLinks &&
    (!sameSet(links.orderIds, savedLinks.orderIds) || !sameSet(links.expenseIds, savedLinks.expenseIds));

  const requestClose = useCallback(() => {
    if (saving) return; // never close out from under a save in flight
    if (metaDirty || linksDirty) {
      if (!window.confirm('Close without saving? Your changes to this document will be lost.')) return;
    }
    onClose();
  }, [saving, metaDirty, linksDirty, onClose]);

  // Escape, focus trap, scroll lock and focus restore — see useModalA11y.
  // Routed through requestClose so Escape cannot skip the unsaved-changes guard.
  const panelRef = useModalA11y({ onClose: requestClose });

  const saveMeta = async () => {
    if (!token) return;
    const cents = form.amount.trim() === '' ? null : Math.round(Number(form.amount) * 100);
    if (cents !== null && !Number.isFinite(cents)) { setError('That is not a valid amount.'); return; }
    setError('');
    setSaving(true);
    try {
      const next = await adminUpdateDocument(token, doc.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        kind: form.kind.trim(),
        occurredAt: form.occurredAt,
        amount: cents,
      });
      onChanged(next);
      setEditing(false);
    } catch {
      setError('Could not save those changes.');
    } finally {
      setSaving(false);
    }
  };

  const saveLinks = async () => {
    if (!token) return;
    setError('');
    setSaving(true);
    try {
      onChanged(await adminSetDocumentLinks(token, doc.id, links));
      setEditingLinks(false);
    } catch {
      setError('Could not save what this is filed against.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!token) return;
    // Named in the prompt, and explicit that the file is gone — there is no
    // backup of the documents directory by design.
    if (!window.confirm(`Delete "${doc.title}"? The file is permanently removed and cannot be recovered.`)) return;
    setSaving(true);
    try {
      await adminDeleteDocument(token, doc.id);
      onDeleted();
    } catch {
      setError('Could not delete that document.');
      setSaving(false);
    }
  };

  const download = useCallback(() => {
    if (token) adminDownloadDocument(token, doc.id, doc.originalName).catch(() => setError('Could not download that file.'));
  }, [token, doc.id, doc.originalName]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={doc.title}>
      <div className="absolute inset-0 bg-black/40" onClick={requestClose} />

      <div
        ref={panelRef}
        className="dialog-panel relative bg-surface border-l border-border w-full max-w-2xl h-full overflow-y-auto outline-none"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <div className="min-w-0">
            <h2 className="font-display font-semibold truncate">{doc.title}</h2>
            <p className="text-xs text-text-muted mt-0.5 truncate">
              {doc.kind} · {formatShortDate(doc.occurredAt)}
              {doc.amount != null && ` · ${formatPrice(doc.amount)}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={download} title="Download" aria-label="Download"
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={remove} disabled={saving} title="Delete" aria-label="Delete"
              className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-surface-elevated transition-colors cursor-pointer disabled:opacity-40">
              <Trash2 className="w-4 h-4" />
            </button>
            <button onClick={requestClose} aria-label="Close"
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Preview */}
          <div className="bg-surface-elevated border border-border rounded-xl overflow-hidden">
            {!previewable || previewFailed ? (
              <div className="text-center py-12 px-5">
                <FileText className="w-8 h-8 text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-secondary">{doc.originalName}</p>
                <p className="text-xs text-text-muted mt-1">
                  {previewFailed ? 'Could not load a preview.' : 'This type cannot be previewed here.'}
                </p>
                <button onClick={download} className="text-sm font-medium text-primary underline mt-3 cursor-pointer">
                  Download to view
                </button>
              </div>
            ) : !blobUrl ? (
              <div className="h-72 animate-pulse bg-border/40" />
            ) : doc.mimeType === 'application/pdf' ? (
              <object data={blobUrl} type="application/pdf" className="w-full h-[28rem]" aria-label={doc.title}>
                <div className="text-center py-12 px-5">
                  <p className="text-sm text-text-secondary">This browser will not display the PDF inline.</p>
                  <button onClick={download} className="text-sm font-medium text-primary underline mt-2 cursor-pointer">
                    Download to view
                  </button>
                </div>
              </object>
            ) : (
              // Clickable because a scan of a dense invoice is unreadable at
              // 28rem, and "download it to read it" is a poor answer when the
              // bytes are already in the browser.
              <button
                type="button"
                onClick={() => window.open(blobUrl, '_blank', 'noopener')}
                title="Open full size"
                className="block w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={blobUrl} alt={doc.title} className="w-full max-h-[28rem] object-contain bg-black/5" />
              </button>
            )}
          </div>

          {blobUrl && !previewFailed && (
            <button
              type="button"
              onClick={() => window.open(blobUrl, '_blank', 'noopener')}
              className="text-xs text-text-muted hover:text-primary transition-colors cursor-pointer -mt-2"
            >
              Open full size in a new tab
            </button>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          {/* Details */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">
                Details
                {metaDirty && <span className="ml-2 text-xs font-normal text-warning">unsaved</span>}
              </h3>
              <button
                onClick={() => (editing ? saveMeta() : setEditing(true))}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer disabled:opacity-40"
              >
                {editing ? <><Check className="w-3.5 h-3.5" /> Save</> : <><Pencil className="w-3.5 h-3.5" /> Edit</>}
              </button>
            </div>

            {editing ? (
              <div className="p-4 grid sm:grid-cols-2 gap-3">
                <input
                  value={form.title} maxLength={160} aria-label="Title"
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="sm:col-span-2 px-3 py-2 border border-border rounded-lg text-sm bg-surface"
                />
                <input
                  value={form.kind} list="document-kinds-detail" aria-label="Kind"
                  onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                  className="px-3 py-2 border border-border rounded-lg text-sm bg-surface"
                />
                <datalist id="document-kinds-detail">
                  {kinds.map((k) => <option key={k} value={k} />)}
                </datalist>
                <input
                  type="date" value={form.occurredAt} aria-label="Date on the document"
                  onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
                  className="px-3 py-2 border border-border rounded-lg text-sm bg-surface"
                />
                <div className="relative sm:col-span-2">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">RM</span>
                  <input
                    type="number" min="0" step="0.01" value={form.amount} placeholder="Amount (optional)" aria-label="Amount"
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface"
                  />
                </div>
                <textarea
                  value={form.description} rows={2} maxLength={2000} placeholder="Description" aria-label="Description"
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className="sm:col-span-2 px-3 py-2 border border-border rounded-lg text-sm bg-surface resize-y"
                />
              </div>
            ) : (
              <dl className="p-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Kind', doc.kind],
                  ['Date on document', formatShortDate(doc.occurredAt)],
                  ['Amount', doc.amount == null ? '—' : formatPrice(doc.amount)],
                  ['Uploaded', formatShortDate(doc.createdAt)],
                  ['File', doc.originalName],
                  ['Size', `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB`],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-text-muted text-xs">{label}</dt>
                    <dd className="text-text-secondary text-right truncate">{value}</dd>
                  </div>
                ))}
                {doc.description && (
                  <div className="sm:col-span-2 pt-2 border-t border-border mt-1">
                    <dd className="text-text-secondary whitespace-pre-wrap">{doc.description}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          {/* Filed against */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">
                Filed against{doc.links.length > 0 && <span className="text-text-muted font-normal"> · {doc.links.length}</span>}
                {linksDirty && <span className="ml-2 text-xs font-normal text-warning">unsaved</span>}
              </h3>
              <button
                onClick={() => (editingLinks ? saveLinks() : setEditingLinks(true))}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer disabled:opacity-40"
              >
                {editingLinks ? <><Check className="w-3.5 h-3.5" /> Save</> : <><Pencil className="w-3.5 h-3.5" /> Change</>}
              </button>
            </div>

            {editingLinks ? (
              <div className="p-4">
                <LinkPicker value={links} onChange={setLinks} />
              </div>
            ) : doc.links.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <AlertTriangle className="w-4 h-4 text-warning mx-auto mb-2" />
                <p className="text-sm text-text-secondary">Not filed against anything.</p>
                <p className="text-xs text-text-muted mt-1">
                  Fine for a certificate or a statement — but a receipt usually belongs to an order or an expense.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {doc.links.map((l) =>
                  l.order ? (
                    <Link
                      key={l.id}
                      href={`/admin/orders/${l.order.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors"
                    >
                      <ShoppingBag className="w-4 h-4 text-text-muted shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{l.order.orderNumber}</span>
                        <span className="block text-xs text-text-muted truncate">{l.order.customerName}</span>
                      </span>
                      <span className="text-xs tabular-nums text-text-secondary shrink-0">{formatPrice(l.order.total)}</span>
                    </Link>
                  ) : l.expense ? (
                    <Link
                      key={l.id}
                      href="/admin/finance/expenses"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors"
                    >
                      <Receipt className="w-4 h-4 text-text-muted shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{l.expense.description}</span>
                        <span className="block text-xs text-text-muted truncate">{l.expense.category}</span>
                      </span>
                      <span className="text-xs tabular-nums text-text-secondary shrink-0">{formatPrice(l.expense.amount)}</span>
                    </Link>
                  ) : null
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-text-muted">
            This file is private to the admin — it is not served publicly, and there is no shareable link to it.
            Downloading is the only way to send it to anyone.
          </p>
        </div>
      </div>
    </div>
  );
}
