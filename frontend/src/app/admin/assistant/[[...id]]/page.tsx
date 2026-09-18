'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Brain, CalendarClock, Loader2, MessagesSquare, SendHorizontal, Square, MessageSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  createThread,
  decideAction,
  deleteThread,
  errorMessage,
  getThread,
  listThreads,
  sendTurn,
  stopTurn,
  streamEvents,
  type Action,
  type AgentEvent,
  type Message,
  type Thread,
} from '@/lib/assistant';
import { ThreadList } from '@/components/admin/assistant/ThreadList';
import { Transcript, type LiveTurn } from '@/components/admin/assistant/Transcript';
import { MemoryPanel } from '@/components/admin/assistant/MemoryPanel';
import { RoutinesPanel } from '@/components/admin/assistant/RoutinesPanel';
import { money } from '@/components/admin/assistant/format';

// The assistant, from the dashboard. A thread list and a transcript that
// streams: text as it is written, each tool call as a card that fills in
// when the result lands, an approval card for anything destructive, and an
// Undo on every change it made. Everything shown is what the server stored —
// a reload shows the same conversation. WhatsApp conversations appear here
// too, read-only, with the same cards.

type Notice = { kind: 'ok' | 'bad'; text: string } | null;
type Side = 'memory' | 'routines' | null;

export default function AssistantPage() {
  const { token } = useAuth();
  const params = useParams<{ id?: string[] }>();
  const router = useRouter();
  const threadId = params?.id?.[0] ?? null;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [configured, setConfigured] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [side, setSide] = useState<Side>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const show = useCallback((kind: 'ok' | 'bad', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 4000);
  }, []);

  const loadThreads = useCallback(() => {
    if (!token) return;
    listThreads(token)
      .then((r) => {
        setThreads(r.threads);
        setConfigured(r.configured);
      })
      .catch((e) => show('bad', errorMessage(e)));
  }, [token, show]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  const newThread = () => {
    if (!token) return;
    createThread(token)
      .then((t) => {
        setThreads((ts) => [t, ...ts]);
        setListOpen(false);
        router.push(`/admin/assistant/${t.id}`);
      })
      .catch((e) => show('bad', errorMessage(e)));
  };

  const removeThread = (t: Thread) => {
    if (!token || !confirm(`Delete “${t.title}”?`)) return;
    deleteThread(token, t.id)
      .then(() => {
        setThreads((ts) => ts.filter((x) => x.id !== t.id));
        if (threadId === t.id) router.replace('/admin/assistant');
      })
      .catch((e) => show('bad', errorMessage(e)));
  };

  if (!token) return <div className="p-8 text-text-secondary">Loading…</div>;

  return (
    // Cancels the admin <main> padding so the three columns fill the viewport:
    // below the fixed mobile bar (56px) on small screens, the whole height
    // beside the sidebar on desktop.
    <div className="relative -mx-4 -mb-4 -mt-4 flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-background sm:-mx-6 sm:-mb-6 lg:-m-8 lg:h-dvh">
      <ThreadList threads={threads} activeId={threadId} open={listOpen} onClose={() => setListOpen(false)} onNew={newThread} onDelete={removeThread} />

      {/* Keyed on the thread so every piece of per-conversation state starts
          fresh on navigation, instead of being reset by hand in an effect. */}
      <Conversation
        key={threadId ?? 'new'}
        token={token}
        threadId={threadId}
        configured={configured}
        side={side}
        setSide={setSide}
        show={show}
        onThreadsChanged={loadThreads}
        onCreated={(t) => setThreads((ts) => [t, ...ts])}
        openList={() => setListOpen(true)}
      />

      {side && (
        <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-md border-l border-border bg-surface shadow-lg lg:static lg:w-96 lg:shadow-none">
          {side === 'memory' ? (
            <MemoryPanel token={token} onClose={() => setSide(null)} onNotice={show} />
          ) : (
            <RoutinesPanel
              token={token}
              onClose={() => setSide(null)}
              onNotice={show}
              onStarted={(id) => {
                loadThreads();
                router.push(`/admin/assistant/${id}`);
              }}
            />
          )}
        </aside>
      )}

      {notice && (
        <div
          role="status"
          className={cn(
            'pointer-events-none absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-lg px-3 py-2 text-[13px] font-medium shadow-lg',
            notice.kind === 'ok' ? 'bg-primary text-white' : 'bg-danger text-white'
          )}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}

function Conversation({
  token,
  threadId,
  configured,
  side,
  setSide,
  show,
  onThreadsChanged,
  onCreated,
  openList,
}: {
  token: string;
  threadId: string | null;
  configured: boolean;
  side: Side;
  setSide: (s: Side) => void;
  show: (kind: 'ok' | 'bad', text: string) => void;
  onThreadsChanged: () => void;
  onCreated: (t: Thread) => void;
  openList: () => void;
}) {
  const router = useRouter();
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [running, setRunning] = useState(false);
  const [acting, setActing] = useState('');
  const [draft, setDraft] = useState('');

  const scroller = useRef<HTMLDivElement | null>(null);
  const composer = useRef<HTMLTextAreaElement | null>(null);
  const stopStream = useRef<(() => void) | null>(null);
  // loadThread attaches a stream and the stream's end reloads the thread —
  // refs break that cycle without either closing over a stale other.
  const attachRef = useRef<(id: string) => void>(() => {});
  const loadRef = useRef<(id: string) => void>(() => {});

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // The turn in flight, assembled from events. `live` is the assistant
  // message being written right now; it becomes a stored message when the
  // server says so.
  const onEvent = useCallback(
    (e: AgentEvent) => {
      setLive((l) => {
        if (!l) return l;
        switch (e.type) {
          case 'text':
            return { ...l, text: l.text + String(e.delta ?? '') };
          case 'reasoning':
            return { ...l, reasoning: l.reasoning + String(e.delta ?? '') };
          case 'tool_start': {
            const tools = new Map(l.tools);
            tools.set(String(e.callId), { name: String(e.name), input: e.input, done: false, ok: true, ms: 0, preview: '' });
            return { ...l, tools };
          }
          case 'tool_end': {
            const tools = new Map(l.tools);
            const t = tools.get(String(e.callId));
            if (t) tools.set(String(e.callId), { ...t, done: true, ok: !!e.ok, ms: Number(e.ms ?? 0), preview: String(e.preview ?? '') });
            return { ...l, tools };
          }
          case 'message': {
            const m = e.message as Message;
            // A stored message supersedes the live view of the same content.
            if (m.role === 'assistant') return { ...l, text: '', reasoning: '' };
            if (m.role === 'tool') return { ...l, tools: new Map() };
            return l;
          }
          default:
            return l;
        }
      });
      if (e.type === 'message') {
        const m = e.message as Message;
        setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, m]));
      }
      if (e.type === 'approval') {
        const a = e.action as Action;
        setActions((as) => (as.some((x) => x.id === a.id) ? as : [...as, a]));
      }
      if (e.type === 'error') show('bad', String(e.message ?? 'The assistant hit an error'));
      scrollDown();
    },
    [show, scrollDown]
  );

  // Refreshed after every render (declared before the effect that uses
  // them, so the first load sees the real functions), never during one.
  useEffect(() => {
    attachRef.current = (id: string) => {
      stopStream.current?.();
      setLive((l) => l ?? { text: '', reasoning: '', tools: new Map() });
      stopStream.current = streamEvents(
        token,
        id,
        (_, e) => onEvent(e),
        (reason) => {
          setRunning(false);
          setLive(null);
          stopStream.current = null;
          if (reason === 'closed') show('bad', 'Lost the connection to the assistant. Reload to see where it got to.');
          loadRef.current(id);
          onThreadsChanged();
        }
      );
    };

    loadRef.current = (id: string) => {
      getThread(token, id)
        .then((t) => {
          setThread(t);
          setMessages(t.messages);
          setActions(t.actions);
          setRunning(t.running);
          scrollDown();
          if (t.running) attachRef.current(id);
        })
        .catch((e) => {
          show('bad', errorMessage(e));
          router.replace('/admin/assistant');
        });
    };
  });

  useEffect(() => {
    if (threadId) loadRef.current(threadId);
    else setTimeout(() => composer.current?.focus(), 50);
    return () => stopStream.current?.();
  }, [threadId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || running) return;
    let id = threadId;
    try {
      if (!id) {
        const t = await createThread(token);
        onCreated(t);
        id = t.id;
      }
      setDraft('');
      setRunning(true);
      setLive({ text: '', reasoning: '', tools: new Map() });
      // Start the turn before navigating to a new thread: the new
      // Conversation loads it, sees it running, and attaches — no race with
      // a load that would report it idle.
      await sendTurn(token, id, text);
      if (threadId !== id) router.push(`/admin/assistant/${id}`);
      else attachRef.current(id);
    } catch (e) {
      setRunning(false);
      setLive(null);
      setDraft(text);
      show('bad', errorMessage(e));
    }
  };

  // The operator's decisions on the assistant's actions. Approve and decline
  // resume the thread, so the stream is re-attached straight away.
  const decide = (a: Action, verb: 'approve' | 'decline' | 'undo') => {
    setActing(a.id);
    decideAction(token, a.id, verb)
      .then((r) => {
        setActions((as) => as.map((x) => (x.id === a.id ? { ...x, ...r.action } : x)));
        if (verb === 'undo') show('ok', r.note ?? 'Undone');
        else if (threadId) {
          setRunning(true);
          attachRef.current(threadId);
        }
      })
      .catch((e) => show('bad', errorMessage(e)))
      .finally(() => setActing(''));
  };

  const stop = () => {
    if (!threadId) return;
    stopTurn(token, threadId).catch((e) => show('bad', errorMessage(e)));
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const readOnly = thread?.kind === 'whatsapp' || thread?.kind === 'reflect' || thread?.kind === 'digest';
  const empty = !threadId || (!messages.length && !live);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:px-6">
        <button className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary lg:hidden" aria-label="Conversations" onClick={openList}>
          <MessagesSquare className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold leading-5 text-text-primary">{thread?.title ?? 'Assistant'}</p>
          {thread ? (
            <p className="truncate text-[12px] leading-4 text-text-secondary">
              {thread.kind === 'whatsapp' ? 'Over WhatsApp · ' : ''}
              {thread.model?.replace(/^.*\//, '')} · {thread.turns} turn{thread.turns === 1 ? '' : 's'} ·{' '}
              <span className="tabular-nums">{(thread.inputTokens + thread.outputTokens).toLocaleString()}</span> tokens · {money(thread.costUsd)}
            </p>
          ) : (
            <p className="truncate text-[12px] leading-4 text-text-secondary">Abby, with every tool the dashboard has</p>
          )}
        </div>
        {running && (
          <button
            onClick={stop}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] font-medium text-text-primary hover:bg-surface-elevated"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2} /> Stop
          </button>
        )}
        <button
          aria-pressed={side === 'routines'}
          onClick={() => setSide(side === 'routines' ? null : 'routines')}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium',
            side === 'routines' ? 'border-primary bg-primary text-white' : 'border-border text-text-primary hover:bg-surface-elevated'
          )}
        >
          <CalendarClock className="h-4 w-4" strokeWidth={1.75} /> <span className="hidden sm:inline">Routines</span>
        </button>
        <button
          aria-pressed={side === 'memory'}
          onClick={() => setSide(side === 'memory' ? null : 'memory')}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium',
            side === 'memory' ? 'border-primary bg-primary text-white' : 'border-border text-text-primary hover:bg-surface-elevated'
          )}
        >
          <Brain className="h-4 w-4" strokeWidth={1.75} /> <span className="hidden sm:inline">Memory</span>
        </button>
      </div>

      {!configured && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900 lg:px-6">
          OpenRouter is not configured on the API (OPENROUTER_API_KEY). You can read past conversations, but nothing new will run.
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
        {empty ? (
          <div className="mx-auto max-w-3xl py-16 text-center">
            <p className="font-display text-[18px] font-semibold text-text-primary">What do you want to know?</p>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-5 text-text-secondary">
              It can see every order, product, payment, expense and setting, and act on them — “what came in this week”, “how much BPC-157 is left”, “put the
              10mg on sale till Sunday”, “what does the business owe each partner”.
            </p>
          </div>
        ) : (
          <Transcript messages={messages} actions={actions} live={live} running={running} acting={acting} readOnly={!!readOnly} onDecide={decide} />
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border bg-surface px-4 py-3 lg:px-6" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        {readOnly ? (
          <p className="mx-auto flex max-w-3xl items-center gap-2 text-[13px] leading-[18px] text-text-secondary">
            <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            {thread?.kind === 'whatsapp'
              ? 'Over WhatsApp — the operator replies there. Approvals can be decided here; the outcome is sent to the chat.'
              : 'A scheduled run. Start a new conversation to ask it something.'}
            <Link href="/admin/assistant" className="ml-auto shrink-0 font-medium text-text-primary underline underline-offset-2">
              New conversation
            </Link>
          </p>
        ) : (
          <>
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <textarea
                ref={composer}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                disabled={running || !configured}
                placeholder="Ask about anything in the shop…"
                className="max-h-40 min-h-11 flex-1 resize-none rounded-[6px] border border-border bg-surface px-3 py-2.5 text-[15px] text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:bg-surface-elevated disabled:text-text-muted"
              />
              <button
                onClick={() => void send()}
                disabled={!draft.trim() || running || !configured}
                aria-label="Send"
                className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <SendHorizontal className="h-4 w-4" strokeWidth={1.75} />}
              </button>
            </div>
            <p className="mx-auto mt-1.5 max-w-3xl text-[12px] leading-4 text-text-secondary">
              Enter to send, Shift+Enter for a new line. Changes are recorded and can be undone from their card; deletes, money and anything customer-facing
              wait for your approval.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
