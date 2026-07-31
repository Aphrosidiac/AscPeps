import type { AgentTool } from './tool-kit.js';
import { catalogTools } from './tools/catalog.tools.js';
import { orderTools } from './tools/orders.tools.js';
import { financeTools } from './tools/finance.tools.js';
import { contentTools } from './tools/content.tools.js';
import { opsTools } from './tools/ops.tools.js';
import { reportTools } from './tools/reports.tools.js';
import { deliveryTools } from './tools/delivery.tools.js';

export const ALL_TOOLS: AgentTool[] = [
  ...catalogTools,
  ...orderTools,
  ...financeTools,
  ...contentTools,
  ...opsTools,
  ...reportTools,
  ...deliveryTools,
];

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
export function toolsFor(canWrite: boolean): AgentTool[] {
  const tools = canWrite ? ALL_TOOLS : ALL_TOOLS.filter((t) => !t.write);
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
