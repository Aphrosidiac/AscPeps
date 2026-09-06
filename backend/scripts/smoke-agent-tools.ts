/**
 * Exercises the agent's READ tools against the local dev database, without
 * involving WhatsApp or the LLM.
 *
 * The tool layer is where most of the agent's risk lives — a tool that throws
 * on a real row, returns BigInt that can't be serialized, or builds bad SQL
 * would only surface mid-conversation otherwise. This runs every read tool and
 * reports which ones came back clean.
 *
 * Read-only by design: nothing with `write: true` is invoked.
 *
 *   set -a && source .env && set +a && npx tsx scripts/smoke-agent-tools.ts
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { ALL_TOOLS, getTool } from '../src/modules/ai-agent/registry.js';
import type { ToolContext } from '../src/modules/ai-agent/tool-kit.js';

const fastify = Fastify({ logger: false });
await fastify.register(prismaPlugin);

const ctx: ToolContext = {
  fastify,
  prisma: fastify.prisma,
  actor: { phone: '0000000000', name: 'Smoke Test', canWrite: false },
  revalidate: () => {},
};

// Tools needing a real id are given one resolved from the dev database, so the
// smoke test exercises the actual query path rather than an early "not found".
const someProduct = await fastify.prisma.product.findFirst({ include: { variants: true } });
const someOrder = await fastify.prisma.order.findFirst({ where: { deletedAt: null } });
const someInsight = await fastify.prisma.insight.findFirst();
const somePartner = await fastify.prisma.partner.findFirst();
const someDocument = await fastify.prisma.document.findFirst();

const INPUTS: Record<string, any> = {
  get_product: someProduct ? { productIdOrSlug: someProduct.slug } : null,
  get_order: someOrder ? { orderRef: someOrder.orderNumber } : null,
  get_insight: someInsight ? { insightId: someInsight.id } : null,
  get_partner: somePartner ? { partnerRef: somePartner.name } : null,
  search_products: { limit: 3 },
  list_orders: { limit: 3 },
  top_products: { limit: 3 },
  customer_report: { limit: 3 },
  sales_breakdown: { groupBy: 'month', limit: 5 },
  sales_analytics: { days: 30 },
  list_low_stock: { threshold: 5 },
  list_insights: { limit: 3 },
  list_discount_codes: { limit: 3 },
  list_expenses: { limit: 3 },
  list_documents: { limit: 3 },
  get_document: someDocument ? { documentId: someDocument.id } : null,
  email_outbox_status: {},
  agent_activity_log: { limit: 3 },
  run_report_query: {
    sql: 'SELECT status, COUNT(*) AS n FROM orders WHERE "deletedAt" IS NULL GROUP BY status',
    purpose: 'smoke test',
  },
};

let pass = 0;
let fail = 0;
let skipped = 0;

for (const tool of ALL_TOOLS) {
  if (tool.write) {
    skipped++;
    continue;
  }
  // `??` would fold the null sentinel into {} before the skip check below ever
  // ran, so a tool whose sample row is missing was invoked with no arguments
  // and reported as a failure. Only tools with no entry at all default to {}.
  const input = tool.name in INPUTS ? INPUTS[tool.name] : {};
  if (input === null) {
    console.log(`~ ${tool.name.padEnd(24)} skipped (no sample row in dev db)`);
    skipped++;
    continue;
  }
  try {
    const result = await getTool(tool.name)!.run(ctx, input);
    // Serialization is part of the contract: the result is JSON.stringify'd
    // into the model's context, and a stray BigInt from a raw aggregate throws
    // there rather than here if it isn't checked.
    const json = JSON.stringify(result);
    console.log(`✓ ${tool.name.padEnd(24)} ${json.length} bytes`);
    pass++;
  } catch (err: any) {
    console.log(`✗ ${tool.name.padEnd(24)} ${err?.message ?? err}`);
    fail++;
  }
}

console.log(`\nread tools: ${pass} passed, ${fail} failed, ${skipped} skipped (write tools are not exercised)`);
console.log(`total tools registered: ${ALL_TOOLS.length}`);

await fastify.close();
process.exit(fail ? 1 : 0);
