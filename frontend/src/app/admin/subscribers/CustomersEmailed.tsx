'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, UserMinus, MailCheck, MailX } from 'lucide-react';
import { adminGetContacts, adminUnsubscribeSubscriber, type ContactRow } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

type Filter = '' | 'SUBSCRIBED' | 'UNSUBSCRIBED';

const REASONS: Record<string, string> = {
  bounced: 'bounced',
  complained: 'marked as spam',
  admin: 'opted out by admin',
};

/**
 * "Sent but not subscribed": paid customers an All-customers campaign reached
 * without them ever signing up. They are not on the list and no list-wide
 * audience reaches them; every email they get still carries an unsubscribe
 * link and the one-click header, and opting out here or there keeps them out
 * of every later campaign.
 */
export function CustomersEmailed({ token }: { token: string | null }) {
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [stats, setStats] = useState<{ reachable: number; optedOut: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('');
  const [confirm, setConfirm] = useState<ContactRow | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (filter) params.status = filter;
    adminGetContacts(token, params)
      .then((r) => {
        setRows(r.data);
        setStats(r.stats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, search, filter]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const optOut = async (row: ContactRow) => {
    if (!token) return;
    await adminUnsubscribeSubscriber(token, row.id);
    setConfirm(null);
    load();
  };

  return (
    <div>
      <p className="text-sm text-text-secondary mb-4 max-w-2xl leading-relaxed">
        Paid customers who got an{' '}
        <span className="font-medium text-text-primary">All customers</span>{' '}
        campaign without ever signing up. They aren&apos;t on the list, and only All-customers campaigns reach them.
        Every email they get has an unsubscribe link, and once they opt out they stay out.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Reachable', value: stats?.reachable },
          { label: 'Opted out', value: stats?.optedOut },
        ].map((c) => (
          <div key={c.label} className="bg-surface rounded-xl border border-border p-4">
            <p className="text-xs text-text-muted uppercase tracking-wider">{c.label}</p>
            <p className="font-display text-2xl font-bold mt-1 tabular-nums">{c.value ?? '…'}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="flex rounded-lg bg-surface-elevated p-1 text-sm w-max">
          {([
            ['', 'All'],
            ['SUBSCRIBED', 'Reachable'],
            ['UNSUBSCRIBED', 'Opted out'],
          ] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'px-3 py-1 rounded-md cursor-pointer transition-colors',
                filter === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-surface-elevated rounded-xl animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-sm">
          {search || filter ? 'Nobody matches.' : 'No campaign has gone to customers outside the list yet.'}
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-text-secondary">Email</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Status</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Campaigns received</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">First emailed</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const reachable = r.status === 'SUBSCRIBED';
                const received = r.campaignRecipients.filter((c) => c.sentAt);
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-3 sm:px-4 py-3 max-w-[220px] sm:max-w-none">
                      <p className={cn('font-medium truncate', !reachable && 'text-text-muted')}>{r.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {reachable ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-800 px-2 py-0.5 text-xs">
                          <MailCheck className="w-3 h-3" /> Reachable
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-surface-elevated text-text-secondary px-2 py-0.5 text-xs"
                          title={r.unsubscribedAt ? `Opted out ${formatDate(r.unsubscribedAt)}` : undefined}
                        >
                          <MailX className="w-3 h-3" /> Opted out
                          {r.unsubscribeReason && REASONS[r.unsubscribeReason] ? ` · ${REASONS[r.unsubscribeReason]}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {received.length === 0 ? (
                        <span className="text-text-muted">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {received.map((c) => (
                            <Link
                              key={c.campaign.id}
                              href={`/admin/campaigns/${c.campaign.id}`}
                              className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary hover:border-border-hover"
                              title={c.campaign.name}
                            >
                              {c.campaign.subject}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary hidden lg:table-cell">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-center">
                      {reachable && (
                        <button
                          type="button"
                          onClick={() => setConfirm(r)}
                          className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer transition-colors"
                          title="Opt out of campaigns"
                        >
                          <UserMinus className="w-4 h-4 text-text-muted" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="dialog-backdrop absolute inset-0 bg-black/50" onClick={() => setConfirm(null)} />
          <div className="dialog-panel relative bg-surface rounded-xl border border-border p-6 max-w-sm w-full">
            <h2 className="font-display text-lg font-bold">Opt {confirm.email} out?</h2>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              No campaign will reach them again. Their order emails are not affected.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-border text-sm cursor-pointer hover:bg-surface-elevated"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => optOut(confirm)}
                className="flex-1 px-4 py-2 rounded-lg bg-text-primary text-surface text-sm font-medium cursor-pointer"
              >
                Opt out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
