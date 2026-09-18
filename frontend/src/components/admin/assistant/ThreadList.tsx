'use client';

import Link from 'next/link';
import { Loader2, MessageSquare, MoonStar, Plus, Sunrise, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePresence } from '@/hooks/usePresence';
import type { Thread } from '@/lib/assistant';
import { ago, money } from './format';

// Every conversation the assistant has had, newest first — the dashboard's,
// the WhatsApp operators', and the two scheduled jobs' — with what each one
// cost. A row with a red count has something waiting for a decision.

const KIND_ICON = {
  whatsapp: MessageSquare,
  reflect: MoonStar,
  digest: Sunrise,
} as const;

const KIND_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  reflect: 'Nightly reflection',
  digest: 'Morning brief',
};

export function ThreadList({
  threads,
  activeId,
  open,
  onClose,
  onNew,
  onDelete,
}: {
  threads: Thread[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onDelete: (t: Thread) => void;
}) {
  // On a phone the list is a drawer that slides in and — kept mounted for the
  // exit — slides back out. From lg it is a static column and the drawer
  // classes are inert.
  const drawer = usePresence(open, 160);
  return (
    <>
      <aside
        className={cn(
          'absolute inset-y-0 left-0 z-20 flex w-72 shrink-0 flex-col border-r border-border bg-surface lg:static lg:translate-x-0 lg:animate-none!',
          drawer.mounted ? 'drawer-panel' : '-translate-x-full',
          drawer.closing && 'is-closing'
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <p className="text-[12px] font-medium uppercase tracking-wide text-text-secondary">Conversations</p>
          <div className="flex items-center gap-1">
            <button
              onClick={onNew}
              className="press inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium text-text-primary hover:bg-surface-elevated"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} /> New
            </button>
            <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary lg:hidden">
              <X className="h-5 w-5" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!threads.length && <p className="px-4 py-6 text-[13px] leading-[18px] text-text-secondary">Nothing yet. Ask it what needs your attention.</p>}
          {threads.map((t, i) => {
            const Icon = KIND_ICON[t.kind as keyof typeof KIND_ICON];
            const active = t.id === activeId;
            return (
              <Link
                key={t.id}
                href={`/admin/assistant/${t.id}`}
                onClick={onClose}
                // Rows cascade in on first paint, capped so a long list never
                // leaves the last one arriving noticeably late. A new thread
                // inserted at the top plays the same rise on its own.
                style={{ animationDelay: `${Math.min(i * 25, 250)}ms` }}
                className={cn(
                  'row-rise group flex items-start gap-2 border-b border-border/60 px-4 py-3 transition-colors duration-150 hover:bg-surface-elevated',
                  active && 'bg-surface-elevated'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className={cn('flex items-center gap-1.5 text-[14px] leading-5', active ? 'font-medium text-text-primary' : 'text-text-primary')}>
                    {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.5} aria-label={KIND_LABEL[t.kind]} />}
                    <span className="truncate">{t.title}</span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] leading-4 text-text-secondary">
                    {t.running && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                    <span>
                      {ago(t.lastMessageAt)} · {money(t.costUsd)}
                    </span>
                    {t.pending > 0 && <span className="rounded-full bg-danger/10 px-1.5 text-[11px] font-medium text-danger">{t.pending} waiting</span>}
                  </p>
                </div>
                <button
                  aria-label="Delete conversation"
                  onClick={(e) => {
                    e.preventDefault();
                    onDelete(t);
                  }}
                  className="hidden shrink-0 rounded p-1 text-text-muted hover:text-danger group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </Link>
            );
          })}
        </div>
      </aside>
      {drawer.mounted && (
        <div className={cn('drawer-backdrop absolute inset-0 z-10 bg-black/30 lg:hidden', drawer.closing && 'is-closing')} onClick={onClose} />
      )}
    </>
  );
}
