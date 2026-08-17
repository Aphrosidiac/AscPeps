import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

// Who is giving the instruction. Resolved from the WhatsAppOperator allowlist
// before a single token is spent on the model — an unknown sender never
// reaches a tool, or an LLM call, at all.
export interface AgentActor {
  phone: string;
  name: string;
  canWrite: boolean;
}

/** Where a conversation is happening — see ToolContext.origin. */
export interface ChatOrigin {
  kind: 'dm' | 'group';
  /** AgentConversation.chatKey: "dm:0123456789" or "group:120…@g.us". */
  chatKey: string;
  /** How it reads to a human: "this group — Ops" / "your DM". */
  label: string;
}

export interface ToolContext {
  // The live API instance. Order and finance tools call the existing admin
  // controllers through this rather than writing rows themselves — those
  // controllers carry logic the agent must not bypass (stock restoration on
  // cancel, the Billplz refund call, PostHog revenue capture, and enqueuing
  // the receipt email inside the same transaction as the status change).
  // Reimplementing any of it here would mean the agent quietly diverges from
  // the admin UI the first time that logic changes.
  //
  // This is also why the agent runs in the API process and not in the WhatsApp
  // worker: the worker holds the socket, the API holds the business logic.
  fastify: FastifyInstance;
  prisma: PrismaClient;
  actor: AgentActor;
  // Where this conversation is happening, so a tool can address something back
  // to it later. Carries AgentConversation.chatKey verbatim ("dm:0123456789" /
  // "group:120…@g.us") rather than a second addressing scheme, so "send it
  // where we are talking" cannot drift out of step with where the thread
  // actually lives. Optional so the write-tool tests can build a context
  // without inventing a conversation.
  origin?: ChatOrigin;
  // Storefront cache invalidation. Writing product/content rows straight to
  // the DB (as these tools do) bypasses the admin HTTP API and therefore never
  // fires the revalidate ping the frontend relies on — without this an agent
  // edit appears to do nothing for up to an hour. Fire-and-forget by design:
  // a failed ping must not fail the write that already committed.
  revalidate: (tags: string[]) => void;
}

export interface AgentTool {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  // Mutates state. Refused outright for `canWrite: false` operators.
  write?: boolean;
  // Hard to undo (deletes, money movements, mail to real customers, anything
  // touching many rows at once). Parked for an explicit yes before running.
  destructive?: boolean;
  // What the operator is being asked to agree to, built from the RESOLVED
  // arguments rather than their message — "Delete order ASC2507/0042
  // (Nurul, RM 480.00)" instead of "delete that order". Without this the
  // confirmation step confirms nothing useful.
  summarize?: (ctx: ToolContext, input: any) => Promise<string>;
  run: (ctx: ToolContext, input: any) => Promise<unknown>;
}

// ---------------------------------------------------------------- money
//
// Every money column in this schema is an integer number of CENTS. Tool inputs
// and outputs deliberately speak RINGGIT instead, because a model that has to
// remember "multiply by 100" will eventually forget, and a 100x error on a
// price change or a payout is not a recoverable mistake. The conversion lives
// here, once, and every tool goes through it.

export function toCents(rm: number): number {
  if (typeof rm !== 'number' || !Number.isFinite(rm)) {
    throw new Error(`Expected a number of ringgit, got ${JSON.stringify(rm)}`);
  }
  // Round rather than truncate: 149.9 * 100 is 14989.999999999998 in floating
  // point, and truncation would silently shave a cent off every such price.
  return Math.round(rm * 100);
}

export function rm(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return `RM ${(cents / 100).toFixed(2)}`;
}

// Attach a human-readable ringgit string beside every cents value handed back
// to the model, so its replies quote real money without doing arithmetic.
export function money(cents: number | null | undefined) {
  return { cents: cents ?? null, display: rm(cents) };
}

// ---------------------------------------------------------------- dates

// Accepts 'today', 'yesterday', '7d', '30d', 'YYYY-MM-DD', or an ISO string.
// Operators type dates the way people speak them; rejecting anything that
// isn't ISO-8601 would make every report tool annoying to reach.
export function parseDate(value: string | null | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const raw = String(value).trim().toLowerCase();

  const now = new Date();
  const atEdge = (d: Date) => {
    if (endOfDay) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  };

  if (raw === 'today') return atEdge(new Date(now));
  if (raw === 'yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return atEdge(d);
  }

  const relative = raw.match(/^(\d+)\s*d(ays?)?$/);
  if (relative) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(relative[1], 10));
    return atEdge(d);
  }

  // A bare YYYY-MM-DD parses as UTC midnight, which in Malaysia (UTC+8) is
  // 8am the same day — so a "from 2026-07-01" filter would silently drop
  // everything ordered in the first eight hours of the 1st. Build it in
  // local time instead.
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return atEdge(d);
  }

  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Could not understand the date "${value}". Use YYYY-MM-DD, "today", "yesterday", or "30d".`);
  }
  return parsed;
}

// ---------------------------------------------------------------- schema bits

export const DATE_ARG = {
  type: 'string',
  description: 'Date as YYYY-MM-DD, or "today" / "yesterday" / "30d" (last 30 days).',
};

// Result sets go to a WhatsApp message and into the model's context window.
// Both are small. Every listing tool caps here rather than trusting the model
// to pass a sane limit.
export const MAX_ROWS = 50;

export function clampLimit(limit: unknown, fallback = 20): number {
  const n = typeof limit === 'number' ? limit : parseInt(String(limit ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_ROWS);
}

/**
 * Wraps a capped list so the model can tell a COMPLETE answer from a PARTIAL
 * one.
 *
 * A bare array is indistinguishable from the whole truth. On 11 Aug an operator
 * asked the agent to list all the products; `search_products` returned a plain
 * array capped at MAX_ROWS = 50 against a catalogue of 51, and the agent — with
 * nothing in the payload to suggest otherwise — presented it as the full
 * line-up. Nobody could have caught that from the transcript either, because
 * the omission left no trace anywhere.
 *
 * `matched` is the real total from a COUNT, not `rows.length`. That distinction
 * is the entire point: without a separate count there is no way to know a cap
 * was hit.
 */
export function listResult<T>(rows: T[], matched: number, key = 'items'): Record<string, unknown> {
  const truncated = matched > rows.length;
  return {
    matched,
    showing: rows.length,
    truncated,
    ...(truncated
      ? {
          note: `Showing ${rows.length} of ${matched}. This list is INCOMPLETE — say so rather than presenting it as everything, and narrow the search or raise the limit if the operator needs the rest.`,
        }
      : {}),
    [key]: rows,
  };
}

/**
 * Marker for a payload that describes records without carrying their detail.
 *
 * Summary rows are where both August fabrication incidents started: the agent
 * had a `list_orders` result in front of it, which has never contained line
 * items or an address, and wrote both anyway. The tool description already said
 * "Returns summaries — call get_order for full detail" and that was not enough,
 * because a description is read once when choosing the tool while this travels
 * with the data itself.
 */
export function summaryOnly(missing: string, detailTool: string): string {
  return `SUMMARY ONLY — this payload does NOT contain ${missing}. Do not state, describe, guess or deny any of those from this result; call ${detailTool} first. If you have not called it, say you have not checked.`;
}

// Tool results are JSON-stringified into the model's context. An unbounded
// result (a 500-row report, a product description) can blow the window on its
// own, and the model only ever needs enough to answer.
export function truncate(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated, ${value.length} chars total]` : value;
}
