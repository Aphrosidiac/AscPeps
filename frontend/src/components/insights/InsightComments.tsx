'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import type { InsightComment } from '@/types';
import { postInsightComment, deleteInsightComment, getInsightComments } from '@/lib/api';
import { useMemberSession } from '@/lib/member-session';
import { formatShortDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

const MAX_LENGTH = 2000;

/**
 * The article's comment section.
 *
 * A client component that is nonetheless handed its comments as a prop from
 * the server: App Router still renders client components to HTML on the
 * server, so the discussion is present in the crawled markup rather than
 * appearing only after hydration. Interactivity (who you are, posting,
 * deleting) is layered on afterwards.
 */
export function InsightComments({
  slug,
  initialComments,
}: {
  slug: string;
  initialComments: InsightComment[];
}) {
  const pathname = usePathname();
  const { member, token, ready } = useMemberSession();

  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The page's cached server render can be up to an hour old for a reader who
  // arrives between revalidations. Re-fetching once on mount costs one request
  // and keeps a live visitor from seeing a stale thread.
  useEffect(() => {
    let cancelled = false;
    getInsightComments(slug)
      .then(({ data }) => {
        if (!cancelled) setComments(data);
      })
      .catch(() => {
        // Keep the server-rendered copy — a failed refresh is not worth an error.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSubmitting(true);
    setError('');

    try {
      const created = await postInsightComment(token, slug, body.trim());
      // Appended, not prepended — the thread reads oldest-first.
      setComments((prev) => (prev.some((c) => c.id === created.id) ? prev : [...prev, created]));
      setBody('');
    } catch (err) {
      const response = (err as { response?: { status?: number; data?: { message?: string; error?: string } } })?.response;
      setError(
        response?.data?.message ||
          response?.data?.error ||
          (response?.status === 429
            ? 'You are posting too quickly. Please wait a moment.'
            : 'Could not post that comment. Please try again.')
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== id));
    try {
      await deleteInsightComment(token, id);
    } catch {
      setComments(previous);
      setError('Could not delete that comment.');
    }
  };

  const signInHref = `/account/login?next=${encodeURIComponent(pathname)}`;

  return (
    <section className="mt-12 pt-8 border-t border-border">
      <h2 className="font-display text-lg font-bold mb-1">
        Discussion
        {comments.length > 0 && <span className="text-text-muted font-normal"> ({comments.length})</span>}
      </h2>
      <p className="text-xs text-text-muted leading-relaxed mb-6">
        Comments are from readers and do not represent ASCEND. Nothing posted here is medical advice — all
        products are supplied for laboratory research use only.
      </p>

      {comments.length > 0 && (
        <ul className="space-y-5 mb-8">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-xs shrink-0">
                {comment.member.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{comment.member.displayName}</span>
                  <span className="text-text-muted text-xs ml-2">{formatShortDate(comment.createdAt)}</span>
                </p>
                <p className="text-[15px] leading-relaxed text-text-secondary whitespace-pre-line mt-1 break-words">
                  {comment.body}
                </p>
              </div>
              {member?.id === comment.memberId && (
                <button
                  type="button"
                  onClick={() => handleDelete(comment.id)}
                  aria-label="Delete your comment"
                  className="text-text-muted hover:text-danger transition-colors shrink-0 h-fit p-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* `ready` gates this so a signed-in reader never sees a flash of the
          sign-in prompt while localStorage is still being read. */}
      {!ready ? (
        <div className="h-24" aria-hidden />
      ) : !member ? (
        <div className="bg-surface-elevated border border-border rounded-xl p-5 text-center">
          <p className="text-sm text-text-secondary mb-3">Sign in to join the discussion.</p>
          <div className="flex items-center justify-center gap-2">
            <Link href={signInHref}>
              <Button size="sm">Sign in</Button>
            </Link>
            <Link href={`/account/register?next=${encodeURIComponent(pathname)}`}>
              <Button size="sm" variant="outline">Create account</Button>
            </Link>
          </div>
        </div>
      ) : !member.emailVerified ? (
        <div className="bg-surface-elevated border border-border rounded-xl p-5 text-center">
          <p className="text-sm text-text-secondary mb-3">
            Confirm your email address to post. Check your inbox for the link.
          </p>
          <Link href="/account">
            <Button size="sm" variant="outline">Resend confirmation</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={MAX_LENGTH}
            rows={4}
            placeholder={`Add a comment as ${member.displayName}…`}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted text-[15px] leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            required
          />
          {error && <p className="text-sm text-danger mt-2">{error}</p>}
          <div className="flex items-center justify-between gap-3 mt-3">
            <p className="text-xs text-text-muted">
              {body.length > MAX_LENGTH - 200 && `${MAX_LENGTH - body.length} characters left`}
            </p>
            <Button type="submit" size="sm" disabled={submitting || body.trim().length < 2}>
              {submitting ? 'Posting…' : 'Post comment'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
