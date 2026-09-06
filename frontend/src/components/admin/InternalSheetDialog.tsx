'use client';

import { useEffect, useState } from 'react';
import { X, Download, AlertTriangle, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  adminDownloadShadowSummary,
  adminFetchShadowSummaryBlob,
  adminGetShadowSummary,
} from '@/lib/api';
import { formatPrice, formatShortDate } from '@/lib/utils';
import type { ShadowSummary } from '@/types';

/**
 * One order's internal sheet: the mapping being applied, and the rendered PDF.
 *
 * Two panes on purpose. The PDF alone answers "what does it look like", but the
 * question an admin actually has in front of a generalised document is "which
 * real thing became which line" — and that is not answerable from the sheet,
 * because the sheet is specifically the version without the real names on it.
 * So the mapping is shown beside it, real product on the left, printed line on
 * the right.
 *
 * The preview is a blob rather than a src URL: the token lives in localStorage,
 * so the browser's own request for an <iframe src> would arrive unauthenticated.
 */
export function InternalSheetDialog({
  orderId,
  orderNumber,
  onClose,
}: {
  orderId: string;
  orderNumber: string;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const panelRef = useModalA11y({ onClose });

  const [summary, setSummary] = useState<ShadowSummary | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    adminGetShadowSummary(token, orderId)
      .then(setSummary)
      .catch(() => setPreviewFailed(true))
      .finally(() => setLoading(false));
  }, [token, orderId]);

  // Only render the PDF once we know every line resolves — asking for it while
  // a SKU is unmapped is a guaranteed 400.
  useEffect(() => {
    if (!token || !summary?.complete) return;
    let revoked = false;
    let url: string | null = null;

    adminFetchShadowSummaryBlob(token, orderId)
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
  }, [token, orderId, summary?.complete]);

  const download = () => {
    if (token) adminDownloadShadowSummary(token, orderId, orderNumber).catch(() => setPreviewFailed(true));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Internal summary for order ${orderNumber}`}
        className="bg-surface rounded-xl border border-border w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 px-4 sm:px-5 py-3 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold truncate">{orderNumber} · internal summary</h2>
            <p className="text-xs text-text-muted truncate">
              {summary && (
                <>
                  {formatShortDate(summary.order.createdAt)} · {summary.order.status} ·{' '}
                  {summary.order.paymentStatus}
                </>
              )}
              {/* The reassurance is worth saying, but not worth five wrapped
                  lines on a phone — the sheet's own banner repeats it. */}
              <span className="hidden sm:inline"> · generalised names, customer receipt unchanged</span>
            </p>
          </div>
          {summary?.complete && (
            <button
              onClick={download}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary-light transition-colors cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-elevated transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <p className="p-5 text-sm text-text-muted">Loading…</p>
        ) : !summary ? (
          <p className="p-5 text-sm text-danger">Could not load this order.</p>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-y-auto lg:overflow-hidden">
            {/* --- the mapping --- */}
            {/* Inner scroll only where there are two columns to keep aligned.
                On a phone the panes are stacked and the dialog scrolls as one,
                so an inner scroll region here would squeeze the list into a
                two-row window. */}
            <div className="p-4 sm:p-5 lg:overflow-y-auto">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                What becomes what
              </h3>

              <ul className="space-y-3">
                {summary.lines.map((line) => (
                  <li key={line.itemId} className="flex items-start gap-3 text-sm">
                    <span className="w-6 shrink-0 text-xs text-text-muted tabular-nums pt-0.5">
                      {line.quantity}×
                    </span>
                    <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-start sm:gap-3">
                      <span className="min-w-0 sm:flex-1">
                        <span className="block font-medium truncate">{line.realName}</span>
                        <span className="block text-xs text-text-muted font-mono">{line.realCode}</span>
                      </span>
                      <ArrowRight className="hidden sm:block w-4 h-4 text-text-muted shrink-0 mt-1" />
                      <span className="min-w-0 sm:flex-1 mt-1.5 pl-3 border-l-2 border-border sm:mt-0 sm:pl-0 sm:border-0">
                        <span className="block font-medium truncate">{line.name}</span>
                        <span className="block text-xs text-text-muted font-mono">{line.code}</span>
                      </span>
                    </div>
                  </li>
                ))}

                {summary.unmapped.map((u) => (
                  <li key={u.itemId} className="flex items-start gap-3 text-sm">
                    <span className="w-6 shrink-0 text-xs text-text-muted tabular-nums pt-0.5">
                      {u.quantity}×
                    </span>
                    <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-start sm:gap-3">
                      <span className="min-w-0 sm:flex-1">
                        <span className="block font-medium truncate">{u.realName}</span>
                        <span className="block text-xs text-text-muted font-mono">{u.realCode}</span>
                      </span>
                      <ArrowRight className="hidden sm:block w-4 h-4 text-warning shrink-0 mt-1" />
                      <span className="min-w-0 sm:flex-1 mt-1.5 pl-3 border-l-2 border-warning/40 sm:mt-0 sm:pl-0 sm:border-0 inline-flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> not mapped
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 pt-3 border-t border-border flex justify-between text-sm">
                <span className="text-text-secondary">Total — same as the real order</span>
                <span className="font-semibold">{formatPrice(summary.order.total)}</span>
              </div>

              {!summary.complete && (
                <Link
                  href="/admin/shadow-skus"
                  className="inline-block mt-4 text-xs font-medium text-primary underline"
                >
                  Map the missing SKUs →
                </Link>
              )}
            </div>

            {/* --- the sheet --- */}
            <div className="min-h-[55vh] lg:min-h-0 bg-surface-elevated">
              {!summary.complete ? (
                <p className="p-5 text-sm text-warning">
                  No sheet can be produced while {summary.unmapped.length} item
                  {summary.unmapped.length === 1 ? ' has' : 's have'} no shadow code.
                </p>
              ) : previewFailed ? (
                <p className="p-5 text-sm text-danger">Could not render the sheet.</p>
              ) : blobUrl ? (
                <iframe
                  // navpanes=0 drops the thumbnail rail, which in a half-width
                  // pane leaves almost nothing for the page. zoom=page-fit shows
                  // the whole sheet from the top — FitH alone opened it scrolled
                  // to the footer, which looked like a rendering bug.
                  src={`${blobUrl}#navpanes=0&zoom=page-fit`}
                  title={`Internal summary for ${orderNumber}`}
                  className="w-full h-full min-h-[55vh]"
                />
              ) : (
                <p className="p-5 text-sm text-text-muted">Rendering…</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
