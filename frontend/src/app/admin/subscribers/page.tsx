'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Mail, Plus, RefreshCw, Search, Trash2, UserMinus, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetSubscribers,
  adminSubscriberStats,
  adminAddSubscriber,
  adminUnsubscribeSubscriber,
  adminRetryWelcomeEmail,
  adminDeleteSubscriber,
  adminExportSubscribers,
} from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';

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
  welcomeDiscountCode: { code: string; usedCount: number } | null;
}

interface Stats {
  subscribed: number;
  unsubscribed: number;
  last30Days: number;
  pendingWelcome: number;
  bySource: Record<string, number>;
}

const SOURCE_LABELS: Record<Subscriber['source'], string> = {
  FOOTER: 'Site',
  CHECKOUT: 'Checkout',
  ADMIN: 'Added by hand',
};

// A row's welcome state is three-valued, and the middle one matters most: an
// address that has been queued but keeps failing is the case worth surfacing,
// because it means somebody joined the list and never got their code.
function welcomeState(s: Subscriber): { label: string; color: string } {
  if (s.welcomeSentAt) return { label: 'Sent', color: 'bg-green-100 text-green-800' };
  if (s.welcomeError) return { label: `Failed ×${s.welcomeAttempts}`, color: 'bg-red-100 text-red-700' };
  return { label: 'Queued', color: 'bg-amber-100 text-amber-800' };
}

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {statCards.map((card) => (
            <div key={card.label} className="bg-surface rounded-xl border border-border p-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">{card.label}</p>
              <p className="font-display text-2xl font-bold mt-1">{card.value}</p>
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
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Welcome</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Code</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((s) => {
                  const welcome = welcomeState(s);
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors">
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
                        <Badge className={welcome.color}>{welcome.label}</Badge>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
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
