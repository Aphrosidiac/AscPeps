import { env } from '../../../config/env.js';

// The one place the assistant talks to a model. OpenRouter's chat completions,
// streamed, with tools — the OpenAI wire shape every model on OpenRouter
// speaks. Nothing above this file knows the wire shape; it sees text,
// reasoning, tool calls and usage.
//
// Streamed rather than the `openai` SDK's non-streaming call the agent used
// before, for two reasons. The dashboard shows the reply as it is written and
// each tool call as it starts, which a single response cannot do. And a
// stream can be aborted: the Stop button on the Assistant page actually stops
// the model, where before a runaway turn ran to its cap.
//
// Reasoning models hand back `reasoning_details` that must be echoed on the
// next request or the model forgets what it was thinking between tool calls.
// They are kept opaque and passed through.

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export interface WireMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  reasoning_details?: unknown[];
}

export interface WireTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  name: string;
  // Raw JSON text as the model wrote it. Parsed and validated by the caller so
  // a malformed call becomes an error result, not a crash.
  arguments: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  // OpenRouter's own accounting for the call, in USD, when it sent one.
  costUsd: number;
}

export interface CompletionResult {
  text: string;
  reasoning: string;
  reasoningDetails: unknown[] | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage: Usage;
  model: string;
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onToolCall?: (call: { index: number; id?: string; name?: string; argumentsDelta: string }) => void;
}

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface CompletionOptions {
  model: string;
  messages: WireMessage[];
  tools: WireTool[];
  effort?: ReasoningEffort;
  maxTokens: number;
  signal?: AbortSignal;
  handlers?: StreamHandlers;
}

export function providerConfigured(): boolean {
  return !!env.OPENROUTER_API_KEY;
}

export async function streamCompletion(opts: CompletionOptions): Promise<CompletionResult> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OpenRouter is not configured (OPENROUTER_API_KEY missing)');

  const effort = opts.effort ?? env.AGENT_REASONING_EFFORT;
  const body = {
    model: opts.model,
    messages: opts.messages,
    ...(opts.tools.length ? { tools: opts.tools, tool_choice: 'auto', parallel_tool_calls: true } : {}),
    max_tokens: opts.maxTokens,
    stream: true,
    usage: { include: true },
    // `none` is the value the non-streaming agent always sent — see the note
    // on AGENT_REASONING_EFFORT in config/env.ts.
    reasoning: effort === 'none' ? { effort: 'none' } : { effort },
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // Attribution for OpenRouter's public analytics, not auth.
      'HTTP-Referer': 'https://ascendpeptides.my',
      'X-Title': 'Ascend MY Admin Agent',
    },
    body: JSON.stringify(body),
    signal: opts.signal ?? AbortSignal.timeout(300_000),
  });

  if (!res.ok || !res.body) {
    const json: any = await res.json().catch(() => ({}));
    const msg = String(json?.error?.message ?? `OpenRouter returned ${res.status}`).split(key).join('••••');
    throw new Error(msg);
  }

  const out: CompletionResult = {
    text: '',
    reasoning: '',
    reasoningDetails: null,
    toolCalls: [],
    finishReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, costUsd: 0 },
    model: opts.model,
  };
  const calls = new Map<number, ToolCall>();
  const details: unknown[] = [];

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(String(chunk.error.message ?? 'The model stream reported an error'));
      if (chunk.model) out.model = chunk.model;
      if (chunk.usage) {
        const cached = Number(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0);
        out.usage = {
          input: Number(chunk.usage.prompt_tokens ?? 0) - cached,
          output: Number(chunk.usage.completion_tokens ?? 0),
          cacheRead: cached,
          costUsd: Number(chunk.usage.cost ?? 0),
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) {
        out.text += delta.content;
        opts.handlers?.onText?.(delta.content);
      }
      if (typeof delta.reasoning === 'string' && delta.reasoning) {
        out.reasoning += delta.reasoning;
        opts.handlers?.onReasoning?.(delta.reasoning);
      }
      if (Array.isArray(delta.reasoning_details)) details.push(...delta.reasoning_details);
      for (const tc of delta.tool_calls ?? []) {
        const idx = Number(tc.index ?? 0);
        const cur = calls.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        calls.set(idx, cur);
        opts.handlers?.onToolCall?.({ index: idx, id: tc.id, name: tc.function?.name, argumentsDelta: tc.function?.arguments ?? '' });
      }
      if (choice.finish_reason) out.finishReason = choice.finish_reason;
    }
  }

  out.toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], i) => ({ ...c, id: c.id || `call_${i}` }));
  out.reasoningDetails = details.length ? mergeReasoningDetails(details) : null;
  return out;
}

// Streamed reasoning_details arrive as fragments of the same block; the model
// wants them back whole. Fragments with the same index are joined on their
// text fields, everything else is kept as-is.
function mergeReasoningDetails(parts: unknown[]): unknown[] {
  const byIndex = new Map<number, any>();
  const rest: unknown[] = [];
  for (const p of parts as any[]) {
    if (p && typeof p.index === 'number') {
      const cur = byIndex.get(p.index);
      if (!cur) byIndex.set(p.index, { ...p });
      else for (const k of ['text', 'summary', 'data', 'signature']) if (typeof p[k] === 'string') cur[k] = (cur[k] ?? '') + p[k];
    } else rest.push(p);
  }
  return [...[...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), ...rest];
}
