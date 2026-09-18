# The assistant

Abby, from the dashboard and from WhatsApp, on one harness. This document is
the harness; [whatsapp-agent.md](whatsapp-agent.md) is the phone-specific
half (pairing, the allowlist, LIDs, groups, the guards' history) and stays
true.

Built 2026-09-18 by porting the Tapis assistant's architecture onto Ascend
MY's existing 75 tools, and keeping what Ascend's WhatsApp-only agent already
did better: the grounding guard, the write-honesty guard, domain routing with
`load_context`, read-only operators, group and LID gating, and the four
memory blocks.

---

## Shape

```
  Assistant page ──SSE──▶  assistant.routes.ts        WhatsApp ──▶ worker ──▶ agent.routes.ts
  (React, /admin/assistant)   threads · turns · events              (loopback + token)      │
                              actions · memory · routines                                   ▼
                                       │                                          agent.service.ts
                                       │                                          gate (allowlist, group,
                                       │                                          mention) · yes/no →
                                       ▼                                          approve/decline · relay
                                 core/run.ts  ◀──────────────────────────────────────┘
                                 the loop: transcript, events, tools, guards, approvals, undo, compaction
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
             core/provider.ts    registry.ts        core/prompt.ts
             streamed OpenRouter tiers + zod        static prompt · context block
             tool calls · usage  validation         live brief (store state)
```

One process (`ascend-api`), one loop, two doors. A WhatsApp thread and a
dashboard thread are the same table rows; the Assistant page shows both.

```
src/modules/ai-agent/
  core/provider.ts     the one place the assistant talks to a model
  core/prompt.ts       who Abby is; the per-turn business rules; the live brief
  core/run.ts          the loop — read this file first
  registry.ts          the 75 tools, domain buckets, compiled input validators
  tool-kit.ts          AgentTool, tiers, audited(), money/date helpers
  domains.ts           keyword routing (unchanged)
  grounding.ts         the read-side honesty guard (unchanged)
  memory.ts            the four memory blocks (unchanged)
  agent.service.ts     the WhatsApp door
  assistant.routes.ts  the dashboard's API
  reflect.ts           nightly memory tidy-up
  digest.ts            morning brief
  schedule.ts          the settings both jobs read
  tools/*.tools.ts     the tools themselves
```

---

## Data

Three tables replaced four (migration `20260918090000_agent_threads`, which
carried every existing conversation, message and audited call across).

**`agent_threads`** — one per conversation. `kind` is `chat` (dashboard),
`whatsapp` (one per `chatKey`, `dm:<phone>` or `group:<jid>`), `reflect` or
`digest`. Carries the model, token counts, cost and turn count.

**`agent_messages`** — the transcript, append-only, provider-neutral. `content`
is JSON:

| role | content |
|---|---|
| `user` | `{ text, sender? }` — sender is the operator's name in a group thread |
| `assistant` | `{ text?, reasoning?, toolCalls?: [{ id, name, input, raw }], guard?, retracted? }` |
| `tool` | `{ toolResults: [{ id, name, output, isError, ms }] }` — results in full |
| `system` | `{ text, transient? }` — an approval, a decline, an undo, a one-turn note |
| `system` | `{ summary, replaces: [seq, seq] }` — a compaction row |

Tool results are stored whole. The old table stored only the prose and kept
tool calls in a separate audit table truncated at 2000 characters, so the
model could not see last turn's lookups and the grounding replay over-reported.
Now what the model saw is what a reader sees, and `audit-agent-grounding.ts`
replays exactly that.

**`agent_actions`** — every tool call: `tier` (`read` · `write` ·
`destructive`), `status` (`done` · `pending` · `declined` · `undone` ·
`failed` · `expired`), the resolved `summary`, `input`, `output`, and for
writes that opt in, `before`/`after` — the undo record. `callId` ties it to the
transcript card; `actorName`/`actorPhone` say who; `expiresAt` is set only on
WhatsApp confirmations.

---

## The turn (core/run.ts)

1. **Compact if needed.** Past 100k characters of model-visible transcript,
   everything but the last 12 rows is summarised into a system row that
   records which range it replaces. Rows are never deleted; the operator still
   sees the whole conversation.
2. **Route.** `routeDomains` over the last five text rows picks the areas
   whose tools and business rules go in front of the model. `load_context`
   widens it mid-turn; `CORE_TOOL_NAMES` are always there.
3. **Build the prompt.** Static prompt (the cached prefix) · memory blocks ·
   context block · live brief (who, channel, time, store switches) · the
   transcript in wire form.
4. **Step**, up to 16 times: stream a completion; persist the assistant row
   before doing anything it asked; validate every tool call against its
   schema (`z.fromJSONSchema` over the same JSON schema the model was shown;
   top-level numeric and boolean strings are coerced first); run the calls
   together, each on a 45 s clock; persist the tool row.
   - **Destructive** calls never run here. An `agent_actions` row is created
     `pending`, the model gets `{ pending: true, wouldDo }` and is told to say
     what it asked and stop.
   - **Read-only operators** never see write tools; a hallucinated name is
     refused on the way in as well.
   - Two consecutive steps of schema-invalid calls, or a provider error,
     hand the turn to `OPENROUTER_ESCALATION_MODEL` when one is set.
   - Past 30k output tokens the model is told to wrap up; on the last step it
     gets no tools.
5. **Guard the answer.** When a step returns text and no calls:
   - **Write guard.** A completion claim (`CLAIMS_COMPLETION`) with no
     successful write this turn is replaced. Writes approved between the last
     operator message and now count — the resumed turn after an approval is
     allowed to say "done".
   - **Grounding guard** (`AGENT_GROUNDING_MODE`, default `shadow`). The
     evidence is this turn's tool results plus the last three turns' results
     that are still in the model's view — the transcript now carries them and
     the model quotes an order it fetched two messages ago rather than
     fetching it again, which is not an invention. In `enforce`, a violation
     stores the draft as a **retracted** row, pushes the repair instruction
     as a transient system row, and loops; after two repairs the reply is
     replaced. The outcome is recorded on the row (`guard`) so the card can
     say what happened.
   - An empty reply is nudged once, then reported.
6. **Finish.** Token counts and OpenRouter's own `usage.cost` are added to the
   thread; `done` is emitted.

Every event (`text`, `reasoning`, `tool_start`, `tool_end`, `approval`,
`message`, `step`, `done`, `error`) is numbered and kept for a minute after
the run, so a client that drops mid-turn resumes from its last id.

### Approvals

`approveAction` runs the parked tool as the approving actor, records the
result on the action, appends a system row saying so, and resumes the thread
so the model can report and finish what depended on it. `declineAction`
appends the decline; on the dashboard it resumes too, over WhatsApp it does
not (the phone gets "Cancelled — nothing was changed").

A dashboard card never expires. A WhatsApp confirmation expires after five
minutes (`WHATSAPP_PENDING_TTL_MS`); a new message that is neither yes nor no
declines it ("moved on"). An approval or decline made on the dashboard for a
WhatsApp thread relays the outcome to the chat.

### Undo

A write tool that returns `audited(result, before, after)` and defines
`undo()` gets an **Undo this change** button in its card. Undo runs
`tool.undo(ctx, { input, before, after })`, marks the action `undone`, and
appends a system row. Undoable today: `update_product`, `update_variant`,
`adjust_stock` (reverses the delta that actually landed, so a sale in between
survives), `set_sale`, `update_setting`, `update_discount_code`,
`update_insight`, `memory_block_append`, `memory_block_replace`. Anything
that goes through an admin controller with side effects (order status, emails,
payouts) is deliberately not undoable from a button.

---

## Channels

| | dashboard (`web`) | WhatsApp (`dm` / `group`) |
|---|---|---|
| actor | the signed-in admin, full access | the resolved operator, `canWrite` from the allowlist |
| approval | card with Approve / Decline | "yes" / "no" as the whole message; 5-minute expiry |
| reply | streamed, markdown | one message, `toWhatsAppText`, confirmation prompt appended |
| reminders "to me" | refused — name an operator | the chat, or an operator |
| thread | one per conversation, deletable | one per chat key, read-only on the page |

The WhatsApp adapter (`agent.service.ts`) keeps every rule the old service
had: the room is checked before the person, unknown senders are recorded and
ignored in silence, two operators on one thread are serialised, a bare "yes"
with nothing pending pushes the model to act rather than narrate.

---

## Memory

The four blocks (`business`, `people`, `suppliers`, `decisions`) are unchanged
and are the assistant's only long-term memory — see the security note in
[whatsapp-agent.md](whatsapp-agent.md). The Assistant page's **Memory** panel
reads and edits them; edits are attributed to the admin. Both memory tools are
now undoable.

Tapis's file-directory memory was considered and not adopted: the blocks'
threat model (everything in them is a standing system-prompt instruction, so
only what an operator said may enter) is the right one for a shop where
customers type into the data, and two memory systems would be worse than one.

---

## Routines

Two scheduled jobs, switched on from the Assistant page (**Routines**), stored
in `settings`:

| key | what |
|---|---|
| `agent_morning_brief` / `agent_morning_brief_hour` | once a day, after the hour: the assistant reads orders, stock, the outbox and reminders and writes one plain-text message, which the harness sends to every active operator's DM |
| `agent_nightly_reflection` | at 3am: re-reads the day's threads and actions and tidies the memory blocks |

Each runs in a thread of its own kind, visible on the page, at most once per
Malaysian day (`agent_*_last`), from a 5-minute tick in `server.ts`. A manual
run counts as the day's.

---

## Environment

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
OPENROUTER_ESCALATION_MODEL=          # optional: retried on after a failure or two invalid steps
AGENT_REASONING_EFFORT=none           # none | low | medium | high; see config/env.ts for why none
AGENT_GROUNDING_MODE=shadow           # off | shadow | enforce
```

The `openai` package is gone; the provider is a streamed `fetch`.

---

## Tests

Unchanged commands, ported to the new tables:

```bash
npm run test:agent:tools       # 34 read tools against the dev db
npm run test:agent:writes      # 33 write scenarios, rolled back
npm run test:agent:memory      # 24
npm run test:agent:grounding   # 31 unit (one pre-existing failure: get_document has no precondition)
npm run test:agent:context     # compaction is size-based now; the fixture pads replies past 100k chars
npm run test:agent:security    # 9
npm run test:agent:e2e         # 20 scenarios, real model; two are known to flake on model variance
npm run test:agent:grounding:e2e
npm run audit:agent:grounding  # replays the guard over stored turns; legacy turns match actions by time
```

The e2e suite's "money" scenario picks a priced, live variant on purpose — the
dev database has a variant literally coded `test` on a hidden product, and
"change the price of code test" sends the model looking for a discount code.
