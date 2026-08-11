import type { AgentTool } from './tool-kit.js';
import { CORE_TOOL_NAMES, DOMAINS, type Domain } from './domains.js';
import { catalogTools } from './tools/catalog.tools.js';
import { orderTools } from './tools/orders.tools.js';
import { financeTools } from './tools/finance.tools.js';
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
