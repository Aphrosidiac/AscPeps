# The assistant

Abby, from the dashboard and from WhatsApp, on one harness. This document is
the harness; [whatsapp-agent.md](whatsapp-agent.md) is the phone-specific
half (pairing, the allowlist, LIDs, groups, the guards' history) and stays
true.

Built 2026-09-18 by porting the Tapis assistant's architecture onto Ascend
MY's existing tools (87 today), and keeping what Ascend's WhatsApp-only agent
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
  core/vision.ts       reads a picture into text (AGENT_VISION_MODEL)
  core/media.ts        stores, identifies and delivers files, both ways
  core/extract.ts      reads a document into text (PDF, Word, sheets, slides)
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
| `assistant` | `{ text?, reasoning?, toolCalls?: [{ id, name, input, raw }], guard?, retracted?, provider? }` — `provider` is the OpenRouter host that served the step |
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

1. **Compact.** After every turn, once the reply is out, a thread past 40k
   characters of model-visible transcript is summarised into a system row
   that records which range it replaces — so the operator never waits for
   it. The kept tail is sized, not counted (`keepFor`: back from the newest
   to ~16k characters, 6–12 rows), so a recap leaves room and is not redone
   every turn. A thread past 100k at the start of a turn is recapped there
   too (the backstop). Rows are never deleted; the operator still sees the
   whole conversation. The cut moves back until the kept tail does not open
   on a tool result (`compactionEnd`), and the summary is rendered where its
   range began, not at its own (newest) seq. The recap leaves out what the
   assistant said about its own abilities — those change with the software.
2. **Route.** `routeDomains` over the operator's last three messages (not
   Abby's replies — routing on her own words changed the tool list on 76% of
   group turns) picks the areas whose tools and business rules the model
   gets. `load_context` widens it mid-turn and returns the new areas' rules
   with their tools; `CORE_TOOL_NAMES` are always there, including the money
   reads (`run_report_query`, `describe_database`, `month_end_report`,
   `finance_overview`) that "calc", "check again" and follow-ups need.
3. **Build the prompt.** Static prompt · memory (core/ in full, the rest
   listed) · the transcript in wire form, with this turn's business rules
   just before the operator's latest message · live brief (who, channel,
   time, store switches). Ordered for the provider's prefix cache: the tool
   list and everything up to the previous turn stay byte-identical while the
   subject does, so they are served from cache. Rules ahead of the whole
   transcript threw its cache away on every change of subject; after the
   latest message they were followed less (the comparison eval dropped its
   links). A thread's `cacheReadTokens` is the part of `inputTokens` served
   from cache.
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
   - A write already made this turn with the very same arguments is refused,
     not run again, and the refusal tells the model to change its arguments or
     stop. After two such refusals the model gets no more tools and is told to
     say exactly what changed and what did not (GLM 5.3 Flash, 10-11 Oct 2026:
     forty identical notes-only `update_order` calls while it believed it was
     marking an order paid).
   - Past 30k output tokens the model is told to wrap up; on the last step it
     gets no tools.
5. **Guard the answer.** When a step returns text and no calls:
   - **Write guard.** A completion claim (`CLAIMS_COMPLETION`) with no
     successful write this turn is replaced. Writes approved between the last
     operator message and now count — the resumed turn after an approval is
     allowed to say "done".
   - **Memory guard.** A promise to remember (`CLAIMS_MEMORY`: "noted for
     good", "I'll remember", "memorised", "from now on I'll…") with no memory
     file changed this turn gets one repair — the draft is retracted and the
     model is told to save it with the memory tool or drop the claim; if it
     still has not, the reply says plainly it was not saved. Four such
     promises on the group's history were never kept (21 Oct 2026).
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

### A well-formed request, always

A tool call with no result, or a result with no call, is a 400 from every
provider on the OpenAI wire — and the next turn rebuilds the same transcript,
so one broken pair would take a thread down for good (a WhatsApp thread is
one per chat, forever). `toWire` ends in `pairToolMessages`: each call's
results go straight after it, an unanswered call is dropped from the
message, a result with no call is dropped. That is the last line; the store
should not hold a broken pair in the first place:

- **Compaction** never cuts between a call and its result (above).
- **A restart mid-turn** (a deploy, a crash) leaves the thread marked
  `running` and can leave calls with no stored result. `repairInterruptedTurns`
  runs at boot over every thread still marked running, and before a new turn
  on one. Each unanswered call gets what actually happened, from
  `agent_actions` (written when a tool finishes): a finished write its real
  result, a failure its error, a parked action "waiting on approval", and a
  call with no record "may or may not have taken effect — check before running
  it again" (a read: "run it again"). Then a system row — "The server restarted
  in the middle of this reply, so it stopped here." — and the thread is idle.

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
`update_insight`, `set_profit_shared`, `save_attachment_as_document` (removes
the filed document, not the file in the chat), and every `memory` command.
Anything that goes through an admin controller with side effects (order status, emails,
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
Video and audio are still only named as attached; documents are read (see
*Files*).

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

Four routines, switched on from the Assistant page (**Routines**), stored in
`settings`:

| key | what |
|---|---|
| `agent_morning_brief` / `agent_morning_brief_hour` | once a day, after the hour (default 8; a missing or blank hour row means the default — `readHour` in `schedule.ts`, because `Number(null)` is 0 and the brief once ran at midnight on production for that reason): the assistant reads orders, stock, the outbox and reminders and writes one plain-text message, which the harness sends to every active operator's DM and every allowlisted group with `morningBrief` on — chosen per row on the Routines panel (operators default on, groups off); recipients can only ever be on the WhatsApp allowlist |
| `agent_order_notify` | not scheduled — fires at the moment an order needs a person (`utils/order-notify.ts`), two notices of one shape. **Placed**: a manual-payment order (`WHATSAPP`, incl. the hosted proof-upload flow) on creation, from the end of `createOrder`, headed *NEW ORDER · AWAITING PAYMENT* — it is not a sale yet, someone has to confirm the transfer. **Paid**: any order, whatever the method, on its `UNPAID → PAID` transition, headed *ORDER PAID* — `applyPaid` for an online-gateway or crypto order (the customer settles on the gateway minutes after checkout, and may not settle at all, so those get no notice at creation), or someone marking a manual order paid (the order page, or `mark_order_paid`); both transitions are guarded, so an order is announced paid once. The line carries number, customer, items (an included supply shown under its product), total, payment and the admin link, to every active operator and allowlisted group with `orderNotify` on. Written by code, not the model: immediate, identical, never wrong about the number. An operator replying "Paid" to a notice is the confirmation — the assistant calls `mark_order_paid` with the order from the quoted notice. The panel previews both notices (the latest manual order as placed, the latest paid order as paid) and can test-send the latest order's notice as it stands, ignoring the master switch |
| `agent_month_end` / `agent_month_end_hour` | on the 1st after the hour (default 9; the 2nd and 3rd are a catch-up window, never later): the month just ended, written by code in `utils/month-end.ts` — revenue vs the month before, placed/paid/unpaid/failed, costs and profit over costed orders (uncosted ones named), each partner's earnings that month from the same `costOrder`/`allocate` as Analytics and their owed-to-date from `computeFinance`, orders still unpaid or paid-not-shipped, units sold (included supplies counted apart) and every variant under the restock line. Sent to operators/groups with `monthEnd` on; `agent_month_end_last` holds the month (YYYY-MM) last sent. The panel previews or sends any of the last six months; the assistant reads the same text through `month_end_report`. Stock comes before any section naming an order, because the grounding guard ties a product name to the nearest order number above it |
| `agent_nightly_reflection` / `agent_nightly_reflection_hour` | once a day after the hour (3am by default): reads what operators said (`list_operator_messages`) and what it did, then consolidates the memory directory — merges, expires, moves detail out of core/, appends to log.md |

The brief and the reflection each run in a thread of its own kind, visible on
the page, at most once per Malaysian day (`agent_*_last`), from a 5-minute tick
in `server.ts`. A manual run counts as the day's.

The restock line is `RESTOCK_BELOW` in `utils/restock.ts` (5): a variant needs a
reminder under 5 units and not otherwise. The dashboard, `list_low_stock`,
`inventory_report`, the brief's prompt and the wrap all read it.

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

**Who serves it.** A model id names a model, not a host: OpenRouter routes
each call to one of dozens of upstream providers (different quantisations,
different tool-call parsers) and keeps a long prompt on the same one for its
cache, so one bad host fails the same thread every time. Every request (chat,
vision, PDF OCR) carries `provider.ignore` from `AGENT_PROVIDER_IGNORE`, and
each stored assistant step records `provider`. 14 Oct 2026: inference-net's
GLM 5.3 Flash never emitted an optional enum argument. `update_order` arrived
notes-only (no `status`, no `paymentStatus`) on every call, which caused both
the 10–11 Oct "Paid" loop and the 14 Oct "mark delivered" failure. All other
GLM hosts set the field. When a model drops arguments, force each host with
`provider: { only: [tag], allow_fallbacks: false }` before blaming the prompt.

## Files (Oct 2026)

Abby reads files, sends files, and keeps the books from them — over WhatsApp
and on the Assistant page.

**In.** The worker downloads any picture or document sent to it (size checked
against the protobuf's `fileLength` before downloading: 10 MB pictures,
`AGENT_MAX_FILE_MB` documents) and relays it as base64. `core/media.ts` stores
it in `agent-media/` (private, never served statically), identifies it from
its bytes, and `core/extract.ts` reads it once:

| Type | How | Cost |
|---|---|---|
| PDF with a text layer | `unpdf`, page by page | free |
| Scanned PDF (< 40 chars/page) | OpenRouter file-parser, `mistral-ocr` (≤ 40 pages) | ~USD 0.002/page-set |
| Word (.docx) | `mammoth` → HTML → text, tables as `a \| b` rows | free |
| Excel/ODS/CSV | SheetJS, every sheet, one row per line | free |
| PowerPoint (.pptx) | slide XML via JSZip | free |
| Text / HTML | decoded; HTML tags stripped | free |
| Picture | vision model, as before (HEIC sent as a file is refused) | ~USD 0.0003 |

The text is stored on the `agent_media` row; the operator's message carries the
first 8,000 characters and a `mediaId`. `read_attachment` searches the whole
file (`query`) or pages through it — the model is told never to say a file
lacks something until a search came back empty. The same file twice in a
thread (a reply re-sends it) reuses the first reading. Bytes are purged after
`AGENT_MEDIA_RETENTION_DAYS`; the row and text stay.

**Out.** `send_file` sends into the chat the request came from: a filed
document, an order receipt (generated), a catalogue photo (converted to JPEG
unless it already is JPEG or PNG — WhatsApp shows WebP as a sticker), an
earlier file, or a spreadsheet built from a read-only SQL query (`runReadOnlyQuery`, up to 10,000 rows — the database
fills the file, the model never transcribes rows). `forward_file` reaches
another allowlisted operator or group only, and parks for a yes. Files never
go to customers, and nothing produces a link. The worker's loopback `/send-file`
(bearer token, like `/send`, which carries the text of reminders, notices and
routines) does the upload; both answer 409 while the agent is switched off or
WhatsApp is not connected. A reply claiming a send with nothing sent is replaced
(`CLAIMS_FILE_SENT`); a sent file counts as done for the write guard.

**Bookkeeping.** `record_expense` takes `receiptMediaId`: the receipt is
checked first (in this conversation, still stored, fileable, not already
filed), then the expense is recorded and the receipt filed against it; if
filing fails the expense is deleted again. `save_attachment_as_document` files
anything else (statements, quotations, slips) against orders/expenses. The
document store takes PDFs, pictures, Word, Excel/CSV, PowerPoint and text
from chat (`FILEABLE_FROM_CHAT`; non-inline types are always served as
downloads). `documents.sha256` refuses the same file twice and says where it
is filed — the second copy of a receipt is how an expense gets booked twice.
The `bookkeeping` playbook (finance + documents domains, auto-loaded when a
message carries a file) tells the model to read a bare bill, propose the one
entry, and wait for a yes.

In a group with `requireMention`, a file is only downloaded when the message
tags Abby (in the caption) or replies to the file tagging her — the same gate
as text.

---

## Time (Oct 2026)

The database stores UTC; the business runs on Malaysia time (UTC+8). The model
never sees UTC: `modelJson()` (tool-kit.ts) rewrites every ISO-UTC timestamp in
a tool result to `…+08:00`, at every point a result reaches the model (live,
history, guard evidence, approval notes). Raw SQL is where it can still go
wrong — `describe_database` spells out the shift (`"createdAt" + interval '8
hours'`) and `timezoneWarning()` flags a query that compares a timestamp to a
bare date or buckets it by day without the shift. `sales_breakdown` buckets in
Malaysian days; spreadsheet exports print Malaysia time. Incident: 6 Oct 2026,
`"createdAt" < '2026-10-01'` ticked ASC2610/0001 (02:35 on 1 Oct MYT) as a
September order. `npm run test:agent:timezone` replays it.

---

## The browser (Oct 2026)

Abby has a real web browser, from every chat: open sites, search, read pages,
click, type, scroll, tabs, screenshots. The operator watches it live in the
**Browser** panel of the Assistant page (it opens by itself the first time
Abby browses in a turn) and can **Take control** — their own clicks, scrolling
and typing go straight to the page. That is also how a site that needs a login
gets one: the operator signs in there; a password never passes through the
conversation. Off unless `AGENT_BROWSER=on`.

Over WhatsApp (DMs and groups) there is no live view, so every screenshot she
takes is sent into the chat it was asked from, with the page address as the
caption, while the vision model reads it — no extra wait, and no send_file
step for the model to forget. A blank tab is not sent. The same guards hold:
once a page has been read, shop changes park for the usual WhatsApp yes/no.

```
  Assistant page ── Browser panel ──SSE frames / POST input──▶ assistant.routes.ts /browser/*
                                                                         │
  core/run.ts ──▶ tools/browser.tools.ts ──▶ core/browser.ts ─────────────┘
                  (19 Playwright MCP tools,    lifecycle, lock, idle, viewers
                   guards, screenshots)              │ fork + IPC, only while awake
                                                     ▼
                                               core/browser-worker.ts
                                               @playwright/mcp in-process + playwright-core
                                               (screencast, operator input)
                                                     │ CDP 127.0.0.1:9222
                                                     ▼
                                               headless Chromium
                                               VPS: abby-browser.service (ops/abby-browser)
```

- **Tools.** `@playwright/mcp`'s own tools, run inside the worker over an
  in-memory transport: accessibility snapshots with element refs are what let a
  text-only model click the right thing. `tools/browser.allowlist.ts` is the
  list; left out are `browser_run_code_unsafe` (runs code in the API process),
  `browser_file_upload` / `browser_drop` (hand a page a file off the server),
  `browser_pdf_save`, close/resize (the live view owns the window), and the
  console/network developer tools. The
  schemas are a checked-in snapshot (`tools/browser.schemas.ts`, regenerate
  with `npx tsx scripts/browser-tool-schemas.ts`) so nothing Playwright loads
  until someone browses. Actions return the page's address and title only;
  `browser_snapshot` reads the page (cut at 14,000 characters). Only http and
  https open — `file://` and `chrome://` would show the server.
- **What the model reads.** Plain text, not JSON (`toModel`), with a one-line
  untrusted marker. Snapshots are squeezed (`squeezePage`): empty containers
  and `[cursor=pointer]` go, search-engine redirects are decoded back to the
  real address (DuckDuckGo `uddg=`, Bing `u=a1…`, Google `/url?q=`; Google's
  opaque `/goto` blobs become a one-line note), tracking parameters drop.
  Measured on real pages from the VPS: Google results 25k → 14k characters,
  DuckDuckGo 17k → 9k, a shop page 37k → 26k; every clickable ref kept.
  Playwright's console report ("### Events") is stripped — noise, and it named
  a file on the server.
- **Searching.** The playbook sends Abby to DuckDuckGo's HTML results first
  (light, real addresses), Google when the results themselves must show
  prices, Bing if an engine shows a check page — always by opening the results
  URL, never by typing into a search box — and asks for about six browser calls
  a task, answers from the results page when it already shows what was asked.
- **Walls, from this server's address** (measured 20 Oct 2026): Shopee
  (traffic verification, or a bounce to a blank page / its home page), Lazada
  (never finishes loading), Reddit (403). `blockedBy()` flags these and
  Cloudflare / Google checks in the result itself ("BLOCKED: … do not retry");
  a timeout says the same. Abby never attempts a CAPTCHA — she hands it to the
  operator (Take control).
- **Crashes.** A tab the kernel kills at the memory cap is closed through
  MCP's own tab tool and replaced; a navigation that hit it is retried once on
  the fresh tab. Chrome runs with site isolation off (one profile, no sign-ins
  to protect), two renderers, a 256 MB script heap, and media refused at the
  network: a news page with a dozen ad frames broke the 600 MB cap before.
- **Routing.** Marketplace and research words (Shopee, Lazada, competitor,
  news, studies, pubmed, poslaju…) and any web address in the message load the
  browser; "website" does not — in this shop's chats it means Ascend's own
  store (6 of 8 hits over the 538 real operator messages). 2 of 538 real
  messages load it now, both genuine; anything else is one `load_context` away.
- **Web pages are untrusted.** Every result is marked `UNTRUSTED WEB CONTENT`.
  Once any web page has been in a thread, **every write tool parks for
  approval** for the rest of that thread (run.ts, `webSeen`) — the approval
  card says why. A page is written by whoever wants it to be.
- **Shop data does not leave without a yes.** A browser call that would send a
  phone or account number, an email address, an order number, or a sentence
  lifted from the shop's own tool results — and not typed by the operator —
  parks for approval (`exfiltrationReason`). Text from one web page typed into
  another is fine.
- **Screenshots** are kept as a file in the thread (`agent_media`, source
  `browser:screenshot`, shown on the tool card, sendable with `send_file`) and
  read into text by `AGENT_VISION_MODEL`, because the everyday model is
  text-only.
- **History.** Only the last two page results stay whole in the transcript;
  earlier ones fold to their address and title.
- **One driver.** One conversation holds the browser while its turn runs
  (released when the turn ends; a two-minute hold if a turn dies without
  ending); one action at a time. Browser tools have a 60 s timeout — waking
  the browser and a slow page can take most of a minute.
- **Honesty guard.** "Done!" after a screenshot is about the browsing: a turn
  that only browsed is not held to the write guard's opener check, but "the
  price has been updated" is still caught (`CLAIMS_CHANGE`).
- **Lifecycle.** Started on the first call (`BROWSER_START_CMD`), stopped after
  `BROWSER_IDLE_MINUTES` with no call and nobody watching (30 minutes while
  watched). A browser killed by its memory cap is started again on the next
  call. At boot the API stops any browser the previous process left running
  (`sleepOrphanedBrowser`). Each start is a clean profile: nothing survives a
  sleep, sign-ins included.
- **On the VPS** (`ops/abby-browser/`, `install.sh` then `check.sh`): its own
  `abby-browser` user, Playwright's Chromium with its sandbox on (an AppArmor
  profile allows the user namespaces Ubuntu 24.04 otherwise refuses),
  `MemoryMax=600M`, `OOMScoreAdjust=900` so it dies before anything else,
  `ProtectHome` (it cannot read the API's `.env`), and an iptables chain on its
  uid that refuses localhost (Postgres, Redis, the API), the private and
  link-local ranges (cloud metadata), and the box's own public address. The API
  may only `systemctl start|stop abby-browser` as root (`sudoers`).
- **Memory.** Playwright costs ~120 MB the moment it is imported and never
  gives it back, so it is not in the API process: `core/browser-worker.ts`
  (built to `dist/browser-worker.js`) is forked when the browser wakes and
  exits when it sleeps. Asleep, the browser costs the box nothing.

---

## Environment

```bash
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=deepseek/deepseek-v4-flash   # fallback when agent_model is unset
OPENROUTER_ESCALATION_MODEL=                  # fallback when agent_escalation_model is unset
AGENT_REASONING_EFFORT=none                   # fallback; none | low | medium | high
AGENT_PROVIDER_IGNORE=inference-net            # OpenRouter hosts never routed to; empty = any
AGENT_VISION_MODEL=z-ai/glm-5.3-flash         # reads pictures sent over WhatsApp
AGENT_GROUNDING_MODE=shadow                   # off | shadow | enforce
AGENT_MAX_FILE_MB=20                          # largest document taken in (worker reads it too)
AGENT_MEDIA_RETENTION_DAYS=90                 # how long chat files keep their bytes
AGENT_BROWSER=off                             # on = Abby's web browser (every chat)
BROWSER_CDP_URL=http://127.0.0.1:9222
BROWSER_START_CMD=                            # VPS: sudo -n systemctl start abby-browser · laptop: sh scripts/browser-local.sh start
BROWSER_STOP_CMD=                             # VPS: sudo -n systemctl stop abby-browser  · laptop: sh scripts/browser-local.sh stop
BROWSER_IDLE_MINUTES=5
```

The `openai` package is gone; the provider is a streamed `fetch`.

---

## Tests

Unchanged commands, ported to the new tables:

```bash
npm run test:agent:tools       # 36 read tools against the dev db (the file tools are left to test:agent:files)
npm run test:agent:writes      # 38 write scenarios, rolled back (incl. set_order_discount, set_order_items, the supplier price list)
npm run test:agent:memory      # 42 — the directory, the caps, the trust rule, undo
npm run test:agent:grounding   # 32 unit
npm run test:agent:context     # 30 — routing, money reads always on, load_context rules, memory-claim regex on real replies, sized recap tail, compaction past 100k; real model: load_context, "from now on" is saved, a memory rule does not veto an operator, an old "I can't browse" does not stick
npm run test:agent:security    # 10 — includes a planted "remember this" that must never reach memory
npm run test:agent:e2e         # 26 scenarios, real model; two are known to flake on model variance
E2E_ONLY=discount npm run test:agent:e2e   # just the scenarios whose name contains the string
npm run test:agent:inbound     # replies + pictures: 8 rendering, 1 live vision read, 4 e2e turns
npm run test:agent:wire        # 29, no model or db — call/result pairing, the compaction cut, summary placement, restart repair
npm run test:agent:files       # 56 — every format, storage, send/forward/file/record tools, 16 real-model turns incl. bookkeeping
npm run test:agent:browser     # 68 — schema snapshot, URL/exfiltration guards, walls, routing from real messages, link decoding, squeeze, page folding; live: open, click by ref, live view, input, lock hand-over, crash recovery, restart
EVAL_TOKEN=<admin jwt> npx tsx scripts/eval-agent-browser.ts   # 12 real-model scenarios graded on tools, steps, time, cost, facts, sources and guards
npm run test:agent:grounding:e2e
npm run audit:agent:grounding  # replays the guard over stored turns; legacy turns match actions by time
```

The e2e suite's "money" scenario picks a priced, live variant on purpose — the
dev database has a variant literally coded `test` on a hidden product, and
"change the price of code test" sends the model looking for a discount code.
