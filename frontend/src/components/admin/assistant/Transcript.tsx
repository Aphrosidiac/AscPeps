'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, ShieldAlert, ShieldCheck, Undo2, Wrench, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { renderMarkdown } from '@/lib/markdown';
import type { Action, Message, ToolResult } from '@/lib/assistant';
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
  messages,
  actions,
  live,
  running,
  acting,
  readOnly,
  onDecide,
}: {
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
          return (
            <div key={m.id} className="msg-in flex flex-col items-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-[22px] text-white">
                {m.content.text}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">
                {m.content.sender ?? m.actorName ?? 'You'} · {timeOf(m.createdAt)}
              </p>
            </div>
          );
        }
        if (m.role === 'system') {
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
            {(c.toolCalls ?? []).map((call) => {
              const action = actionFor.get(call.id);
              const result = resultFor.get(call.id);
              const liveTool = live?.tools.get(call.id);
              const isOpen = expanded.has(call.id);
              const pending = action?.status === 'pending';
              return (
                <div
                  key={call.id}
                  className={cn('rounded-[10px] border bg-surface text-[13px] leading-[18px]', pending ? 'border-danger/40' : 'border-border')}
                >
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => toggle(call.id)}>
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
                      <span className="shrink-0 text-danger">needs your approval</span>
                    ) : action?.status === 'declined' ? (
                      <span className="shrink-0 text-text-secondary">declined</span>
                    ) : action?.status === 'expired' ? (
                      <span className="shrink-0 text-text-secondary">expired</span>
                    ) : action?.status === 'undone' ? (
                      <span className="shrink-0 text-text-secondary">undone</span>
                    ) : result ? (
                      <span className={cn('shrink-0', result.isError ? 'text-danger' : 'text-text-secondary')}>
                        {result.isError ? 'error' : 'ok'} · <span className="tabular-nums">{result.ms}</span> ms
                      </span>
                    ) : liveTool && !liveTool.done ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" strokeWidth={2} />
                    ) : null}
                    <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-text-muted transition-transform', isOpen && 'rotate-180')} strokeWidth={1.75} />
                  </button>

                  {pending && action && (
                    <div className="border-t border-danger/20 bg-red-50/40 px-3 py-3">
                      <p className="text-[14px] font-medium leading-5 text-text-primary">{action.summary}</p>
                      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface px-3 py-2 text-[12px] leading-4 text-text-primary">
                        {pretty(call.input)}
                      </pre>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          disabled={running || acting === action.id}
                          onClick={() => onDecide(action, 'approve')}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-white hover:bg-primary-light disabled:opacity-50"
                        >
                          {acting === action.id ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Check className="h-4 w-4" strokeWidth={2} />}{' '}
                          Approve
                        </button>
                        <button
                          disabled={running || acting === action.id}
                          onClick={() => onDecide(action, 'decline')}
                          className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
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

                  {isOpen && (
                    <div className="border-t border-border px-3 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Input</p>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[12px] leading-4 text-text-primary">{pretty(call.input)}</pre>
                      {result && (
                        <>
                          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Result</p>
                          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-4 text-text-primary">{pretty(result.output)}</pre>
                        </>
                      )}
                      {action?.status === 'done' && action.output !== undefined && !result && (
                        <>
                          <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-text-secondary">Result (after approval)</p>
                          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-4 text-text-primary">{pretty(action.output)}</pre>
                        </>
                      )}
                      {action?.actorName && action.tier !== 'read' && (
                        <p className="mt-2 text-[12px] leading-4 text-text-secondary">
                          {action.status === 'pending' ? 'Asked' : action.status === 'declined' ? 'Declined' : action.status === 'undone' ? 'Undone' : 'Done'} ·{' '}
                          {action.actorName}
                        </p>
                      )}
                      {action?.undoable && (
                        <button
                          disabled={acting === action.id}
                          onClick={() => onDecide(action, 'undo')}
                          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
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
                  )}
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
            <div className="prose-assistant text-[15px] leading-[22px] text-text-primary" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }} />
          )}
          {[...live.tools.entries()].map(([id, t]) => (
            <div key={id} className="flex items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 text-[13px] leading-[18px]">
              {!t.done ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" strokeWidth={2} />
              ) : (
                <Wrench className="h-3.5 w-3.5 text-text-muted" strokeWidth={1.75} />
              )}
              <span className="font-medium text-text-primary">{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-text-secondary">{inputSummary(t.input)}</span>
              {t.done && (
                <span className={t.ok ? 'text-text-secondary' : 'text-danger'}>
                  {t.ok ? 'ok' : 'error'} · <span className="tabular-nums">{t.ms}</span> ms
                </span>
              )}
            </div>
          ))}
        </div>
      ) : running ? (
        <p className="flex items-center gap-2 text-[13px] leading-[18px] text-text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> Working…
        </p>
      ) : null}
    </div>
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
