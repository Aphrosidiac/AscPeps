'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail, CheckCircle2, Clock, AlertTriangle, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetEmails, adminRetryFailedEmails, adminResendOrderEmail } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { EMAIL_TYPE_LABELS, emailStatusText } from '@/lib/email-status';
import type { AdminEmailsResponse, AdminEmailRow } from '@/types';

const PAGE_SIZE = 50;

// "ALL" is the unfiltered tab; the rest map straight onto the outbox status
// filter the backend accepts.
const TABS = ['ALL', 'PENDING', 'FAILED', 'SENT'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  ALL: 'All',
  PENDING: 'Pending',
  FAILED: 'Failed',
  SENT: 'Sent',
};

// useSearchParams needs a Suspense boundary for this route to prerender —
// the boundary wraps the whole page, so the fallback mirrors its skeleton.
export default function AdminEmailsPage() {
  return (
    <Suspense fallback={<EmailsPageSkeleton />}>
      <AdminEmailsContent />
    </Suspense>
  );
}

function EmailsPageSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-surface-elevated rounded w-48" />
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-surface-elevated rounded-xl" />)}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-surface-elevated rounded-xl" />)}
      </div>
    </div>
  );
}

function AdminEmailsContent() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  // The dashboard's failed-emails warning links here as ?status=FAILED —
  // seed the filter from the URL, then let client state take over.
  const statusParam = (searchParams.get('status') || '').toUpperCase();
  const initialTab: Tab = (TABS as readonly string[]).includes(statusParam) && statusParam !== 'ALL' ? (statusParam as Tab) : 'ALL';

  const [tab, setTab] = useState<Tab>(initialTab);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminEmailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    const params: { status?: string; page: number; pageSize: number } = { page, pageSize: PAGE_SIZE };
    if (tab !== 'ALL') params.status = tab;
    adminGetEmails(token, params)
      .then((r) => { setResult(r); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token, tab, page]);

  useEffect(() => { load(); }, [load]);

  const selectTab = (next: Tab) => {
    setTab(next);
    setPage(1);
  };

  const handleRetryRow = async (row: AdminEmailRow) => {
    if (!token) return;
    setRetrying(row.id);
    try {
      await adminResendOrderEmail(token, row.order.id, row.type);
      load();
    } catch {
      // Non-critical — the row simply won't change until the next refetch.
    } finally {
      setRetrying(null);
    }
  };

  const handleRetryAll = async () => {
    if (!token) return;
    setRetryingAll(true);
    try {
      await adminRetryFailedEmails(token);
      load();
    } catch {
      // Non-critical — the list simply won't change until the next refetch.
    } finally {
      setRetryingAll(false);
    }
  };

  const stats = result?.stats;
  const rows = result?.data ?? [];
  const pagination = result?.pagination;

  const statCards = [
    { label: 'Sent · last 7 days', value: stats?.sentLast7Days ?? 0, icon: CheckCircle2, accent: 'text-success' },
    { label: 'Pending', value: stats?.pending ?? 0, icon: Clock, accent: 'text-warning' },
    { label: 'Failed', value: stats?.failed ?? 0, icon: AlertTriangle, accent: 'text-danger' },
  ];

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-text-muted mb-4">Failed to load emails.</p>
        <button onClick={load} className="text-sm font-medium text-primary underline cursor-pointer">Try again</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">Emails</h1>
        <button
          onClick={handleRetryAll}
          disabled={retryingAll || !stats || stats.failed === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-danger/10 text-danger rounded-lg text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {retryingAll ? 'Queuing...' : 'Retry all failed'}
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-surface rounded-xl border border-border p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-secondary">{card.label}</span>
              <card.icon className={`w-4 h-4 ${card.accent}`} />
            </div>
            <p className="font-display text-xl sm:text-2xl font-bold">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => selectTab(t)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
              tab === t
                ? t === 'FAILED' ? 'bg-danger text-white' : 'bg-primary text-white'
                : t === 'FAILED' ? 'bg-danger/10 text-danger hover:bg-danger/20' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {TAB_LABELS[t]}
            {t === 'FAILED' && (stats?.failed ?? 0) > 0 && (
              <span className={`px-1.5 py-px rounded-full text-[10px] font-semibold ${tab === t ? 'bg-white/20' : 'bg-danger text-white'}`}>
                {stats!.failed}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-surface-elevated rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <Mail className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted text-lg mb-1">No emails found</p>
          <p className="text-text-muted text-sm">
            {tab !== 'ALL' ? 'No emails with this status.' : 'Transactional emails will appear here once orders come in.'}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Order #</th>
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Recipient</th>
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Attempts</th>
                  <th className="px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Sent / Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const { text, className } = emailStatusText(row);
                  const isRetrying = retrying === row.id;
                  return (
                    <tr key={row.id} className="hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href="/admin/orders" className="font-display font-semibold hover:text-primary transition-colors">
                          {row.order.orderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium">{EMAIL_TYPE_LABELS[row.type]}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{row.toEmail}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={className} title={row.lastError ?? undefined}>{text}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-text-secondary">{row.attempts}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-text-muted text-xs">
                        {formatDate(row.sentAt ?? row.createdAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {row.status === 'FAILED' && (
                          <button
                            onClick={() => handleRetryRow(row)}
                            disabled={isRetrying}
                            className="px-2 py-0.5 bg-surface-elevated text-text-secondary rounded text-xs font-medium hover:bg-border hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            {isRetrying ? 'Queuing...' : 'Retry'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-text-muted">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} email{pagination.total !== 1 ? 's' : ''}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-elevated text-text-secondary rounded-lg text-sm font-medium hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-elevated text-text-secondary rounded-lg text-sm font-medium hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
