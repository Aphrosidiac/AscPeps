'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Download, Search, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminBlockMember, adminExportMembers, adminGetMembers, apiError, type AdminMemberRow } from '@/lib/api';
import { cn, formatDate, formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/admin/ui';

const PAGE_SIZE = 50;

type Show = '' | 'confirmed' | 'unconfirmed' | 'bought';

const FILTERS: readonly (readonly [Show, string])[] = [
  ['', 'All'],
  ['confirmed', 'Confirmed'],
  ['unconfirmed', 'Not confirmed'],
  ['bought', 'Bought'],
];

type Listing = Awaited<ReturnType<typeof adminGetMembers>>;

/**
 * Who has an Ascend account. Not the newsletter list (Subscribers) and not a
 * customer list either: most orders are placed as a guest, so Orders here are
 * the paid ones placed with the account's email, whether or not they signed in.
 */
export default function AdminMembersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AdminMemberRow[]>([]);
  const [pagination, setPagination] = useState<Listing['pagination'] | null>(null);
  const [stats, setStats] = useState<Listing['stats'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('');
  const [page, setPage] = useState(1);

  const filters = useCallback(() => {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    if (show) params.show = show;
    return params;
  }, [search, show]);

  const load = useCallback(() => {
    if (!token) return;
    adminGetMembers(token, { ...filters(), page: String(page), limit: String(PAGE_SIZE) })
      .then((r) => {
        setRows(r.data);
        setPagination(r.pagination);
        setStats(r.stats);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [token, filters, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const onSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  // Blocks the account AND everything its orders carry (phones, delivery
  // addresses): see Blocked customers.
  const block = async (m: AdminMemberRow) => {
    if (!token) return;
    const reason = window.prompt(`Block ${m.displayName} (${m.email})?\n\nThis bans the account and blocks its email plus every phone and delivery address on its orders. Reason, for the team:`);
    if (reason === null) return;
    try {
      await adminBlockMember(token, m.id, reason || undefined);
      load();
    } catch (err) {
      window.alert(apiError(err).message);
    }
  };

  const onShow = (value: Show) => {
    setShow(value);
    setPage(1);
  };

  return (
    <div className="max-w-[1280px]">
      <PageHeader
        title="Members"
        icon={Users}
        subtitle={stats ? `${stats.everyone} account${stats.everyone !== 1 ? 's' : ''}, ${stats.confirmed} with a confirmed email` : 'People with an Ascend account'}
        actions={
          <Button variant="outline" onClick={() => token && adminExportMembers(token, filters()).catch(() => setFailed(true))}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        }
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by email or name..."
            aria-label="Search members"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap rounded-lg bg-surface-elevated p-1 text-sm w-fit max-w-full">
          {FILTERS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => onShow(value)}
              className={cn(
                'px-3 py-1 rounded-md cursor-pointer whitespace-nowrap',
                show === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {failed && <p className="text-sm text-red-700 mb-4">Couldn&apos;t reach the server. Try again.</p>}

      {loading ? (
        <div className="h-48 bg-surface-elevated rounded-xl" />
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-text-muted text-sm">
          {search || show ? 'Nobody matches.' : 'Nobody has made an account yet.'}
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="text-left px-3 sm:px-4 py-3 font-medium text-text-secondary">Member</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Email</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Sign-up bonus</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Orders</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">Signed up</th>
                <th className="px-3 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-3 sm:px-4 py-3 max-w-[220px] sm:max-w-none">
                    <p className="font-medium truncate">
                      {m.displayName}
                      {m.banned && <span className="ml-2 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-normal">Banned</span>}
                    </p>
                    <p className="text-text-secondary truncate">{m.email}</p>
                    <p className="text-xs text-text-muted mt-0.5 sm:hidden">{formatDate(m.createdAt)}</p>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {m.emailVerified ? (
                      <span className="rounded-full bg-green-100 text-green-800 px-2 py-0.5 text-xs">Confirmed</span>
                    ) : (
                      <span className="rounded-full bg-surface-elevated text-text-secondary px-2 py-0.5 text-xs">Not confirmed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap hidden lg:table-cell">
                    {m.signupBonusCode ? (
                      <>
                        <p>{m.signupBonusCode.usedCount > 0 ? 'Used' : 'Not used'}</p>
                        <p className="text-xs text-text-muted">{m.signupBonusCode.code}</p>
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">
                    {m.paidOrders > 0 ? (
                      <>
                        <p>{m.paidOrders}</p>
                        <p className="text-xs text-text-muted">{formatPrice(m.paidTotal)}</p>
                      </>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary whitespace-nowrap hidden sm:table-cell">{formatDate(m.createdAt)}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    {/* Shown for banned accounts too: a ban (from Comments) doesn't put
                        their email, phones or addresses on the blocklist. */}
                    <button
                      type="button"
                      onClick={() => block(m)}
                      className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated hover:text-danger cursor-pointer"
                    >
                      <Ban className="w-3.5 h-3.5" /> Block
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-text-muted">
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} member{pagination.total !== 1 ? 's' : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pagination.page <= 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-elevated text-text-secondary rounded-lg text-sm font-medium hover:text-text-primary disabled:opacity-50 disabled:cursor-default cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page >= pagination.totalPages}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-surface-elevated text-text-secondary rounded-lg text-sm font-medium hover:text-text-primary disabled:opacity-50 disabled:cursor-default cursor-pointer"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
