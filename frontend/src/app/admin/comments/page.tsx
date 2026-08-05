'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Trash2, Ban, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminListComments,
  adminSetCommentHidden,
  adminDeleteComment,
  adminSetMemberBanned,
} from '@/lib/api';
import { formatShortDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { AdminComment } from '@/types';

type Filter = 'all' | 'visible' | 'hidden';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
];

export default function AdminCommentsPage() {
  const { token } = useAuth();
  const [comments, setComments] = useState<AdminComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const load = () => {
    if (!token) return;
    const params: Record<string, string> = { limit: '100' };
    if (filter === 'visible') params.hidden = 'false';
    if (filter === 'hidden') params.hidden = 'true';

    setLoading(true);
    adminListComments(token, params)
      .then((r) => setComments(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token, filter]);

  const handleToggleHidden = async (comment: AdminComment) => {
    if (!token) return;
    await adminSetCommentHidden(token, comment.id, !comment.hidden);
    load();
  };

  const handleDelete = async (comment: AdminComment) => {
    if (!token || !confirm('Delete this comment permanently? Hiding it is reversible; this is not.')) return;
    await adminDeleteComment(token, comment.id);
    load();
  };

  const handleToggleBan = async (comment: AdminComment) => {
    if (!token) return;
    const { banned, displayName } = comment.member;
    const message = banned
      ? `Unban ${displayName}? They will be able to sign in and post again.`
      : `Ban ${displayName}? They keep their existing comments but can no longer sign in or post.`;
    if (!confirm(message)) return;

    await adminSetMemberBanned(token, comment.member.id, !banned);
    load();
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Comments</h1>
        <p className="text-sm text-text-muted mt-1">
          Reader comments on Insights articles. Hiding removes a comment from the site but keeps it here.
        </p>
      </div>

      <div className="flex gap-1.5 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              filter === f.value
                ? 'bg-primary text-white'
                : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-text-muted py-16 text-center">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-text-muted py-16 text-center">No comments yet.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`border border-border rounded-xl p-4 ${comment.hidden ? 'bg-surface-elevated opacity-70' : 'bg-surface'}`}
            >
              <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
                <span className="font-medium">{comment.member.displayName}</span>
                <span className="text-text-muted text-xs">{comment.member.email}</span>
                {comment.member.banned && <Badge className="bg-danger/10 text-danger">Banned</Badge>}
                {comment.hidden && <Badge className="bg-surface-elevated text-text-muted">Hidden</Badge>}
                <span className="text-text-muted text-xs ml-auto">{formatShortDate(comment.createdAt)}</span>
              </div>

              <p className="text-[15px] leading-relaxed text-text-secondary whitespace-pre-line break-words mb-3">
                {comment.body}
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/insights/${comment.insight.slug}`}
                  target="_blank"
                  className="text-xs text-text-muted hover:text-text-primary transition-colors inline-flex items-center gap-1 mr-auto"
                >
                  {comment.insight.title} <ExternalLink className="w-3 h-3" />
                </Link>

                <Button size="sm" variant="outline" onClick={() => handleToggleHidden(comment)}>
                  {comment.hidden ? <><Eye className="w-3.5 h-3.5" /> Unhide</> : <><EyeOff className="w-3.5 h-3.5" /> Hide</>}
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleToggleBan(comment)}>
                  <Ban className="w-3.5 h-3.5" /> {comment.member.banned ? 'Unban' : 'Ban'}
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(comment)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
