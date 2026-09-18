'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, FileText, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deleteMemory, errorMessage, listMemory, readMemory, saveMemory, type MemoryFile } from '@/lib/assistant';
import { ago } from './format';

// What the assistant remembers, readable and editable: a directory of short
// files. core/ goes into every conversation in full; the rest is read on
// demand. Nothing it knows about how to work with you is hidden from you,
// and a wrong line is fixed here rather than argued with in chat.

const CORE_CAP = 8000;

type Open = { path: string; content: string; updatedBy: string; updatedAt: string | null; dirty: boolean; isNew: boolean };

function folderOf(path: string): string {
  const i = path.indexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

const FOLDER_COPY: Record<string, string> = {
  core: 'In every conversation, in full',
  clients: 'Read when a client comes up',
  suppliers: 'Read when a supplier comes up',
  procedures: 'Read before repeating a job',
  '': 'Loose files',
};

export function MemoryPanel({ token, onClose, onNotice }: { token: string; onClose: () => void; onNotice: (kind: 'ok' | 'bad', text: string) => void }) {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [open, setOpen] = useState<Open | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    listMemory(token)
      .then(setFiles)
      .catch((e) => onNotice('bad', errorMessage(e)));
  }, [token, onNotice]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const order = ['core', 'clients', 'suppliers', 'procedures', ''];
    const by = new Map<string, MemoryFile[]>();
    for (const f of files) {
      const k = folderOf(f.path);
      by.set(k, [...(by.get(k) ?? []), f]);
    }
    const keys = [...by.keys()].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    return keys.map((k) => ({ folder: k, files: by.get(k)! }));
  }, [files]);
  const coreChars = files.filter((f) => f.path.startsWith('core/')).reduce((n, f) => n + f.chars, 0);

  const view = (f: MemoryFile) => {
    readMemory(token, f.path)
      .then((r) => setOpen({ path: r.path, content: r.content, updatedBy: r.updatedBy, updatedAt: r.updatedAt, dirty: false, isNew: false }))
      .catch((e) => onNotice('bad', errorMessage(e)));
  };

  const save = () => {
    if (!open) return;
    setBusy('save');
    saveMemory(token, open.path, open.content)
      .then(() => {
        setOpen({ ...open, dirty: false, isNew: false });
        onNotice('ok', 'Saved');
        load();
      })
      .catch((e) => onNotice('bad', errorMessage(e)))
      .finally(() => setBusy(''));
  };

  const remove = () => {
    if (!open || open.isNew || !confirm(`Forget ${open.path}?`)) return;
    setBusy('delete');
    deleteMemory(token, open.path)
      .then(() => {
        setOpen(null);
        load();
      })
      .catch((e) => onNotice('bad', errorMessage(e)))
      .finally(() => setBusy(''));
  };

  const createFile = () => {
    const p = newPath
      .trim()
      .replace(/^\/?memories\//, '')
      .replace(/^\/+/, '');
    if (!p) return;
    setOpen({ path: p.endsWith('.md') ? p : `${p}.md`, content: '', updatedBy: '', updatedAt: null, dirty: true, isNew: true });
    setCreating(false);
    setNewPath('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        {(open || creating) && (
          <button
            onClick={() => (open ? setOpen(null) : setCreating(false))}
            aria-label="Back"
            className="press grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
          </button>
        )}
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-5 text-text-primary">{open ? open.path : creating ? 'New file' : 'Memory'}</p>
        {!open && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="press inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium text-text-primary hover:bg-surface-elevated"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} /> New
          </button>
        )}
        {open && (
          <>
            <button
              disabled={!open.dirty || busy !== ''}
              onClick={save}
              className="press inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-light disabled:opacity-50"
            >
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Save className="h-4 w-4" strokeWidth={1.75} />} Save
            </button>
            {!open.isNew && (
              <button
                onClick={remove}
                disabled={busy !== ''}
                aria-label="Forget this file"
                className="press grid h-9 w-9 place-items-center rounded-lg text-text-muted hover:bg-red-50 hover:text-danger disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </>
        )}
        <button
          onClick={onClose}
          aria-label="Close"
          className="press grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>

      {open ? (
        <div key={open.path} className="view-in flex min-h-0 flex-1 flex-col p-4">
          <textarea
            value={open.content}
            onChange={(e) => setOpen({ ...open, content: e.target.value, dirty: true })}
            spellCheck={false}
            autoFocus
            className="min-h-0 flex-1 resize-none rounded-[6px] border border-border bg-surface px-3 py-2 font-mono text-[13px] leading-[18px] text-text-primary focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <p className="mt-2 text-[12px] leading-4 text-text-secondary">
            <span className="tabular-nums">{open.content.length}</span> chars
            {open.path.startsWith('core/') ? (
              <>
                {' '}
                · core/ is read into every conversation and capped at {CORE_CAP} in total (
                <span className={cn('tabular-nums', coreChars > CORE_CAP && 'text-danger')}>{coreChars}</span> now)
              </>
            ) : (
              ' · read on demand, not in the prompt'
            )}
            {open.updatedAt ? ` · last by ${open.updatedBy}, ${ago(open.updatedAt)}` : ''}
          </p>
        </div>
      ) : creating ? (
        <div className="view-in space-y-3 p-4">
          <label className="block text-[14px] font-medium text-text-primary" htmlFor="memory-new-path">
            Path under /memories
          </label>
          <input
            id="memory-new-path"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createFile()}
            placeholder="clients/nurul.md"
            autoFocus
            className="h-[38px] w-full rounded-[6px] border border-border bg-surface px-3 text-[15px] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
          />
          <p className="text-[13px] leading-[18px] text-text-secondary">
            Letters, digits, - _ . and at most two folders. <code>core/</code> goes into every conversation; <code>clients/</code>, <code>suppliers/</code> and{' '}
            <code>procedures/</code> are read when relevant.
          </p>
          <div className="flex gap-2">
            <button
              disabled={!newPath.trim()}
              onClick={createFile}
              className="press inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-light disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              className="press inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="view-in min-h-0 flex-1 overflow-y-auto">
          {!files.length && (
            <p className="px-4 py-6 text-[13px] leading-[18px] text-text-secondary">
              Nothing remembered yet. It writes here when an operator tells it something durable — how something is done, who handles what, what it learned
              about a client — never anything read out of an order or a customer’s text. The nightly reflection tidies it.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.folder || '(root)'}>
              <div className="flex items-baseline justify-between border-b border-border/60 bg-surface-elevated/60 px-4 py-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">{g.folder ? `${g.folder}/` : 'files'}</span>
                <span className="text-[11px] text-text-muted">
                  {FOLDER_COPY[g.folder] ?? 'Read on demand'}
                  {g.folder === 'core' ? ` · ${coreChars}/${CORE_CAP}` : ''}
                </span>
              </div>
              {g.files.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => view(f)}
                  style={{ animationDelay: `${Math.min(i * 25, 200)}ms` }}
                  className="row-rise press flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
                >
                  <FileText className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.5} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] leading-5 text-text-primary">{f.path.slice(g.folder ? g.folder.length + 1 : 0)}</span>
                    <span className="block text-[12px] leading-4 text-text-secondary">
                      <span className="tabular-nums">{f.chars}</span> chars · {f.updatedBy === 'seed' ? 'seeded' : `by ${f.updatedBy}`} · {ago(f.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {files.length > 0 && (
            <p className="px-4 py-4 text-[12px] leading-4 text-text-secondary">
              Only what an operator said may be written here — the assistant refuses to store text it read out of an order, a customer or product data. Every
              write is undoable from its card in the transcript.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
