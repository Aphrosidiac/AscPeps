'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail, CheckCircle2, Clock, AlertTriangle, RotateCcw, ChevronLeft, ChevronRight, Eye, FileEdit, ListChecks } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetEmails, adminRetryFailedEmails, adminResendOrderEmail, adminGetOrders, adminPreviewEmail, adminSendTestEmail, adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { EMAIL_TYPE_LABELS, emailStatusText } from '@/lib/email-status';
import { Animate } from '@/components/ui/Animate';
import type { AdminEmailsResponse, AdminEmailRow } from '@/types';

const PAGE_SIZE = 50;

// "ALL" is the unfiltered tab; the rest map straight onto the outbox status
// filter the backend accepts.
const STATUS_TABS = ['ALL', 'PENDING', 'FAILED', 'SENT'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_TAB_LABELS: Record<StatusTab, string> = {
  ALL: 'All',
  PENDING: 'Pending',
  FAILED: 'Failed',
  SENT: 'Sent',
};

// The three top-level sections this page is split into — kept separate so
// each reads as one focused screen instead of one long scroll.
const MAIN_TABS = [
  { key: 'list', label: 'Email List', icon: ListChecks },
  { key: 'content', label: 'Email Content', icon: FileEdit },
  { key: 'preview', label: 'Template Preview', icon: Eye },
] as const;
type MainTab = (typeof MAIN_TABS)[number]['key'];

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
      <div className="h-20 bg-surface-elevated rounded-xl" />
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
  // seed the filter from the URL, then let client state take over. The
  // main tab always defaults to the List view (it's the only one with a
  // status filter to seed in the first place).
  const statusParam = (searchParams.get('status') || '').toUpperCase();
  const initialStatusTab: StatusTab = (STATUS_TABS as readonly string[]).includes(statusParam) && statusParam !== 'ALL' ? (statusParam as StatusTab) : 'ALL';

  const [mainTab, setMainTab] = useState<MainTab>('list');
  const [statusTab, setStatusTab] = useState<StatusTab>(initialStatusTab);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminEmailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  // Whether automated sending is actually enabled for THIS environment's
  // database — the real switch (see backend/src/utils/email.ts) so prod and
  // local can be flipped independently with no redeploy or restart. null
  // while loading, so the toggle never flashes a wrong state.
  const [emailsEnabled, setEmailsEnabled] = useState<boolean | null>(null);
  const [togglingEmails, setTogglingEmails] = useState(false);

  useEffect(() => {
    if (!token) return;
    adminGetSettings(token)
      .then((s) => setEmailsEnabled(s.emails_enabled === 'true'))
      .catch(() => {});
  }, [token]);

  const handleToggleEmails = async () => {
    if (!token || emailsEnabled === null) return;
    const next = !emailsEnabled;
    setTogglingEmails(true);
    setEmailsEnabled(next); // optimistic — this is a single boolean, not worth a rollback dance
    try {
      await adminUpdateSettings(token, { emails_enabled: next ? 'true' : 'false' });
    } catch {
      setEmailsEnabled(!next);
    } finally {
      setTogglingEmails(false);
    }
  };

  const load = useCallback(() => {
    if (!token) return;
    const params: { status?: string; page: number; pageSize: number } = { page, pageSize: PAGE_SIZE };
    if (statusTab !== 'ALL') params.status = statusTab;
    adminGetEmails(token, params)
      .then((r) => { setResult(r); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [token, statusTab, page]);

  useEffect(() => { load(); }, [load]);

  const selectStatusTab = (next: StatusTab) => {
    setStatusTab(next);
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

  // Preview refetch trigger: bumped whenever the Email Content panel saves,
  // so the Template Preview tab reflects the new copy without the admin
  // having to manually switch type/order to force a refetch.
  const [contentRefreshKey, setContentRefreshKey] = useState(0);

  const stats = result?.stats;
  const rows = result?.data ?? [];
  const pagination = result?.pagination;
  // Distinct from `emailsEnabled` — this is whether the server even has a
  // key to turn sending on with at all, regardless of the DB toggle.
  const hasApiKey = result?.hasApiKey ?? true; // default true so the banner doesn't flash on first load

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
      <h1 className="font-display text-2xl font-bold mb-6">Emails</h1>

      {/* Automated sending toggle — the real switch lives in this
          environment's database (see backend/src/utils/email.ts), so this
          can be on locally and off in production independently. Stays
          visible across every tab below since it's a global status, not
          the content of any one section. */}
      <div className="flex items-center justify-between gap-4 bg-surface rounded-xl border border-border p-4 sm:p-5 mb-4">
        <div>
          <p className="font-medium">Automated sending</p>
          <p className="text-sm text-text-muted mt-0.5">
            {emailsEnabled
              ? 'Order confirmations and payment receipts send automatically.'
              : 'Off — no automated emails go out. Existing orders won’t queue confirmations while this is off.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={emailsEnabled ?? false}
          aria-label="Toggle automated email sending"
          onClick={handleToggleEmails}
          disabled={emailsEnabled === null || togglingEmails || !hasApiKey}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default ${
            emailsEnabled ? 'bg-success' : 'bg-border'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              emailsEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* RESEND_API_KEY missing — the toggle above can't do anything even if
          flipped on, so say so distinctly from the "toggled off" state. */}
      {!hasApiKey && (
        <div className="flex items-start gap-2.5 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3 mb-6">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-sm text-warning">
            RESEND_API_KEY is not set on the server. Automated sending and test-sends can&#39;t work regardless of the toggle above until an admin sets it in the server environment.
          </p>
        </div>
      )}

      {/* Section tabs */}
      <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
        {MAIN_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setMainTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer whitespace-nowrap ${
              mainTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === 'list' && (stats?.failed ?? 0) > 0 && (
              <span className="px-1.5 py-px rounded-full text-[10px] font-semibold bg-danger text-white">{stats!.failed}</span>
            )}
          </button>
        ))}
      </div>

      <Animate key={mainTab} variant="fade" duration={0.25}>
        {mainTab === 'list' && (
          <EmailListTab
            loading={loading}
            rows={rows}
            stats={stats}
            statusTab={statusTab}
            selectStatusTab={selectStatusTab}
            pagination={pagination}
            setPage={setPage}
            retrying={retrying}
            retryingAll={retryingAll}
            handleRetryRow={handleRetryRow}
            handleRetryAll={handleRetryAll}
          />
        )}
        {mainTab === 'content' && (
          <EmailContentSettings token={token} onSaved={() => setContentRefreshKey((k) => k + 1)} />
        )}
        {mainTab === 'preview' && (
          <TemplatePreview token={token} refreshKey={contentRefreshKey} />
        )}
      </Animate>
    </div>
  );
}

interface EmailListTabProps {
  loading: boolean;
  rows: AdminEmailRow[];
  stats: AdminEmailsResponse['stats'] | undefined;
  statusTab: StatusTab;
  selectStatusTab: (t: StatusTab) => void;
  pagination: AdminEmailsResponse['pagination'] | undefined;
  setPage: (fn: (p: number) => number) => void;
  retrying: string | null;
  retryingAll: boolean;
  handleRetryRow: (row: AdminEmailRow) => void;
  handleRetryAll: () => void;
}

function EmailListTab({
  loading, rows, stats, statusTab, selectStatusTab, pagination, setPage,
  retrying, retryingAll, handleRetryRow, handleRetryAll,
}: EmailListTabProps) {
  const statCards = [
    { label: 'Sent · last 7 days', value: stats?.sentLast7Days ?? 0, icon: CheckCircle2, accent: 'text-success' },
    { label: 'Pending', value: stats?.pending ?? 0, icon: Clock, accent: 'text-warning' },
    { label: 'Failed', value: stats?.failed ?? 0, icon: AlertTriangle, accent: 'text-danger' },
  ];

  return (
    <div>
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

      {/* Status filter + bulk retry */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex gap-2 flex-wrap">
          {STATUS_TABS.map((t) => (
            <button
              key={t}
              onClick={() => selectStatusTab(t)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                statusTab === t
                  ? t === 'FAILED' ? 'bg-danger text-white' : 'bg-primary text-white'
                  : t === 'FAILED' ? 'bg-danger/10 text-danger hover:bg-danger/20' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
              }`}
            >
              {STATUS_TAB_LABELS[t]}
              {t === 'FAILED' && (stats?.failed ?? 0) > 0 && (
                <span className={`px-1.5 py-px rounded-full text-[10px] font-semibold ${statusTab === t ? 'bg-white/20' : 'bg-danger text-white'}`}>
                  {stats!.failed}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={handleRetryAll}
          disabled={retryingAll || !stats || stats.failed === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-danger/10 text-danger rounded-lg text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 disabled:cursor-default cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {retryingAll ? 'Queuing...' : 'Retry all failed'}
        </button>
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
            {statusTab !== 'ALL' ? 'No emails with this status.' : 'Transactional emails will appear here once orders come in.'}
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
                        <Link href={`/admin/orders?orderId=${row.order.id}`} className="font-display font-semibold hover:text-primary transition-colors">
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
                        {(row.status === 'PENDING' || row.status === 'FAILED') && (
                          <div className="mt-0.5">Next attempt: {formatDate(row.nextAttemptAt)}</div>
                        )}
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

// Editable copy behind the templates — subjects, badge labels, the payment
// button label, and the WhatsApp payment-instructions sentence. Reuses the
// generic Settings GET/PUT (adminGetSettings/adminUpdateSettings) the
// automated-sending toggle above already uses — no dedicated endpoint.
const EMAIL_CONTENT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'email_subject_confirmation', label: 'Confirmation email subject', placeholder: 'Order {orderNumber} received — Ascend Peptides' },
  { key: 'email_subject_receipt', label: 'Receipt email subject', placeholder: 'Receipt for order {orderNumber}' },
  { key: 'email_badge_confirmation', label: 'Confirmation badge label', placeholder: 'ORDER CONFIRMED' },
  { key: 'email_badge_receipt', label: 'Receipt badge label', placeholder: 'PAYMENT RECEIVED' },
  { key: 'email_button_label', label: 'Payment button label', placeholder: 'COMPLETE PAYMENT' },
  { key: 'email_whatsapp_instructions', label: 'WhatsApp payment instructions', placeholder: "Manual transfer via WhatsApp. Payment is completed through our WhatsApp chat — we'll confirm your order once it's received." },
];

function EmailContentSettings({ token, onSaved }: { token: string | null; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) return;
    adminGetSettings(token)
      .then((s) => setValues(Object.fromEntries(EMAIL_CONTENT_FIELDS.map((f) => [f.key, s[f.key] ?? '']))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const updateValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setError(false);
    try {
      await adminUpdateSettings(token, values);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-4 sm:p-5">
      <p className="font-medium">Email Content</p>
      <p className="text-sm text-text-muted mt-0.5 mb-4">
        Admin-editable copy used in the templates. Leave a field blank to fall back to its built-in default. Use <code>{'{orderNumber}'}</code> in subjects to insert the order number.
      </p>
      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: EMAIL_CONTENT_FIELDS.length }).map((_, i) => <div key={i} className="h-9 bg-surface-elevated rounded-lg" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {EMAIL_CONTENT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1">{f.label}</label>
              <input
                type="text"
                value={values[f.key] ?? ''}
                onChange={(e) => updateValue(f.key, e.target.value)}
                placeholder={f.placeholder}
                className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            {saved && <span className="text-sm text-success font-medium">Saved</span>}
            {error && <span className="text-sm text-danger">Failed to save</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Force the previewed email into one colour scheme.
 *
 * The templates theme themselves with `@media (prefers-color-scheme: dark)`,
 * which follows the machine you happen to be sitting at — so the preview could
 * only ever show you one of the two, and the one it showed depended on your OS
 * setting rather than on what you wanted to check. Rewriting the media
 * condition is enough to pin it: `all` always matches, a zero max-width never
 * does. Nothing else in the HTML is touched, so what renders is still the real
 * template rather than a re-styled copy of it.
 */
function forceScheme(html: string, scheme: 'light' | 'dark'): string {
  return html.replace(
    /@media \(prefers-color-scheme: dark\)/g,
    scheme === 'dark' ? '@media all' : '@media (prefers-color-scheme: dark) and (max-width:0px)'
  );
}

// Read-only rendering of the actual email templates, straight from the same
// server code the outbox worker uses — adjustable by type and sample order.
function TemplatePreview({ token, refreshKey }: { token: string | null; refreshKey: number }) {
  const [type, setType] = useState<'ORDER_CONFIRMATION' | 'PAYMENT_RECEIPT'>('ORDER_CONFIRMATION');
  const [orderId, setOrderId] = useState(''); // '' = latest order
  // Defaults to light: it is what most inboxes still render, so it is the more
  // useful first look. Dark is one click away and is where the subtler bugs are.
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [orders, setOrders] = useState<{ id: string; orderNumber: string; customerName: string }[]>([]);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState(false);

  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    adminGetOrders(token, { limit: '20' })
      .then((r) => setOrders(r.data.map((o) => ({ id: o.id, orderNumber: o.orderNumber, customerName: o.customerName }))))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    adminPreviewEmail(token, { type, ...(orderId ? { orderId } : {}) })
      .then((r) => { if (!stale) { setPreview(r); setPreviewError(false); } })
      .catch(() => { if (!stale) setPreviewError(true); });
    return () => { stale = true; };
  }, [token, type, orderId, refreshKey]);

  const handleSendTest = async () => {
    if (!token || !testEmail) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      await adminSendTestEmail(token, { type, ...(orderId ? { orderId } : {}), to: testEmail });
      setTestResult({ ok: true, message: 'Sent — check the inbox.' });
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setTestResult({ ok: false, message: message || 'Failed to send test email.' });
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-text-muted mb-4">
        Rendered from a real order, exactly as the customer receives it. Read-only — templates are maintained in code.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-1">
        <div className="flex gap-2">
          {(['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                type === t ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
              }`}
            >
              {EMAIL_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <select
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">Latest order</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>{o.orderNumber} — {o.customerName}</option>
          ))}
        </select>
        <div className="flex gap-1 p-1 rounded-full bg-surface-elevated">
          {(['light', 'dark'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScheme(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors cursor-pointer ${
                scheme === s ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <input
            type="email"
            value={testEmail}
            onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); }}
            placeholder="test@email.com"
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-sm text-text-primary w-48 focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <button
            onClick={handleSendTest}
            disabled={sendingTest || !testEmail}
            className="px-3 py-1.5 bg-surface-elevated text-text-secondary rounded-lg text-xs font-medium hover:bg-border hover:text-text-primary transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {sendingTest ? 'Sending...' : 'Send test'}
          </button>
        </div>
      </div>
      <div className="mb-4">
        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-success' : 'text-danger'}`}>{testResult.message}</p>
        )}
      </div>

      {previewError ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center text-sm text-text-muted">
          No order available to preview with yet.
        </div>
      ) : !preview ? (
        <div className="h-[620px] bg-surface-elevated rounded-xl animate-pulse" />
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border text-sm">
            <span className="text-text-muted">Subject:</span>{' '}
            <span className="font-medium">{preview.subject}</span>
          </div>
          <iframe
            key={scheme}
            title="Email template preview"
            sandbox=""
            srcDoc={forceScheme(preview.html, scheme)}
            // The page background the email sits on is part of what is being
            // judged, so the iframe carries the scheme's own backdrop rather
            // than a fixed white one that would flash on every dark render.
            className="w-full h-[620px]"
            style={{ backgroundColor: scheme === 'dark' ? '#0a0a0a' : '#f4f4f4' }}
          />
        </div>
      )}
    </div>
  );
}
