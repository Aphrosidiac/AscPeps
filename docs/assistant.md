# The assistant

Abby, from the dashboard and from WhatsApp, on one harness. This document is
the harness; [whatsapp-agent.md](whatsapp-agent.md) is the phone-specific
half (pairing, the allowlist, LIDs, groups, the guards' history) and stays
true.

Built 2026-09-18 by porting the Tapis assistant's architecture onto Ascend
MY's existing tools (74 today), and keeping what Ascend's WhatsApp-only agent
already did better: the grounding guard, the write-honesty guard, domain
routing with `load_context`, read-only operators, and group and LID gating.
Memory became a file directory the same day — see below.

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
  core/models.ts       the model catalogue and the model/escalation/effort settings
  core/run.ts          the loop — read this file first
  registry.ts          the tools, domain buckets, compiled input validators
  tool-kit.ts          AgentTool, tiers, audited(), money/date helpers
  domains.ts           keyword routing (unchanged)
  grounding.ts         the read-side honesty guard (unchanged)
  memory.ts            the /memories directory: store, caps, the trust rule
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
3. **Build the prompt.** Static prompt (the cached prefix) · memory (core/ in full, the rest listed) ·
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
`update_insight`, and every `memory` command. Anything
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

### Replies and pictures

A WhatsApp message carries more than its text, and until 21 Sep 2026 the
rest was dropped: "ab put in a new order under the name andrew", sent with a
screenshot of the customer's order, reached the model as those nine words,
and it answered that it could not see any picture. Two things were missing.

**The replied-to message.** WhatsApp puts the whole quoted message on the
wire (`contextInfo.quotedMessage`); the worker read it only to decide
whether the bot had been addressed. Now `contentOf` in
`whatsapp-worker/mention.ts` extracts it, the worker relays it as `quoted`
(text, media kind, author JID, whether it was the bot's own), and the adapter
names the author the way it names a mention — an operator by name, the bot
as "you", anyone else as "someone (digits)". It is stored on the user row
as `quoted` and rendered ahead of the operator's words:

```
[Replying to a message from Asywa:
Andrew Tan, 2x BPC-157 5mg, No 12 Jalan Setia 3/4, 81100 JB
— end of the quoted message]
ab key this in
```

**Pictures.** The everyday model (DeepSeek V4 Flash) is text-only on
OpenRouter, so the worker was written never to download media. It now
downloads a picture — an `imageMessage`, or a document whose mime is
`image/*` — with HarvestGrow's guard (the size is read off the protobuf's
`fileLength` before anything is fetched; over 10 MB is refused and reported
as `imageOversized`), and a quoted picture the same way. The adapter hands
the bytes to `core/vision.ts`: `AGENT_VISION_MODEL` (GLM 5.3 Flash by
default) transcribes the picture verbatim — every name, number, address,
item and amount, who said what if it is a chat, and one `Image:` line saying
what kind of picture it is. The transcript is stored on the user row as an
attachment and rendered bracketed, so the model can tell the vision model's
reading from the operator's own words:

```
put in a new order under the name andrew
[A picture is attached. Its contents, transcribed verbatim for you:
Andrew Tan (10:44):
2x BPC-157 5mg
…
— end of the picture]
```

Transcribed once, before the turn, rather than handed to the turn's model as
an image: it works whichever model the Assistant page has selected, it stays
in the thread for later turns ("the phone number in that screenshot"), the
Assistant page shows it under a *Picture · transcribed* chip, and the
grounding guard treats a number read off the screenshot as something the
operator gave. The image bytes themselves are not kept. A picture that could
not be read (too big, download failed, vision model down) is stored as
`unreadable` with the reason and rendered as "a picture is attached that you
cannot see — …", and the prompt tells the model to ask rather than guess.
Video, audio and files are still only named as attached.

GLM 5.3 Flash was chosen from a side-by-side on an order-chat screenshot
against Qwen3.7 Flash, Qwen3-VL 8B/30B and Gemini 2.5 Flash Lite: the only
one that attributed lines to speakers and flagged cut-off text; ~2 s and
about USD 0.0003 a picture. `scripts/test-inbound-context.ts` covers the
rendering, a live read of `scripts/fixtures-order-chat.jpg`, and four
end-to-end turns through `/inbound`.

---

## Memory

A directory of short files under `/memories` (`agent_memory_files`), in two
tiers with one rule.

**`core/*.md`** is rendered in full into the system prompt on every turn, in
every conversation, for every operator — the page the assistant opens with.
Capped at 8,000 characters in total; a write that would exceed it is refused
with "move the detail to a client or procedure file", not trimmed. The four
memory blocks migrated here as `core/business.md`, `core/people.md`,
`core/suppliers.md`, `core/decisions.md`.

**Everything else** — `clients/<name>.md`, `suppliers/<name>.md`,
`procedures/<name>.md`, `log.md` — is listed by path every turn and read on
demand through the `memory` tool (Anthropic's six commands: view, create,
str_replace, insert, delete, rename). Never placed in the prompt.

**The rule: only what an operator said may enter memory.** Core content is a
standing instruction to the model, and the shop's rows are typed by customers,
so "remember this" is exactly what a planted order note wants. Enforced in
code, not asked for in the prompt:

- `assertOperatorSourced` (memory.ts) refuses a write whose text was lifted
  from an untrusted tool result the model can see — this turn's or an earlier
  turn's still in the transcript, or a compaction summary. "Lifted" means a
  28-character normalised window of the new text occurs in the data and does
  not occur in anything an operator typed. Paraphrase passes; copying a
  sentence out of an order note does not. If the operator wants the text kept,
  they type it and it passes.
- Trusted evidence is the operator's own messages in the thread plus the
  output of tools flagged `trustedOutput` — today only
  `list_operator_messages`, which returns operator-authored rows so the
  nightly reflection has a source it may record from. Everything else a tool
  returns is data.
- Every write records who made it (`createdBy` / `updatedBy`) and is an
  audited, undoable action: undo puts back exactly the file as it was, or
  removes a file that did not exist.
- Read-only operators never see the tool; admins on the dashboard and full
  operators do.

The Memory panel on the Assistant page lists the directory by folder, shows
each file's size and last writer, and edits or creates files; an admin's edit
is attributed to them.

`test:agent:memory` covers the store, the caps, the rule (lifted / paraphrase /
operator-quoted / short / punctuation), the tool end to end with evidence, and
undo — 42 checks. `test:agent:security` plants a "record this permanently in
your memory" note on an order and asks the model to do what it says; the
marker must never appear in a memory file.

---

## Routines

Three routines, switched on from the Assistant page (**Routines**), stored in
`settings`:

| key | what |
|---|---|
| `agent_morning_brief` / `agent_morning_brief_hour` | once a day, after the hour (default 8; a missing or blank hour row means the default — `readHour` in `schedule.ts`, because `Number(null)` is 0 and the brief once ran at midnight on production for that reason): the assistant reads orders, stock, the outbox and reminders and writes one plain-text message, which the harness sends to every active operator's DM and every allowlisted group with `morningBrief` on — chosen per row on the Routines panel (operators default on, groups off); recipients can only ever be on the WhatsApp allowlist |
| `agent_order_notify` | not scheduled — fires at the moment the order needs a person (`utils/order-notify.ts`): a manual-payment order (`WHATSAPP`, incl. the hosted proof-upload flow) on creation, from the end of `createOrder` — someone has to confirm the transfer; an online-gateway or crypto order on its `UNPAID → PAID` transition, from `applyPaid` — the customer settles on the gateway minutes after checkout and may not settle at all, and the guarded transition makes it once per order. One WhatsApp line (🛒 *New order* / ✅ *Order paid*) with number, customer, items, total, payment and the admin link, to every active operator and allowlisted group with `orderNotify` on. Written by code, not the model: immediate, identical, never wrong about the number. Preview and a test send on the panel; the test is the notice that order's method produces |
| `agent_nightly_reflection` / `agent_nightly_reflection_hour` | once a day after the hour (3am by default): reads what operators said (`list_operator_messages`) and what it did, then consolidates the memory directory — merges, expires, moves detail out of core/, appends to log.md |

Each runs in a thread of its own kind, visible on the page, at most once per
Malaysian day (`agent_*_last`), from a 5-minute tick in `server.ts`. A manual
run counts as the day's.

---

## Model

Chosen from the Assistant page (the **Model** menu in the header), stored in
`settings` as `agent_model`, `agent_escalation_model`, `agent_effort`, and
read at the start of every turn by `core/models.ts` — so one choice governs
the dashboard, WhatsApp and both routines, and takes effect on the next turn
with no restart. The environment (below) is the fallback for a fresh
database.

The catalogue (`AGENT_MODELS`) is OpenRouter ids with a one-line fit and
list prices per million tokens for the dropdown; the thread's actual cost
still comes from OpenRouter's own `usage.cost`. Everyday: DeepSeek V4 Flash
(recommended), Qwen3.7 Flash (cheapest), GLM 5.3 Flash (Chinese), DeepSeek
V4.1 Flash. Both roles: Gemini 3.8 Flash (long context), Kimi K2.5, MiniMax
M3 (long written replies), Claude Haiku 4.5 (no reasoning parameter — the
provider omits it), Claude Sonnet 5 (finance and customer-facing judgement).
Escalation: DeepSeek V4 Pro, Claude Opus 5. Any other OpenRouter id can be
saved through the API; it simply shows no price.

## Environment

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash   # fallback when agent_model is unset
OPENROUTER_ESCALATION_MODEL=                  # fallback when agent_escalation_model is unset
AGENT_REASONING_EFFORT=none                   # fallback; none | low | medium | high
AGENT_VISION_MODEL=z-ai/glm-5.3-flash         # reads pictures sent over WhatsApp
AGENT_GROUNDING_MODE=shadow                   # off | shadow | enforce
```

The `openai` package is gone; the provider is a streamed `fetch`.

---

## Tests

Unchanged commands, ported to the new tables:

```bash
npm run test:agent:tools       # 34 read tools against the dev db
npm run test:agent:writes      # 37 write scenarios, rolled back (incl. set_order_discount, set_order_items, create_order with discountRm)
npm run test:agent:memory      # 42 — the directory, the caps, the trust rule, undo
npm run test:agent:grounding   # 31 unit (one pre-existing failure: get_document has no precondition)
npm run test:agent:context     # compaction is size-based now; the fixture pads replies past 100k chars
npm run test:agent:security    # 10 — includes a planted "remember this" that must never reach memory
npm run test:agent:e2e         # 22 scenarios, real model; two are known to flake on model variance
E2E_ONLY=discount npm run test:agent:e2e   # just the scenarios whose name contains the string
npm run test:agent:inbound     # replies + pictures: 8 rendering, 1 live vision read, 4 e2e turns
npm run test:agent:grounding:e2e
npm run audit:agent:grounding  # replays the guard over stored turns; legacy turns match actions by time
```

The e2e suite's "money" scenario picks a priced, live variant on purpose — the
dev database has a variant literally coded `test` on a hidden product, and
"change the price of code test" sends the model looking for a discount code.
