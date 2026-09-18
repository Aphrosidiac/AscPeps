import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env.js';
import type { ReasoningEffort } from './provider.js';

// The models offered on the Assistant page, with what each is for. OpenRouter
// ids; any other id can be typed in and simply shows no price. Prices are USD
// per million tokens as of 2026-09-18 and are display only — the thread's
// cost comes from OpenRouter's own accounting on every call.
//
// The harness carries the reliability (validation, budgets, guards, undo), so
// the everyday model can be a fraction of a frontier model's price. The
// escalation model takes a turn over after a provider failure or two steps
// of schema-invalid calls, so it is used rarely and may cost more.

export interface ModelInfo {
  id: string;
  label: string;
  // One line on when to pick it.
  fit: string;
  in: number;
  out: number;
  // Whether the model takes a reasoning effort at all. Sending `reasoning`
  // to one that does not is at best ignored; we omit it.
  effort: boolean;
  // Sensible role: everyday, escalation, or both.
  role: 'everyday' | 'escalation' | 'both';
}

export const AGENT_MODELS: ModelInfo[] = [
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', fit: 'Recommended everyday model — cheap, quick, good with tools.', in: 0.09, out: 0.18, effort: true, role: 'everyday' },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen3.7 Flash', fit: 'Cheapest; fine for lookups and short answers.', in: 0.03, out: 0.13, effort: true, role: 'everyday' },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', fit: 'Cheap; strongest of the flash tier on Chinese.', in: 0.09, out: 0.3, effort: true, role: 'everyday' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', fit: 'Newer flash; a little steadier on long multi-step turns.', in: 0.15, out: 0.6, effort: true, role: 'everyday' },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', fit: 'Fast with a very long context — for big reports and long WhatsApp threads.', in: 0.75, out: 3.75, effort: true, role: 'both' },
  { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', fit: 'Careful tool use at a mid price; a good escalation from a flash model.', in: 0.45, out: 2.25, effort: true, role: 'both' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3', fit: 'Mid price, strong on longer written replies (articles, reports).', in: 0.3, out: 1.2, effort: true, role: 'both' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', fit: 'The natural escalation from V4 Flash: same family, much stronger.', in: 1.6, out: 3.2, effort: true, role: 'escalation' },
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5', fit: 'Fast Claude; reliable formatting and tool calls, no visible reasoning.', in: 1, out: 5, effort: false, role: 'both' },
  { id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5', fit: 'Best judgement per ringgit for finance questions and anything customer-facing.', in: 2, out: 10, effort: true, role: 'both' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', fit: 'For the hard ones — reconciliation, month-end, anything you would double-check by hand.', in: 5, out: 25, effort: true, role: 'escalation' },
];

export const EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: 'None — quickest, the default on DeepSeek' },
  { value: 'low', label: 'Low — brief thinking' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High — for hard questions, slower and dearer' },
];

export function modelInfo(id: string): ModelInfo | null {
  return AGENT_MODELS.find((m) => m.id === id) ?? null;
}

export function supportsEffort(id: string): boolean {
  const m = modelInfo(id);
  if (m) return m.effort;
  return !/haiku|sonnet-4-5|sonnet-4\.5|opus-4-5|opus-4\.5|3-5|3\.5|3-7|3\.7/.test(id);
}

// ---------------------------------------------------------------- settings

// Stored in the settings table so an admin changes them from the Assistant
// page without a deploy; the environment is the fallback for a fresh
// database (and stays the documented default).
export const MODEL_SETTING_KEYS = {
  model: 'agent_model',
  escalation: 'agent_escalation_model',
  effort: 'agent_effort',
} as const;

export interface AgentModelSettings {
  model: string;
  escalationModel: string | null;
  effort: ReasoningEffort;
}

const MODEL_ID = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:-]*$/i;
const EFFORT_VALUES: ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

export async function agentModelSettings(fastify: FastifyInstance): Promise<AgentModelSettings> {
  const rows = await fastify.prisma.setting.findMany({ where: { key: { in: Object.values(MODEL_SETTING_KEYS) } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const model = get(MODEL_SETTING_KEYS.model) || env.OPENROUTER_MODEL;
  const escalation = get(MODEL_SETTING_KEYS.escalation) ?? env.OPENROUTER_ESCALATION_MODEL ?? null;
  const effortRaw = get(MODEL_SETTING_KEYS.effort) ?? env.AGENT_REASONING_EFFORT;
  const effort = (EFFORT_VALUES as string[]).includes(effortRaw) ? (effortRaw as ReasoningEffort) : 'none';
  return { model, escalationModel: escalation && escalation !== model && escalation !== 'none' ? escalation : null, effort };
}

export async function saveAgentModelSettings(fastify: FastifyInstance, patch: Partial<{ model: string; escalationModel: string | null; effort: string }>): Promise<AgentModelSettings> {
  const writes: [string, string][] = [];
  if (patch.model !== undefined) {
    const id = String(patch.model).trim();
    if (!MODEL_ID.test(id)) throw Object.assign(new Error('A model is an OpenRouter id like provider/model'), { statusCode: 400 });
    writes.push([MODEL_SETTING_KEYS.model, id]);
  }
  if (patch.escalationModel !== undefined) {
    const id = patch.escalationModel === null ? '' : String(patch.escalationModel).trim();
    if (id && !MODEL_ID.test(id)) throw Object.assign(new Error('An escalation model is an OpenRouter id like provider/model, or empty for none'), { statusCode: 400 });
    // An explicit "none" is stored so it beats the environment's default.
    writes.push([MODEL_SETTING_KEYS.escalation, id || 'none']);
  }
  if (patch.effort !== undefined) {
    const e = String(patch.effort);
    if (!(EFFORT_VALUES as string[]).includes(e)) throw Object.assign(new Error('Effort is none, low, medium or high'), { statusCode: 400 });
    writes.push([MODEL_SETTING_KEYS.effort, e]);
  }
  for (const [key, value] of writes) await fastify.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return agentModelSettings(fastify);
}
