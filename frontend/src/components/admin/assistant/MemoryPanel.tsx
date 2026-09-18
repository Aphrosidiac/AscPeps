'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Save, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listMemory, saveMemory, errorMessage, type MemoryBlock } from '@/lib/assistant';
import { ago } from './format';

// What the assistant remembers, readable and editable. Four capped blocks,
// rendered into its prompt on every turn in every conversation — so nothing
// it believes about how this business runs is hidden from you, and a wrong
// line can be fixed here rather than argued with in chat.

export function MemoryPanel({ token, onClose, onNotice }: { token: string; onClose: () => void; onNotice: (kind: 'ok' | 'bad', text: string) => void }) {
  const [blocks, setBlocks] = useState<MemoryBlock[]>([]);
  const [open, setOpen] = useState<{ key: string; label: string; content: string; charLimit: number; dirty: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listMemory(token)
      .then(setBlocks)
      .catch((e) => onNotice('bad', errorMessage(e)));
  }, [token, onNotice]);

  useEffect(() => {
    load();
  }, [load]);

  const save = () => {
    if (!open) return;
    setBusy(true);
    saveMemory(token, open.key, open.content)
      .then((b) => {
        setOpen({ ...open, content: b.content, dirty: false });
        onNotice('ok', 'Saved');
        load();
      })
      .catch((e) => onNotice('bad', errorMessage(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        {open && (
          <button
            onClick={() => setOpen(null)}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:text-text-primary"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
        )}
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-5 text-text-primary">{open ? open.label : 'Memory'}</p>
        {open && (
          <button
            disabled={!open.dirty || busy}
            onClick={save}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-light disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Save className="h-4 w-4" strokeWidth={1.75} />} Save
          </button>
        )}
        <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:text-text-primary">
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>

      {open ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <textarea
            value={open.content}
            onChange={(e) => setOpen({ ...open, content: e.target.value, dirty: true })}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-[6px] border border-border bg-surface px-3 py-2 font-mono text-[13px] leading-[18px] text-text-primary focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <p className={cn('mt-2 text-[12px] leading-4', open.content.length > open.charLimit ? 'text-danger' : 'text-text-secondary')}>
            <span className="tabular-nums">{open.content.length}</span> / {open.charLimit} characters · one fact per line. The assistant reads this in every
            conversation, so keep it to what is still true.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {blocks.map((b) => (
            <button
              key={b.key}
              onClick={() => setOpen({ key: b.key, label: b.label, content: b.content, charLimit: b.charLimit, dirty: false })}
              className="flex w-full flex-col gap-1 border-b border-border/60 px-4 py-3 text-left hover:bg-surface-elevated"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[14px] font-medium leading-5 text-text-primary">{b.label}</span>
                <span className="text-[12px] leading-4 text-text-secondary">
                  <span className="tabular-nums">{b.content.length}</span>/{b.charLimit}
                </span>
              </span>
              <span className="line-clamp-2 text-[13px] leading-[18px] text-text-secondary">{b.content.trim() || 'Nothing recorded yet.'}</span>
              <span className="text-[11px] leading-4 text-text-muted">
                {b.updatedBy === 'seed' ? 'never written' : `by ${b.updatedBy} · ${ago(b.updatedAt)}`}
              </span>
            </button>
          ))}
          <p className="px-4 py-4 text-[12px] leading-4 text-text-secondary">
            It writes here when an operator tells it something durable — how something is done, who handles what, a supplier arrangement, a decision. Never
            anything read out of an order or a customer’s text. The nightly reflection tidies it.
          </p>
        </div>
      )}
    </div>
  );
}
