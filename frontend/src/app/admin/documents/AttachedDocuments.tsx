'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Image as ImageIcon, Plus, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetDocuments } from '@/lib/api';
import { formatPrice, formatShortDate } from '@/lib/utils';
import type { Document } from '@/types';
import { UploadDocumentDialog } from './UploadDocumentDialog';
import { DocumentDetail } from './DocumentDetail';

/**
 * The paperwork filed against one order or one expense, shown where that thing
 * lives.
 *
 * The document store is only useful if filing happens at the moment the
 * document is in your hand — which is while you are looking at the order, not
 * later from a separate page. So this carries a full upload dialog with the
 * link pre-selected, rather than a link that sends you elsewhere to do it.
 */
export function AttachedDocuments({
  orderId,
  expenseId,
  className,
}: {
  orderId?: string;
  expenseId?: string;
  className?: string;
}) {
  const { token } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<Document | null>(null);

  const load = useCallback(() => {
    if (!token || (!orderId && !expenseId)) return;
    adminGetDocuments(token, orderId ? { orderId } : { expenseId: expenseId as string })
      .then((res) => { setDocuments(res.documents); setKinds(res.kinds); })
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  }, [token, orderId, expenseId]);

  useEffect(() => { load(); }, [load]);

  const presetLinks = {
    orderIds: orderId ? [orderId] : [],
    expenseIds: expenseId ? [expenseId] : [],
  };

  return (
    <div className={className}>
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-text-muted" />
            <h2 className="text-sm font-semibold">
              Documents{documents.length > 0 && <span className="text-text-muted font-normal"> · {documents.length}</span>}
            </h2>
          </div>
          <button
            onClick={() => setUploading(true)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Attach
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-4 space-y-2 animate-pulse">
            <div className="h-4 bg-surface-elevated rounded w-2/3" />
          </div>
        ) : documents.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-text-muted">
            No receipts or invoices filed here yet.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {documents.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d)}
                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-elevated transition-colors cursor-pointer"
              >
                {d.mimeType === 'application/pdf'
                  ? <FileText className="w-4 h-4 text-danger shrink-0" />
                  : <ImageIcon className="w-4 h-4 text-primary shrink-0" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium truncate">{d.title}</span>
                  <span className="block text-xs text-text-muted truncate">
                    {d.kind} · {formatShortDate(d.occurredAt)}
                  </span>
                </span>
                {d.amount != null && (
                  <span className="text-sm tabular-nums text-text-secondary shrink-0">{formatPrice(d.amount)}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <Link
          href="/admin/documents"
          className="flex items-center justify-end gap-1 px-5 py-2.5 border-t border-border text-xs text-text-muted hover:text-primary transition-colors"
        >
          All documents <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {uploading && (
        <UploadDocumentDialog
          kinds={kinds}
          presetLinks={presetLinks}
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
            // A link change here can move the document out of this list
            // entirely, so re-read rather than patching the row in place.
            load();
          }}
          onDeleted={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
