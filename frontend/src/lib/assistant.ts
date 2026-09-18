import axios from 'axios';

// The Assistant page's slice of the API: threads, turns, the event stream,
// the operator's decisions on actions, and the memory blocks. Kept apart
// from api.ts because the stream is a raw fetch, not an axios call — SSE
// over fetch with the normal Authorization header, since EventSource cannot
// carry one — and because the shapes here are the transcript's own.

const BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/admin/assistant`;
const http = axios.create({ baseURL: BASE, timeout: 30_000 });
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function onUnauthorized() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('ascend-admin-token');
  if (window.location.pathname.startsWith('/admin')) window.location.href = '/admin/login';
}

// Same rule as api.ts: an expired or invalid admin token sends you to the
// login page instead of leaving an "Unauthorized" toast over an empty page —
// which is what a three-day-old token in the browser produced the first time
// this page was opened in a real Chrome.
http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) onUnauthorized();
    return Promise.reject(error);
  }
);

export type ThreadKind = 'chat' | 'whatsapp' | 'reflect' | 'digest';

export interface Thread {
  id: string;
  kind: ThreadKind;
  title: string;
  chatKey: string | null;
  status: string;
  running: boolean;
  pending: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  id: string;
  name: string;
  output: unknown;
  isError: boolean;
  ms: number;
}

export interface GuardNote {
  kind: 'write' | 'grounding';
  outcome: 'replaced' | 'repaired' | 'shadow';
  violations?: number;
}

export interface MessageContent {
  text?: string;
  sender?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  guard?: GuardNote;
  retracted?: boolean;
  transient?: boolean;
  summary?: string;
  replaces?: [number, number];
}

export interface Message {
  id: string;
  seq: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: MessageContent;
  actorName: string | null;
  createdAt: string;
}

export interface Action {
  id: string;
  callId: string | null;
  tool: string;
  tier: 'read' | 'write' | 'destructive';
  status: 'done' | 'pending' | 'declined' | 'undone' | 'failed' | 'expired';
  summary: string | null;
  input: unknown;
  output: unknown;
  undoable: boolean;
  actorName: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ThreadDetail extends Thread {
  messages: Message[];
  actions: Action[];
}

export interface MemoryFile {
  path: string;
  chars: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ToolInfo {
  name: string;
  tier: 'read' | 'write' | 'destructive';
  description: string;
  undoable: boolean;
}

export const listThreads = (token: string) => http.get<{ threads: Thread[]; configured: boolean; model: string }>('/threads', auth(token)).then((r) => r.data);

export const createThread = (token: string) => http.post<{ thread: Thread }>('/threads', {}, auth(token)).then((r) => r.data.thread);

export const getThread = (token: string, id: string) => http.get<{ thread: ThreadDetail }>(`/threads/${id}`, auth(token)).then((r) => r.data.thread);

export const renameThread = (token: string, id: string, title: string) =>
  http.put<{ thread: Thread }>(`/threads/${id}`, { title }, auth(token)).then((r) => r.data.thread);

export const deleteThread = (token: string, id: string) => http.delete(`/threads/${id}`, auth(token)).then((r) => r.data);

export const sendTurn = (token: string, id: string, text: string) =>
  http.post<{ userMessage: Message }>(`/threads/${id}/turns`, { text }, auth(token)).then((r) => r.data.userMessage);

export const stopTurn = (token: string, id: string) => http.post(`/threads/${id}/stop`, {}, auth(token)).then((r) => r.data);

export const decideAction = (token: string, id: string, verb: 'approve' | 'decline' | 'undo', reason?: string) =>
  http.post<{ action: Action; note?: string }>(`/actions/${id}/${verb}`, reason ? { reason } : {}, auth(token)).then((r) => r.data);

export const listMemory = (token: string) => http.get<{ files: MemoryFile[] }>('/memory', auth(token)).then((r) => r.data.files);

export const readMemory = (token: string, path: string) =>
  http
    .get<{ path: string; content: string; updatedBy: string; updatedAt: string }>(`/memory/${encodeURIComponent(path).replace(/%2F/g, '/')}`, auth(token))
    .then((r) => r.data);

export const saveMemory = (token: string, path: string, content: string) =>
  http.put<{ path: string; chars: number }>(`/memory/${encodeURIComponent(path).replace(/%2F/g, '/')}`, { content }, auth(token)).then((r) => r.data);

export const deleteMemory = (token: string, path: string) =>
  http.delete(`/memory/${encodeURIComponent(path).replace(/%2F/g, '/')}`, auth(token)).then((r) => r.data);

export interface ModelInfo {
  id: string;
  label: string;
  fit: string;
  in: number;
  out: number;
  effort: boolean;
  role: 'everyday' | 'escalation' | 'both';
}

export interface ModelSettings {
  model: string;
  escalationModel: string | null;
  effort: 'none' | 'low' | 'medium' | 'high';
}

export const getModelSettings = (token: string) =>
  http.get<{ settings: ModelSettings; models: ModelInfo[]; efforts: { value: string; label: string }[] }>('/settings', auth(token)).then((r) => r.data);

export const saveModelSettings = (token: string, patch: Partial<{ model: string; escalationModel: string | null; effort: string }>) =>
  http.put<{ settings: ModelSettings }>('/settings', patch, auth(token)).then((r) => r.data.settings);

export const listTools = (token: string) => http.get<{ tools: ToolInfo[] }>('/tools', auth(token)).then((r) => r.data.tools);

export const runReflection = (token: string) => http.post<{ threadId: string }>('/reflect', {}, auth(token)).then((r) => r.data);

export const runDigest = (token: string) => http.post<{ threadId: string }>('/digest', {}, auth(token)).then((r) => r.data);

export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  const err = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return err?.response?.data?.message ?? err?.response?.data?.error ?? err?.message ?? fallback;
}

// ---- The event stream ----

export interface AgentEvent {
  type: string;
  [k: string]: unknown;
}

// Reads a turn's events as they happen, with the last event id remembered so
// a dropped connection resumes instead of replaying. Returns a stop function.
export function streamEvents(
  token: string,
  threadId: string,
  onEvent: (id: number, e: AgentEvent) => void,
  onEnd: (reason: 'done' | 'error' | 'idle' | 'closed') => void
): () => void {
  const ctrl = new AbortController();
  let lastId = 0;
  let closed = false;

  const connect = async () => {
    let attempt = 0;
    while (!closed) {
      try {
        const res = await fetch(`${BASE}/threads/${threadId}/events?since=${lastId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          closed = true;
          onUnauthorized();
          onEnd('closed');
          return;
        }
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        attempt = 0;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let sep: number;
          while ((sep = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            let id = 0;
            let type = '';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('id:')) id = Number(line.slice(3).trim());
              else if (line.startsWith('event:')) type = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!type) continue;
            if (type === 'idle') {
              closed = true;
              onEnd('idle');
              return;
            }
            if (id) lastId = id;
            let parsed: AgentEvent = { type };
            try {
              parsed = { type, ...(data ? JSON.parse(data) : {}) };
            } catch {
              /* a malformed frame is skipped */
            }
            onEvent(id, parsed);
            if (type === 'done' || type === 'error') {
              closed = true;
              onEnd(type);
              return;
            }
          }
        }
        // The server closed without a terminal event: reconnect from lastId.
      } catch {
        if (closed || ctrl.signal.aborted) return;
        attempt += 1;
        if (attempt > 6) {
          closed = true;
          onEnd('closed');
          return;
        }
        await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt)));
      }
    }
  };
  void connect();
  return () => {
    closed = true;
    ctrl.abort();
  };
}
