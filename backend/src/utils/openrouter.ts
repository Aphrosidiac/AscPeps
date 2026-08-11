import OpenAI from 'openai';
import { env } from '../config/env.js';

// OpenRouter speaks the OpenAI-compatible chat-completions API, so the official
// `openai` package pointed at OpenRouter's base URL is the standard integration
// — there is no dedicated OpenRouter SDK to reach for.
export const openrouter = env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        // OpenRouter uses these for its public leaderboard/analytics
        // attribution, not for auth — safe to hardcode rather than making
        // them configurable.
        'HTTP-Referer': 'https://ascendpeptides.my',
        'X-Title': 'Ascend MY Admin Agent',
      },
    })
  : null;

export const OPENROUTER_MODEL = env.OPENROUTER_MODEL;

// Every call site defines its tools in this provider-agnostic shape and lets
// `toOpenAiTools` do the wrapping, so a future provider swap touches this file
// rather than every tool definition in the codebase.
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export function toOpenAiTools(tools: ToolDef[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

// Go through this rather than calling `openrouter.chat.completions.create()`
// directly.
//
// DeepSeek V4 is reasoning-capable, and with reasoning left at its default it
// can silently spend the ENTIRE max_tokens budget on internal chain-of-thought
// and return `content: null` with nothing usable — no error, just an empty
// response. (Verified on HarvestGrow: a 20-token budget with default reasoning
// returned nothing at all; the identical call with reasoning disabled returned
// "OK" cleanly.) Nothing here wants visible chain-of-thought — tool selection
// and short operator replies — so it is off by default. Pass `reasoning` in
// `params` to override per-call.
export async function createCompletion(
  params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, 'model'> & { model?: string }
) {
  if (!openrouter) throw new Error('OpenRouter is not configured (OPENROUTER_API_KEY missing)');
  return openrouter.chat.completions.create({
    model: OPENROUTER_MODEL,
    reasoning: { effort: 'none' },
    ...params,
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
}
