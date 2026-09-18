import { z } from 'zod';
import type { AgentTool } from './tool-kit.js';
import { CORE_TOOL_NAMES, DOMAINS, type Domain } from './domains.js';
import { catalogTools } from './tools/catalog.tools.js';
import { orderTools } from './tools/orders.tools.js';
import { financeTools } from './tools/finance.tools.js';
import { documentTools } from './tools/documents.tools.js';
import { shadowTools } from './tools/shadow.tools.js';
import { contentTools } from './tools/content.tools.js';
import { opsTools } from './tools/ops.tools.js';
import { reportTools } from './tools/reports.tools.js';
import { deliveryTools } from './tools/delivery.tools.js';
import { reminderTools } from './tools/reminders.tools.js';
import { memoryTools } from './tools/memory.tools.js';

// Domain membership is assigned here rather than as a field on each tool, so
// the eight tool files stay unaware of routing entirely.
//
// `contentTools` is the one file that carries two unrelated jobs — insight
// articles and discount codes — so it is split by name. Grouping discount codes
// under "content" would mean a message about a promo code loading the article
// tools and vice versa, which is exactly the noise this is meant to remove.
const isDiscountTool = (t: AgentTool) => t.name.endsWith('_discount_code') || t.name === 'list_discount_codes';

const DOMAIN_TOOLS: Record<Domain, AgentTool[]> = {
  catalog: catalogTools,
  orders: orderTools,
  finance: financeTools,
  promos: contentTools.filter(isDiscountTool),
  content: contentTools.filter((t) => !isDiscountTool(t)),
  // Memory rides with ops for registration only — the two write tools are in
  // CORE_TOOL_NAMES so they are offered on every turn regardless of routing.
  // Remembering is not a topic the router could detect: the operator says
  // something worth keeping while asking about an order.
  ops: [...opsTools, ...memoryTools],
  reports: reportTools,
  delivery: deliveryTools,
  reminders: reminderTools,
  // Its own domain rather than riding with finance, because a tool may appear
  // in exactly one bucket (ALL_TOOLS is a flatMap over the domains, and the
  // duplicate-name check at the bottom of this file fires on a repeat).
  // Nothing is lost: routeDomains returns EVERY domain a message matches, and
  // the documents keyword list shares "receipt"/"invoice" with orders, so
  // "record the ads expense, here's the receipt" loads finance and documents
  // together.
  documents: documentTools,
  // Its own bucket for the same reason documents has one: a tool may appear in
  // exactly one domain or the duplicate-name check below fires. Routing is not
  // harmed by the split — routeDomains returns every domain a message matches.
  shadow: shadowTools,
};

export const ALL_TOOLS: AgentTool[] = DOMAINS.flatMap((d) => DOMAIN_TOOLS[d]);

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return byName.get(name);
}

// Appended to every destructive tool's description.
//
// A system-prompt rule alone was not enough: on an order it judged sensitive
// (delivered AND paid) the model would write its own "are you sure?" in prose
// instead of calling the tool, leaving the operator's "yes" answering nothing.
// Tool descriptions carry far more weight on the call/don't-call decision than
// a general instruction, and putting it here means a future destructive tool
// cannot be added without inheriting the rule.
const CONFIRM_NOTE =
  ' IMPORTANT: call this directly as soon as it is asked for. The system automatically pauses and asks the operator to confirm before anything happens — so never ask for confirmation yourself first, and never refuse on the grounds that it looks risky.';

// Read-only operators never see the write tools at all, rather than seeing them
// and being refused on use. Hiding them keeps the model from repeatedly
// proposing actions it cannot take and then having to explain itself.
//
// `domains` narrows the list further to what this turn is plausibly about (see
// domains.ts). Passing undefined returns everything, which is what the test
// scripts and the tool smoke check want.
//
// This is presentation only. `getTool` still resolves from the full registry
// and `runTool` still applies the write and destructive gates, so narrowing can
// never make an unsafe call safe or a safe call unsafe — worst case the model
// names a tool that was not advertised and it runs with every check in place.
export function toolsFor(canWrite: boolean, domains?: Iterable<Domain>): AgentTool[] {
  let tools = canWrite ? ALL_TOOLS : ALL_TOOLS.filter((t) => !t.write);

  if (domains) {
    const wanted = new Set<string>(CORE_TOOL_NAMES);
    for (const d of domains) for (const t of DOMAIN_TOOLS[d] ?? []) wanted.add(t.name);
    tools = tools.filter((t) => wanted.has(t.name));
  }

  return tools.map((t) =>
    t.destructive ? { ...t, description: t.description + CONFIRM_NOTE } : t
  );
}

// Fail loudly at boot rather than at 2am when the model picks the shadowed
// name and gets whichever tool the Map happened to keep.
const seen = new Set<string>();
for (const t of ALL_TOOLS) {
  if (seen.has(t.name)) throw new Error(`Duplicate agent tool name: ${t.name}`);
  seen.add(t.name);
}

// ---------------------------------------------------------------- validation
//
// Tool inputs used to reach `run` exactly as the model wrote them, and every
// tool re-checked its own arguments by hand (or did not). The schemas are
// already there — they are what the model is shown — so they are compiled
// once here and every call is checked against them before a tool sees it. A
// call that fails becomes an error result naming the field, which the model
// corrects on its next step; two steps in a row of that hand the turn to the
// escalation model (see core/run.ts).
//
// A schema zod cannot express is a schema that simply is not enforced — the
// tool still runs, as it always did — and the name is logged at boot so it can
// be fixed rather than silently skipped.
const validators = new Map<string, z.ZodTypeAny>();
export const UNVALIDATED_TOOLS: string[] = [];
for (const t of ALL_TOOLS) {
  try {
    validators.set(t.name, z.fromJSONSchema(t.input_schema as any));
  } catch {
    UNVALIDATED_TOOLS.push(t.name);
  }
}

export interface ValidationOutcome {
  ok: boolean;
  value: unknown;
  error?: string;
}

// A model that writes `"limit": "5"` or `"active": "true"` meant the number
// and the boolean; bouncing the whole call for that would be pedantry paid
// for in latency. Top-level scalars are nudged to the declared type before
// validation — anything deeper, or anything that does not parse cleanly, is
// left for the schema to reject.
function coerceScalars(schema: Record<string, any>, input: Record<string, unknown>): Record<string, unknown> {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return input;
  const out: Record<string, unknown> = { ...input };
  for (const [k, v] of Object.entries(out)) {
    const want = props[k]?.type;
    if (typeof v !== 'string') continue;
    if ((want === 'number' || want === 'integer') && /^-?\d+(\.\d+)?$/.test(v.trim())) out[k] = Number(v);
    else if (want === 'boolean' && /^(true|false)$/i.test(v.trim())) out[k] = v.trim().toLowerCase() === 'true';
  }
  return out;
}

export function validateToolInput(name: string, input: unknown): ValidationOutcome {
  const schema = validators.get(name);
  const tool = byName.get(name);
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const value = tool ? coerceScalars(tool.input_schema, raw) : raw;
  if (!schema) return { ok: true, value };
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const at = issue?.path?.length ? ` at "${issue.path.join('.')}"` : '';
  return { ok: false, value, error: `Invalid arguments${at}: ${issue?.message ?? 'schema mismatch'}. Read the tool's schema and call it again with exactly the fields it defines.` };
}
