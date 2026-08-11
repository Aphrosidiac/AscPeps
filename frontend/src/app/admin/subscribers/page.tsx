'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Download, Mail, Plus, RefreshCw, Search, Trash2, UserMinus, AlertTriangle,
  X, Info, Send, CheckCircle2, Clock, XCircle, Eye, ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetSubscribers,
  adminSubscriberStats,
  adminAddSubscriber,
  adminUnsubscribeSubscriber,
  adminRetryWelcomeEmail,
  adminDeleteSubscriber,
  adminExportSubscribers,
  adminPreviewWelcomeEmail,
} from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';

type WelcomeStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED';

interface Subscriber {
  id: string;
  email: string;
  status: 'SUBSCRIBED' | 'UNSUBSCRIBED';
  source: 'FOOTER' | 'CHECKOUT' | 'ADMIN';
  createdAt: string;
  unsubscribedAt: string | null;
  unsubscribeReason: string | null;
  welcomeSentAt: string | null;
  welcomeAttempts: number;
  welcomeError: string | null;
  welcomeStatus: WelcomeStatus;
  welcomeStatusAt: string | null;
  // The sweep has stopped retrying on its own (see MAX_WELCOME_ATTEMPTS on the
  // backend) — true means the manual Retry button is the only way forward.
  welcomeExhausted: boolean;
  welcomeDiscountCode: { code: string; usedCount: number } | null;
}

interface Stats {
  subscribed: number;
  unsubscribed: number;
  last30Days: number;
  pendingWelcome: number;
  delivered: number;
  deliveryIssues: number;
  bySource: Record<string, number>;
}

const SOURCE_LABELS: Record<Subscriber['source'], string> = {
  FOOTER: 'Site',
  CHECKOUT: 'Checkout',
  ADMIN: 'Added by hand',
};

// One badge per row, driven by the same fields the flow drawer reads — the
// list and the drawer never disagree about what state a subscriber is in.
function welcomeBadge(s: Subscriber): { label: string; color: string; icon: typeof Send } {
  if (s.welcomeStatus === 'DELIVERED') return { label: 'Delivered', color: 'bg-green-100 text-green-800', icon: CheckCircle2 };
  if (s.welcomeStatus === 'BOUNCED') return { label: 'Bounced', color: 'bg-red-100 text-red-700', icon: XCircle };
  if (s.welcomeStatus === 'COMPLAINED') return { label: 'Marked as spam', color: 'bg-red-100 text-red-700', icon: ShieldAlert };
  if (s.welcomeStatus === 'SENT') return { label: 'Sent', color: 'bg-blue-100 text-blue-800', icon: Send };
  if (s.welcomeExhausted) return { label: 'Failed', color: 'bg-red-100 text-red-700', icon: XCircle };
  if (s.welcomeError) return { label: `Retrying ×${s.welcomeAttempts}`, color: 'bg-amber-100 text-amber-800', icon: RefreshCw };
  return { label: 'Queued', color: 'bg-surface-elevated text-text-secondary', icon: Clock };
}

const WELCOME_LEGEND = [
  ['Queued', 'Signed up. Waiting for the welcome sweep to pick it up (runs every few minutes).'],
  ['Retrying ×N', 'Send failed at least once — the sweep is backing off and will try again automatically.'],
  ['Sent', 'Handed off to our email provider (Resend). Waiting for delivery confirmation.'],
  ['Delivered', "Confirmed accepted by the recipient's mail server."],
  ['Bounced / Marked as spam', 'Rejected or reported. The address was automatically unsubscribed.'],
  ['Failed', 'Gave up retrying automatically. Needs a manual retry.'],
] as const;

export default function AdminSubscribersPage() {
  const { token } = useAuth();
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'SUBSCRIBED' | 'UNSUBSCRIBED'>('SUBSCRIBED');
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Subscriber | null>(null);
  const [flowTarget, setFlowTarget] = useState<Subscriber | null>(null);
  const [showLegend, setShowLegend] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    const params: Record<string, string> = { limit: '100' };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;

    Promise.all([adminGetSubscribers(token, params), adminSubscriberStats(token)])
      .then(([list, s]) => {
        setSubscribers(list.data);
        setStats(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, search, statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the drawer's copy of the row in sync whenever the list reloads
  // (e.g. after a retry), instead of it going stale the moment an action fires.
  useEffect(() => {
    if (!flowTarget) return;
    const fresh = subscribers.find((s) => s.id === flowTarget.id);
    if (fresh) setFlowTarget(fresh);
  }, [subscribers, flowTarget]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newEmail.trim()) return;
    setAdding(true);
    setAddError('');
    try {
      await adminAddSubscriber(token, newEmail.trim());
      setNewEmail('');
      load();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setAddError(message || 'Could not add that address');
    } finally {
      setAdding(false);
    }
  };

  const act = async (fn: Promise<unknown>) => {
    try {
      await fn;
    } catch {
      /* the reload below reflects whatever actually happened */
    }
    load();
  };

  const statCards = stats
    ? [
        { label: 'Subscribed', value: stats.subscribed },
        { label: 'Joined (30 days)', value: stats.last30Days },
        { label: 'Awaiting welcome', value: stats.pendingWelcome },
        { label: 'Delivered', value: stats.delivered },
        { label: 'Delivery issues', value: stats.deliveryIssues, accent: stats.deliveryIssues > 0 },
        { label: 'Unsubscribed', value: stats.unsubscribed },
      ]
    : [];

  return (
    <div>
      <Animate variant="fadeUp">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Subscribers</h1>
            <p className="text-sm text-text-muted mt-0.5">The marketing email list</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (!token) return;
              const params: Record<string, string> = {};
              if (search) params.search = search;
              if (statusFilter) params.status = statusFilter;
              adminExportSubscribers(token, params);
            }}
          >
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </Animate>

      <Animate variant="fadeUp" delay={0.05}>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={cn(
                'bg-surface rounded-xl border p-4',
                card.accent ? 'border-danger/30' : 'border-border'
              )}
            >
              <p className="text-xs text-text-muted uppercase tracking-wider">{card.label}</p>
              <p className={cn('font-display text-2xl font-bold mt-1', card.accent && 'text-danger')}>{card.value}</p>
            </div>
          ))}
        </div>
      </Animate>

      <Animate variant="fadeUp" delay={0.1}>
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search by email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="flex gap-1 p-1 bg-surface-elevated rounded-lg">
            {(
              [
                ['SUBSCRIBED', 'Active'],
                ['UNSUBSCRIBED', 'Left'],
                ['', 'All'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                onClick={() => setStatusFilter(value)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer',
                  statusFilter === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={handleAdd} className="flex gap-2 sm:ml-auto">
            <input
              type="email"
              required
              placeholder="Add an address..."
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <Button type="submit" variant="outline" disabled={adding}>
              <Plus className="w-4 h-4" /> Add
            </Button>
          </form>
        </div>
        {addError && <p className="text-sm text-danger -mt-3 mb-4">{addError}</p>}
      </Animate>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface-elevated rounded" />
          ))}
        </div>
      ) : subscribers.length === 0 ? (
        <Animate variant="fadeUp">
          <div className="text-center py-16">
            <Mail className="w-10 h-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-lg mb-1">Nobody here yet</p>
            <p className="text-text-muted text-sm">
              {search ? 'Try a different search.' : 'Signups from the site footer, the popup and checkout land here.'}
            </p>
          </div>
        </Animate>
      ) : (
        <Animate variant="fadeUp" delay={0.15}>
          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Joined</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">
                    <span className="inline-flex items-center gap-1 relative">
                      Welcome
                      <button
                        type="button"
                        onMouseEnter={() => setShowLegend(true)}
                        onMouseLeave={() => setShowLegend(false)}
                        onClick={() => setShowLegend((v) => !v)}
                        className="cursor-pointer text-text-muted hover:text-text-primary"
                        aria-label="What do these statuses mean?"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                      {showLegend && (
                        <div className="absolute z-20 top-full right-0 mt-2 w-72 bg-surface border border-border rounded-xl shadow-lg p-3 text-left normal-case">
                          <p className="text-xs font-semibold text-text-primary mb-2">What each status means</p>
                          <dl className="space-y-2">
                            {WELCOME_LEGEND.map(([label, blurb]) => (
                              <div key={label}>
                                <dt className="text-xs font-medium text-text-primary">{label}</dt>
                                <dd className="text-xs text-text-muted leading-snug">{blurb}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </span>
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Code</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((s) => {
                  const welcome = welcomeBadge(s);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setFlowTarget(s)}
                      className="border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <p className={cn('font-medium', s.status === 'UNSUBSCRIBED' && 'text-text-muted line-through')}>
                          {s.email}
                        </p>
                        {s.status === 'UNSUBSCRIBED' && (
                          <p className="text-xs text-text-muted mt-0.5">
                            Left {s.unsubscribedAt ? formatDate(s.unsubscribedAt) : ''}
                            {s.unsubscribeReason ? ` — ${s.unsubscribeReason}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">{SOURCE_LABELS[s.source]}</td>
                      <td className="px-4 py-3 text-text-secondary hidden md:table-cell">{formatDate(s.createdAt)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge className={cn('gap-1', welcome.color)}>
                          <welcome.icon className="w-3 h-3" />
                          {welcome.label}
                        </Badge>
                        {s.welcomeError && (
                          <p className="text-xs text-text-muted mt-1 max-w-48 mx-auto line-clamp-2" title={s.welcomeError}>
                            {s.welcomeError}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {s.welcomeDiscountCode ? (
                          <span className="font-mono text-xs">
                            {s.welcomeDiscountCode.code}
                            {s.welcomeDiscountCode.usedCount > 0 && (
                              <span className="ml-1.5 text-green-700 font-sans">used</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-text-muted">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setFlowTarget(s)}
                            className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer transition-colors"
                            title="View welcome email flow"
                          >
                            <Eye className="w-4 h-4 text-text-muted" />
                          </button>
                          {!s.welcomeSentAt && s.welcomeError && (
                            <button
                              onClick={() => token && act(adminRetryWelcomeEmail(token, s.id))}
                              className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer transition-colors"
                              title="Retry welcome email"
                            >
                              <RefreshCw className="w-4 h-4 text-text-muted" />
                            </button>
                          )}
                          {s.status === 'SUBSCRIBED' && (
                            <button
                              onClick={() => token && act(adminUnsubscribeSubscriber(token, s.id))}
                              className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer transition-colors"
                              title="Unsubscribe"
                            >
                              <UserMinus className="w-4 h-4 text-text-muted" />
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteTarget(s)}
                            className="p-1.5 hover:bg-red-50 rounded cursor-pointer transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4 text-text-muted hover:text-danger" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Animate>
      )}

      {flowTarget && (
        <SubscriberFlowDrawer
          subscriber={flowTarget}
          token={token}
          onClose={() => setFlowTarget(null)}
          onRetry={() => token && act(adminRetryWelcomeEmail(token, flowTarget.id))}
          onUnsubscribe={() => token && act(adminUnsubscribeSubscriber(token, flowTarget.id))}
        />
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="dialog-backdrop absolute inset-0 bg-black/50" onClick={() => setDeleteTarget(null)} />
          <div className="dialog-panel relative bg-surface rounded-xl border border-border p-6 max-w-sm w-full">
            <AlertTriangle className="w-8 h-8 text-danger" />
            <h2 className="font-display text-lg font-bold mt-3">Delete {deleteTarget.email}?</h2>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              This removes the row entirely. If they asked to stop receiving email, use Unsubscribe instead —
              deleting them means a future signup with the same address starts over as a new subscriber.
            </p>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" className="flex-1" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  if (token) act(adminDeleteSubscriber(token, deleteTarget.id));
                  setDeleteTarget(null);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TimelineStep {
  label: string;
  timestamp: string | null;
  state: 'done' | 'current' | 'error' | 'upcoming';
  detail?: string;
}

// The flow this walks is exactly what the backend does: subscribers.controller.ts
// creates the row -> marketing-worker.ts's welcome sweep sends it -> the Resend
// webhook (resend-webhook.controller.ts) reports delivery back. Every step here
// maps to one of those, in order, so "what did the user do to get here" always
// has a concrete answer.
function buildTimeline(s: Subscriber): TimelineStep[] {
  const steps: TimelineStep[] = [
    { label: 'Signed up', timestamp: s.createdAt, state: 'done', detail: `via ${SOURCE_LABELS[s.source]}` },
  ];

  if (!s.welcomeSentAt) {
    if (s.welcomeExhausted) {
      steps.push({
        label: 'Send failed',
        timestamp: null,
        state: 'error',
        detail: `Gave up after ${s.welcomeAttempts} attempt${s.welcomeAttempts !== 1 ? 's' : ''}: ${s.welcomeError ?? 'unknown error'}. Needs a manual retry.`,
      });
    } else if (s.welcomeError) {
      steps.push({
        label: `Retrying (attempt ${s.welcomeAttempts})`,
        timestamp: null,
        state: 'error',
        detail: `Last error: ${s.welcomeError}. The sweep will try again automatically.`,
      });
    } else {
      steps.push({ label: 'Queued', timestamp: null, state: 'current', detail: 'Waiting for the welcome sweep to send it.' });
    }
    return steps;
  }

  steps.push({ label: 'Welcome email sent', timestamp: s.welcomeSentAt, state: 'done', detail: 'Handed off to Resend.' });

  if (s.welcomeStatus === 'DELIVERED') {
    steps.push({ label: 'Delivered', timestamp: s.welcomeStatusAt, state: 'done', detail: "Confirmed by the recipient's mail server." });
  } else if (s.welcomeStatus === 'BOUNCED') {
    steps.push({ label: 'Bounced', timestamp: s.welcomeStatusAt, state: 'error', detail: 'Rejected by the recipient\'s mail server. Automatically unsubscribed.' });
  } else if (s.welcomeStatus === 'COMPLAINED') {
    steps.push({ label: 'Marked as spam', timestamp: s.welcomeStatusAt, state: 'error', detail: 'Reported as spam. Automatically unsubscribed.' });
  } else {
    steps.push({ label: 'Awaiting delivery confirmation', timestamp: null, state: 'current', detail: "Sent, but Resend hasn't reported the recipient's mail server accepting it yet." });
  }

  return steps;
}

function TimelineDot({ state }: { state: TimelineStep['state'] }) {
  if (state === 'done') return <div className="w-3 h-3 rounded-full bg-success ring-4 ring-success/15" />;
  if (state === 'error') return <div className="w-3 h-3 rounded-full bg-danger ring-4 ring-danger/15" />;
  if (state === 'current') return <div className="w-3 h-3 rounded-full bg-warning ring-4 ring-warning/15 animate-pulse" />;
  return <div className="w-3 h-3 rounded-full bg-border" />;
}

function SubscriberFlowDrawer({
  subscriber, token, onClose, onRetry, onUnsubscribe,
}: {
  subscriber: Subscriber;
  token: string | null;
  onClose: () => void;
  onRetry: () => void;
  onUnsubscribe: () => void;
}) {
  const [tab, setTab] = useState<'flow' | 'email'>('flow');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (tab !== 'email' || !token || preview) return;
    let stale = false;
    adminPreviewWelcomeEmail(token, { subscriberId: subscriber.id })
      .then((r) => { if (!stale) setPreview(r); })
      .catch(() => { if (!stale) setPreviewError(true); });
    return () => { stale = true; };
  }, [tab, token, subscriber.id, preview]);

  const timeline = buildTimeline(subscriber);
  const welcome = welcomeBadge(subscriber);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="dialog-backdrop absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="dialog-panel relative bg-surface border-l border-border w-full max-w-md h-full overflow-y-auto">
        <div className="sticky top-0 bg-surface border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-bold truncate max-w-[280px]">{subscriber.email}</p>
            <Badge className={cn('gap-1 mt-1.5', welcome.color)}>
              <welcome.icon className="w-3 h-3" />
              {welcome.label}
            </Badge>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer shrink-0" title="Close">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-5">
          {([
            ['flow', 'Flow'],
            ['email', 'Email content'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer',
                tab === key ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'flow' ? (
          <div className="p-5">
            <ol className="space-y-0">
              {timeline.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <TimelineDot state={step.state} />
                    {i < timeline.length - 1 && <div className="w-px flex-1 bg-border min-h-[28px]" />}
                  </div>
                  <div className={cn('pb-5', i === timeline.length - 1 && 'pb-0')}>
                    <p className={cn('text-sm font-medium', step.state === 'error' && 'text-danger')}>{step.label}</p>
                    {step.timestamp && <p className="text-xs text-text-muted mt-0.5">{formatDate(step.timestamp)}</p>}
                    {step.detail && <p className="text-xs text-text-muted mt-0.5 leading-relaxed">{step.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>

            {subscriber.welcomeDiscountCode && (
              <div className="mt-2 p-3 rounded-lg bg-surface-elevated border border-border">
                <p className="text-xs text-text-muted uppercase tracking-wider mb-1">First-order code</p>
                <p className="font-mono text-sm">
                  {subscriber.welcomeDiscountCode.code}{' '}
                  {subscriber.welcomeDiscountCode.usedCount > 0 ? (
                    <span className="text-green-700 font-sans text-xs">— used</span>
                  ) : (
                    <span className="text-text-muted font-sans text-xs">— not yet used</span>
                  )}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 mt-5">
              {!subscriber.welcomeSentAt && subscriber.welcomeError && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  <RefreshCw className="w-3.5 h-3.5" /> Retry welcome email
                </Button>
              )}
              {subscriber.status === 'SUBSCRIBED' && (
                <Button variant="outline" size="sm" onClick={onUnsubscribe}>
                  <UserMinus className="w-3.5 h-3.5" /> Unsubscribe
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-sm text-text-muted mb-4">
              {subscriber.welcomeDiscountCode
                ? 'Rendered with the actual code minted for this subscriber.'
                : subscriber.welcomeSentAt
                  ? 'Rendered from current settings — the code shown may differ from what was actually sent if settings changed since.'
                  : 'Not sent yet — rendered as a preview from current settings.'}
            </p>
            {previewError ? (
              <div className="bg-surface-elevated rounded-xl border border-border p-8 text-center text-sm text-text-muted">
                Couldn&#39;t load the preview.
              </div>
            ) : !preview ? (
              <div className="h-[480px] bg-surface-elevated rounded-xl animate-pulse" />
            ) : (
              <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border text-sm">
                  <span className="text-text-muted">Subject:</span> <span className="font-medium">{preview.subject}</span>
                </div>
                <iframe title="Welcome email preview" sandbox="" srcDoc={preview.html} className="w-full h-[480px] bg-white" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
