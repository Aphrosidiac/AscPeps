'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Paperclip,
  Presentation, Send, ShieldAlert, ShieldCheck, Undo2, Wrench, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';
import { mediaUrl, openMedia, sentFileOf, type Action, type Attachment, type Message, type SentFile, type ToolResult } from '@/lib/assistant';
import { inputSummary, pretty, timeOf } from './format';

// The transcript: everything the server stored, plus the turn in flight.
// Operator messages on the right; the assistant's prose, and each tool call
// as a card that fills in when its result lands; a destructive call waiting
// on the operator gets the exact thing it would do and two buttons; a done
// write gets an Undo inside its card.

export interface LiveTurn {
  text: string;
  reasoning: string;
  tools: Map<string, { name: string; input: unknown; done: boolean; ok: boolean; ms: number; preview: string }>;
}

const TIER_CLS: Record<string, string> = {
  read: 'text-text-secondary',
  write: 'bg-amber-50 text-amber-700',
  destructive: 'bg-red-50 text-danger',
};

export function Transcript({
  token,
  messages,
  actions,
  live,
  running,
  acting,
  readOnly,
  onDecide,
}: {
  token: string;
  messages: Message[];
  actions: Action[];
  live: LiveTurn | null;
  running: boolean;
  acting: string;
  readOnly: boolean;
  onDecide: (a: Action, verb: 'approve' | 'decline' | 'undo') => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const actionFor = useMemo(() => new Map(actions.filter((a) => a.callId).map((a) => [a.callId!, a])), [actions]);
  const resultFor = useMemo(() => {
    const map = new Map<string, ToolResult>();
    for (const m of messages) for (const r of m.content.toolResults ?? []) map.set(r.id, r);
    return map;
  }, [messages]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {messages.map((m) => {
        if (m.role === 'user') {
          const q = m.content.quoted;
          return (
            <div key={m.id} className="msg-in flex flex-col items-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-[22px] text-white">
                {q && (
                  <div className="mb-2 rounded-[10px] border-l-[3px] border-white/60 bg-white/10 px-3 py-1.5 text-[13px] leading-[18px]">
                    <p className="font-medium text-white/90">{q.from === 'you' ? 'Abby' : q.from}</p>
                    {q.text && <p className="whitespace-pre-wrap text-white/80">{q.text}</p>}
                    {q.attachments?.map((a, i) => (
                      <AttachmentCard key={i} a={a} tone="quoted" token={token} />
                    ))}
                  </div>
                )}
                {m.content.text && <p className="whitespace-pre-wrap">{m.content.text}</p>}
                {m.content.attachments?.map((a, i) => (
                  <AttachmentCard key={i} a={a} tone="own" token={token} />
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">
                {m.content.sender ?? m.actorName ?? 'You'} · {timeOf(m.createdAt)}
              </p>
            </div>
          );
        }
        if (m.role === 'system') {
          if (m.content.error) {
            return (
              <p
                key={m.id}
                className="msg-in mx-auto max-w-lg rounded-[10px] border border-danger/30 bg-red-50/60 px-3 py-2 text-center text-[13px] leading-[18px] text-danger"
              >
                {m.content.text}
              </p>
            );
          }
          if (m.content.transient) return null;
          if (m.content.replaces) {
            if (m.content.summary === '(superseded)') return null;
            return (
              <details key={m.id} className="group text-[13px] leading-[18px] text-text-secondary">
                <summary className="flex cursor-pointer list-none select-none items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" strokeWidth={1.75} />
                  Earlier in this conversation, summarised for the assistant
                </summary>
                <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3">{m.content.summary}</p>
              </details>
            );
          }
          return (
            <p key={m.id} className="msg-in text-center text-[12px] leading-4 text-text-secondary">
              {m.content.text}
            </p>
          );
        }
        if (m.role !== 'assistant') return null;
        const c = m.content;
        return (
          <div key={m.id} className={cn('msg-in space-y-2', c.retracted && 'opacity-60')}>
            {c.reasoning && (
              <details className="group text-[13px] leading-[18px] text-text-secondary">
                <summary className="flex cursor-pointer list-none select-none items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" strokeWidth={1.75} /> Thinking
                </summary>
                <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 italic">{c.reasoning}</p>
              </details>
            )}
            {c.text &&
              (c.retracted ? (
                <details className="group text-[13px] leading-[18px] text-text-secondary">
                  <summary className="flex cursor-pointer list-none select-none items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" strokeWidth={1.75} />A draft the guard sent back — it stated
                    something no tool result supported
                  </summary>
                  <div
                    className="prose-assistant mt-1 border-l-2 border-border pl-3 text-[14px] leading-5 line-through decoration-text-muted"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(c.text) }}
                  />
                </details>
              ) : (
                <div className="prose-assistant text-[15px] leading-[22px] text-text-primary" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.text) }} />
              ))}
            {c.guard && !c.retracted && <GuardBadge guard={c.guard} />}
            {(c.toolCalls ?? []).map((call, i) => {
              const action = actionFor.get(call.id);
              const result = resultFor.get(call.id);
              const liveTool = live?.tools.get(call.id);
              const isOpen = expanded.has(call.id);
              const pending = action?.status === 'pending';
              // A file the assistant sent: from the result row, or — for a
              // forward that waited for approval — from the action's output.
              const sentFile = call.name === 'send_file' || call.name === 'forward_file' ? sentFileOf(result && !result.isError ? result.output : action?.status === 'done' ? action.output : null) : null;
              return (
                <div key={call.id} className="space-y-2">
                <div
                  // Cards from one step arrive together; a short stagger keeps
                  // them readable as a sequence. A pending one rings once.
                  style={{ animationDelay: `${Math.min(i * 40, 200)}ms` }}
                  className={cn(
                    'msg-in rounded-[10px] border bg-surface text-[13px] leading-[18px] transition-colors duration-200',
                    pending ? 'attention-ring border-danger/40' : 'border-border'
                  )}
                >
                  <button
                    className={cn(
                      'press flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-elevated/60',
                      isOpen || pending ? 'rounded-t-[10px]' : 'rounded-[10px]'
                    )}
                    onClick={() => toggle(call.id)}
                  >
                    {action?.tier === 'destructive' ? (
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-danger" strokeWidth={1.75} />
                    ) : (
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={1.75} />
                    )}
                    <span className="font-medium text-text-primary">{call.name}</span>
                    {action && action.tier !== 'read' && (
                      <span className={cn('rounded-full px-1.5 text-[11px] font-medium uppercase tracking-wide', TIER_CLS[action.tier])}>{action.tier}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{action?.summary || inputSummary(call.input)}</span>
                    {pending ? (
                      <span key="pending" className="fade-in shrink-0 text-danger">
                        needs your approval
                      </span>
                    ) : action?.status === 'declined' ? (
                      <span key="declined" className="fade-in shrink-0 text-text-secondary">
                        declined
                      </span>
                    ) : action?.status === 'expired' ? (
                      <span key="expired" className="fade-in shrink-0 text-text-secondary">
                        expired
                      </span>
                    ) : action?.status === 'undone' ? (
                      <span key="undone" className="fade-in shrink-0 text-text-secondary">
                        undone
                      </span>
                    ) : result ? (
                      <span key="result" className={cn('fade-in shrink-0', result.isError ? 'text-danger' : 'text-text-secondary')}>
                        {result.isError ? 'error' : 'ok'} · <span className="tabular-nums">{result.ms}</span> ms
                      </span>
                    ) : liveTool && !liveTool.done ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" strokeWidth={2} />
                    ) : null}
                    <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-text-muted transition-transform', isOpen && 'rotate-180')} strokeWidth={1.75} />
                  </button>

                  {pending && action && (
                    <div className="msg-in border-t border-danger/20 bg-red-50/40 px-3 py-3">
                      <p className="text-[14px] font-medium leading-5 text-text-primary">{action.summary}</p>
                      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface px-3 py-2 text-[12px] leading-4 text-text-primary">
                        {pretty(call.input)}
                      </pre>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          disabled={running || acting === action.id}
                          onClick={() => onDecide(action, 'approve')}
                          className="press inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-light disabled:opacity-50"
                        >
                          {acting === action.id ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Check className="h-4 w-4" strokeWidth={2} />}{' '}
                          Approve
                        </button>
                        <button
                          disabled={running || acting === action.id}
                          onClick={() => onDecide(action, 'decline')}
                          className="press inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
                        >
                          Decline
                        </button>
                        {running && <span className="text-[12px] leading-4 text-text-secondary">Wait for the assistant to finish its turn.</span>}
                        {readOnly && !running && (
                          <span className="text-[12px] leading-4 text-text-secondary">
                            Asked over WhatsApp — the operator can also reply “yes” or “no” there.
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className={cn('reveal', isOpen && 'is-open')} aria-hidden={!isOpen}>
                    <div>
                      <div className="border-t border-border px-3 py-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Input</p>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[12px] leading-4 text-text-primary">{pretty(call.input)}</pre>
                        {result && (
                          <>
                            <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Result</p>
                            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-4 text-text-primary">
                              {pretty(result.output)}
                            </pre>
                          </>
                        )}
                        {action?.status === 'done' && action.output !== undefined && !result && (
                          <>
                            <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Result (after approval)</p>
                            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-4 text-text-primary">
                              {pretty(action.output)}
                            </pre>
                          </>
                        )}
                        {action?.actorName && action.tier !== 'read' && (
                          <p className="mt-2 text-[12px] leading-4 text-text-secondary">
                            {action.status === 'pending' ? 'Asked' : action.status === 'declined' ? 'Declined' : action.status === 'undone' ? 'Undone' : 'Done'}{' '}
                            · {action.actorName}
                          </p>
                        )}
                        {action?.undoable && (
                          <button
                            disabled={acting === action.id}
                            onClick={() => onDecide(action, 'undo')}
                            className="press mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
                          >
                            {acting === action.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                            ) : (
                              <Undo2 className="h-4 w-4" strokeWidth={1.75} />
                            )}{' '}
                            Undo this change
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {sentFile && <SentFileCard file={sentFile} token={token} />}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* In flight */}
      {live && (live.text || live.reasoning || live.tools.size > 0) ? (
        <div className="space-y-2">
          {live.reasoning && !live.text && (
            <details className="group text-[13px] leading-[18px] text-text-secondary" open>
              <summary className="flex cursor-pointer list-none select-none items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> Thinking
              </summary>
              <p className="mt-1 max-h-40 overflow-hidden whitespace-pre-wrap border-l-2 border-border pl-3 italic">{live.reasoning.slice(-1200)}</p>
            </details>
          )}
          {live.text && (
            <div
              className="prose-assistant stream-caret text-[15px] leading-[22px] text-text-primary"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }}
            />
          )}
          {[...live.tools.entries()].map(([id, t]) => (
            <div key={id} className="msg-in flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 text-[13px] leading-[18px]">
              {!t.done ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" strokeWidth={2} />
              ) : (
                <Wrench className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.75} />
              )}
              <span className="font-medium text-text-primary">{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-text-secondary">{inputSummary(t.input)}</span>
              {t.done && (
                <span className={cn('fade-in', t.ok ? 'text-text-secondary' : 'text-danger')}>
                  {t.ok ? 'ok' : 'error'} · <span className="tabular-nums">{t.ms}</span> ms
                </span>
              )}
            </div>
          ))}
        </div>
      ) : running ? (
        <TypingDots />
      ) : null}
    </div>
  );
}

// The assistant is working and has not said anything yet: three dots, the
// way every messenger says it, instead of a spinner and a word.
function TypingDots() {
  return (
    <p className="msg-in flex h-6 items-center gap-1 px-1" aria-label="The assistant is working" role="status">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-secondary" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-secondary" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-text-secondary" />
    </p>
  );
}

// What the guards did to this reply. A repaired reply is the good outcome:
// the guard turned an unsupported answer into a checked one.
function GuardBadge({ guard }: { guard: NonNullable<Message['content']['guard']> }) {
  const copy =
    guard.kind === 'write'
      ? 'The draft claimed a change no tool had made; replaced.'
      : guard.outcome === 'repaired'
        ? 'Checked: the first draft stated something unsupported, so it re-read the data before answering.'
        : guard.outcome === 'shadow'
          ? `Grounding check (shadow): ${guard.violations} unsupported detail${guard.violations === 1 ? '' : 's'} noted, reply delivered as written.`
          : 'The draft could not be grounded in the data after two tries; replaced with a refusal.';
  const Icon = guard.outcome === 'repaired' ? ShieldCheck : guard.outcome === 'shadow' ? Sparkles : ShieldAlert;
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4',
        guard.outcome === 'repaired' ? 'bg-surface-elevated text-text-secondary' : 'bg-amber-50 text-amber-800'
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} /> {copy}
    </p>
  );
}

// ---------------------------------------------------------------- files

const METHOD_LABEL: Record<string, string> = {
  'pdf-text': 'read',
  'pdf-ocr': 'read by OCR',
  vision: 'transcribed',
  docx: 'read',
  sheet: 'read',
  pptx: 'read',
  text: 'read',
};

// One icon per kind of file, picked from the type or the name's extension.
function FileIcon({ mime, name, fallback, className }: { mime?: string; name?: string; fallback?: 'image' | 'clip'; className: string }) {
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  if (!mime && !name) return fallback === 'image' ? <ImageIcon className={className} strokeWidth={1.75} /> : <Paperclip className={className} strokeWidth={1.75} />;
  if (mime?.startsWith('image/')) return <ImageIcon className={className} strokeWidth={1.75} />;
  if (/sheet|excel|csv|opendocument\.spreadsheet/.test(mime ?? '') || ['xlsx', 'xls', 'csv', 'ods', 'tsv'].includes(ext)) {
    return <FileSpreadsheet className={className} strokeWidth={1.75} />;
  }
  if (/presentation/.test(mime ?? '') || ext === 'pptx') return <Presentation className={className} strokeWidth={1.75} />;
  return <FileText className={className} strokeWidth={1.75} />;
}

function fileSize(bytes?: number) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function typeLabel(mime?: string, name?: string) {
  if (mime === 'application/pdf') return 'PDF';
  if (mime?.startsWith('image/')) return 'Picture';
  const ext = (name ?? '').split('.').pop()?.toUpperCase();
  return ext && ext.length <= 5 ? ext : 'File';
}

// A stored picture, fetched with the admin token into a blob URL.
function Thumb({ token, mediaId, alt, onOpen }: { token: string; mediaId: string; alt: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    mediaUrl(token, mediaId)
      .then((u) => live && setUrl(u))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [token, mediaId]);
  if (failed) return null;
  return (
    <button type="button" onClick={onOpen} className="press mt-1.5 block overflow-hidden rounded-[10px] bg-black/10" aria-label={`Open ${alt}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="block max-h-56 w-auto max-w-full object-contain" />
      ) : (
        <span className="block h-32 w-48 animate-pulse" />
      )}
    </button>
  );
}

// A file in an operator's message (own) or in the message they replied to
// (quoted): what it is, an Open button, and — folded — exactly what the
// assistant read from it, since that is what it acted on.
function AttachmentCard({ a, tone, token }: { a: Attachment; tone: 'own' | 'quoted'; token: string }) {
  const [opening, setOpening] = useState(false);
  const isImage = a.kind === 'image';
  const label = a.name ?? (isImage ? 'Picture' : a.kind[0].toUpperCase() + a.kind.slice(1));
  const open = () => {
    if (!a.mediaId) return;
    setOpening(true);
    openMedia(token, a.mediaId, a.name ?? 'file', a.mimeType)
      .catch(() => undefined)
      .finally(() => setOpening(false));
  };
  const meta = [
    a.mediaId ? typeLabel(a.mimeType, a.name) : null,
    a.pages ? `${a.pages} ${a.method === 'sheet' ? 'sheet' : a.method === 'pptx' ? 'slide' : 'page'}${a.pages === 1 ? '' : 's'}` : null,
    fileSize(a.sizeBytes) || null,
    a.text ? METHOD_LABEL[a.method ?? ''] ?? 'read' : a.unreadable ? 'not read' : null,
  ].filter(Boolean);

  return (
    <div className="mt-1.5">
      {isImage && a.mediaId && <Thumb token={token} mediaId={a.mediaId} alt={label} onOpen={open} />}
      <div className={cn('mt-1.5 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2', tone === 'own' ? 'bg-white/12' : 'bg-white/8')}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15">
          <FileIcon mime={a.mimeType} name={a.name} fallback={isImage ? 'image' : 'clip'} className="h-4 w-4 text-white" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-[18px] text-white">{label}</span>
          {meta.length > 0 && <span className="block truncate text-[12px] leading-4 text-white/70">{meta.join(' · ')}</span>}
        </span>
        {a.mediaId && (
          <button
            type="button"
            onClick={open}
            disabled={opening}
            className="press inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-white/15 px-2 text-[12px] font-medium text-white hover:bg-white/25 disabled:opacity-60"
          >
            {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />}
            Open
          </button>
        )}
      </div>
      {a.unreadable && (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-4 text-white/80">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={1.75} /> Couldn’t read it: {a.unreadable}
        </p>
      )}
      {a.text && (
        <details className="group mt-1">
          <summary className="inline-flex cursor-pointer list-none select-none items-center gap-1 text-[12px] leading-4 text-white/80 hover:text-white">
            What Abby read{a.truncated ? ` · first ${a.text.length.toLocaleString()} of ${a.totalChars?.toLocaleString()} characters` : ''}
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" strokeWidth={1.75} />
          </summary>
          <pre className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap rounded-[10px] bg-black/20 px-3 py-2 font-sans text-[13px] leading-[18px] text-white/90">{a.text}</pre>
        </details>
      )}
    </div>
  );
}

// A file the assistant sent — where it went, and a way to open it here.
function SentFileCard({ file, token }: { file: SentFile; token: string }) {
  const [opening, setOpening] = useState(false);
  const isImage = file.sentAs === 'image';
  const open = () => {
    setOpening(true);
    openMedia(token, file.mediaId, file.fileName, isImage ? 'image/jpeg' : file.fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined)
      .catch(() => undefined)
      .finally(() => setOpening(false));
  };
  return (
    <div className="msg-in w-full max-w-sm rounded-[12px] border border-border bg-surface p-2.5">
      {isImage && <ThumbLight token={token} mediaId={file.mediaId} alt={file.fileName} onOpen={open} />}
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-elevated">
          <FileIcon mime={isImage ? 'image/jpeg' : undefined} name={file.fileName} className="h-4 w-4 text-text-primary" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-[18px] text-text-primary">{file.fileName}</span>
          <span className="flex items-center gap-1 truncate text-[12px] leading-4 text-text-secondary">
            <Send className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            {file.deliveredTo === 'the dashboard' ? 'Here' : file.deliveredTo} · {fileSize(file.sizeKb * 1024)}
          </span>
        </span>
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-60"
        >
          {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />}
          Open
        </button>
      </div>
    </div>
  );
}

function ThumbLight({ token, mediaId, alt, onOpen }: { token: string; mediaId: string; alt: string; onOpen: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    mediaUrl(token, mediaId)
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token, mediaId]);
  return (
    <button type="button" onClick={onOpen} className="press mb-2 block w-full overflow-hidden rounded-[8px] bg-surface-elevated" aria-label={`Open ${alt}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="mx-auto block max-h-64 w-auto max-w-full object-contain" />
      ) : (
        <span className="block h-40 w-full animate-pulse" />
      )}
    </button>
  );
}
