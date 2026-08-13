'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetInsights, adminDeleteInsight } from '@/lib/api';
import { formatShortDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { Insight } from '@/types';

type StatusFilter = 'all' | 'published' | 'draft';

export default function AdminInsightsPage() {
  const { token } = useAuth();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = () => {
    if (!token) return;
    adminGetInsights(token, { limit: '100' })
      .then((r) => setInsights(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]);

  const displayed = insights
    .filter((i) => !search.trim() || i.title.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((i) => statusFilter === 'all' || (statusFilter === 'published' ? i.published : !i.published));

  const handleDelete = async (insight: Insight) => {
    if (!token || !confirm(`Delete "${insight.title}"? This can't be undone.`)) return;
    await adminDeleteInsight(token, insight.id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">Insights</h1>
        <Link href="/admin/insights/new"><Button><Plus className="w-4 h-4" /> New Insight</Button></Link>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="flex gap-1.5">
          {(['all', 'published', 'draft'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors cursor-pointer ${
                statusFilter === s ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-surface-elevated rounded" />)}
        </div>
      ) : insights.length === 0 ? (
        <p className="text-text-muted py-8 text-center">No insights yet — write the first one.</p>
      ) : displayed.length === 0 ? (
        <p className="text-text-muted py-8 text-center">No insights match the current filters.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="px-3 sm:px-4 py-3 text-left font-medium text-text-secondary">Title</th>
                {/* Category, author and date fold under the title on a phone —
                    six columns put Status and Actions off the right edge. */}
                <th className="px-4 py-3 text-left font-medium text-text-secondary hidden lg:table-cell">Category</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary hidden lg:table-cell">Author</th>
                <th className="px-2 sm:px-4 py-3 text-center font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary hidden md:table-cell">Date</th>
                <th className="text-center px-2 sm:px-4 py-3 font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((insight, rowIndex) => (
                <tr key={insight.id} style={{ animationDelay: `${Math.min(rowIndex * 30, 300)}ms` }} className="row-rise border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-3 sm:px-4 py-3 font-medium lg:max-w-xs lg:truncate">
                    {insight.title}
                    <span className="block lg:hidden text-xs font-normal text-text-muted mt-0.5">
                      {insight.category} · {insight.authorName}
                      <span className="md:hidden"> · {formatShortDate(insight.publishedAt ?? insight.createdAt)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs hidden lg:table-cell">{insight.category}</td>
                  <td className="px-4 py-3 text-text-secondary text-xs hidden lg:table-cell">{insight.authorName}</td>
                  <td className="px-2 sm:px-4 py-3 text-center">
                    <Badge className={insight.published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                      {insight.published ? 'Published' : 'Draft'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs hidden md:table-cell">
                    {formatShortDate(insight.publishedAt ?? insight.createdAt)}
                  </td>
                  <td className="px-2 sm:px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Link href={`/admin/insights/${insight.id}`} className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer inline-flex" title="Edit">
                        <Pencil className="w-4 h-4 text-text-muted" />
                      </Link>
                      <button onClick={() => handleDelete(insight)} className="p-1.5 hover:bg-red-50 rounded cursor-pointer" title="Delete">
                        <Trash2 className="w-4 h-4 text-text-muted hover:text-danger" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
