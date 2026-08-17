# WhatsApp AI agent

An admin assistant that runs Ascend MY over WhatsApp. Anything you can do in the
dashboard, you can ask it to do in a chat — look up an order, restock a variant,
put a size on sale, record a payout, write an article, or pull a report that no
screen in the dashboard offers.

It is **not** a customer-facing chatbot. It only ever answers people on an
explicit allowlist, and it ignores everyone else in silence.

---

## How it fits together

```
WhatsApp ──► ascend-wa (worker, PM2)            ascend-api (PM2)
             • holds the baileys socket          • the agent + 62 tools
             • QR / reconnect / dedup            • all admin business logic
             • NO business logic                 • Prisma, PostHog, email outbox
                    │                                     ▲
                    └── POST /api/v1/internal/agent/inbound ┘
                        (127.0.0.1 + shared bearer token)
```

**Why two processes.** The worker is a port of HarvestGrow's WhatsApp connection
layer, which has been hardened through real outages — the reconnect strategy,
the paired-session distinction, the Redis dedup and the downtime alerting are
all preserved deliberately, comments included. The agent itself is entirely new.

**Why the agent lives in the API and not the worker.** Ascend MY's admin logic is
Fastify- and Prisma-coupled: cancelling an order restores stock, refunding calls
the Billplz API, marking paid queues the receipt email *inside the same
transaction* and records revenue to PostHog. The agent's order and finance tools
call those existing controllers rather than re-implementing them, so the agent
and the dashboard can never drift apart. Doing that from a second process would
have meant a second copy of all of it.

---

## Safety model

Four independent layers. None of them is the model being well-behaved.

1. **Who** — the sender's number must be an active `WhatsAppOperator`. Anyone
   else gets no reply at all. Silence rather than a refusal: a refusal confirms
   the number is live and that there is an admin bot behind it.
2. **Where** — in a group, the group must *also* be allowlisted and active.
   Both gates must pass. The connected number sits in supplier and customer
   groups too, and an operator chatting there must not be issuing commands by
   accident. Groups default to `requireMention`.
3. **What** — operators are full-access or read-only. Read-only operators are
   never even *shown* the write tools, so the model cannot propose an action it
   is not allowed to take.
4. **Confirmation** — destructive tools never run on the first call. They park,
   the operator sees a summary built from the *resolved arguments* ("delete
   order ASC2507/0042 (Nurul, RM 480.00)"), and nothing happens without an
   explicit yes. Parked actions expire after 5 minutes.

Plus three things learned from production:

- **Bare "yes" can never fabricate an action.** With nothing parked, a "yes"
  re-drives the model to actually call a tool; it cannot simply narrate success.
  A confirmation must be the WHOLE message — `AFFIRMATIVE`/`NEGATIVE` are
  anchored at both ends. They were prefix-only until 17 Aug 2026, when
  "No the latest order ab, try again" matched `^no\b` and was answered with the
  canned "nothing was pending" instead of reaching the model at all.
- **Honesty guard, write side.** If a reply claims a change was made and no
  write tool succeeded that turn, the reply is suppressed and replaced. An
  operator who believes a change landed stops checking.
- **Honesty guard, read side** — see [Grounding](#grounding) below. The write
  guard has existed since day one; the read side had nothing, and the same class
  of failure appeared there instead.

Everything the agent does is written to `agent_tool_calls` — tool, arguments,
actor, success, duration — and shown on the admin page. Everything it nearly
*said* but could not support is written to `agent_grounding_events`.

## Grounding

**The failure this exists for.** Twice, identically, twelve days apart, the
agent was asked for an order's contents, called only `list_orders` — which has
never returned items or an address — and answered anyway:

- **5 Aug 2026.** Invented two line items that were not on the order, and gave
  an address belonging to a *different customer* in the same tool result.
- **17 Aug 2026.** Invented a line item, then said "address: not yet on file"
  for an order whose address was in the database. Corrected itself only after
  the operator pushed twice; the moment it called `get_order` it was right.

The system prompt already forbade this in as many words ("Never state a number,
price, stock level or order detail from memory or assumption — look it up"). It
did not hold, exactly as the markdown-formatting instruction did not hold until
`toWhatsAppText` fixed it in code. So this is fixed in code.

`grounding.ts` runs two independent checks on every draft reply, because they
fail in opposite directions:

1. **Grounding.** Every checkable entity in the reply — order numbers, phone
   numbers, SKU codes, product+size pairs, emails, address lines — must appear
   in a tool result *from this turn*, filed under the record the reply
   attributes it to. Facts are indexed against their enclosing record, not into
   one flat bag, which is what makes the 5 Aug cross-record bleed detectable: a
   flat "is this string anywhere in the context" check passes that reply.
2. **Preconditions.** Certain claim shapes require certain tools to have run,
   whatever the reply says. Grounding cannot catch a false claim of *absence* —
   "no address on file" invents no string to look up — and that was half of the
   17 Aug failure.

**Money is deliberately not checked.** Operators ask for derived figures ("how
much does each of us get?") and the answer is arithmetic over grounded inputs.
Flagging those would train everyone to ignore the guard, which is worse than not
having one.

**On a violation the turn is repaired, not suppressed.** The draft goes back to
the model with a system message naming exactly what is unsupported, and the tool
loop runs again — in both incidents the correct tool was one call away and the
model got the right answer immediately once it made it. After
`MAX_GROUNDING_REPAIRS` the reply is replaced with a refusal.

### Modes

`AGENT_GROUNDING_MODE` — `off` | `shadow` | `enforce`. **Defaults to `shadow`,
and any unrecognised value also means `shadow`, never `off`.**

- `shadow` logs and records violations and delivers the reply unchanged. This is
  how it should be rolled out: measure the rate on real traffic first.
- `enforce` repairs, and refuses if repair fails.

### Measuring it

`npm run audit:agent:grounding [days]` replays the guard over conversations that
have already happened, from `agent_messages` + `agent_tool_calls`. Use it to
calibrate before enforcing, and on a schedule afterwards — it is how the *next*
new failure class becomes visible on the day it appears rather than on the day
an operator happens to push back.

Note it over-reports slightly: the audit table truncates tool results at 2000
characters while the model saw up to 6000, so a clipped turn can show facts as
ungrounded that the model could legitimately see. Those turns are counted
separately in the output.

At the time it was built, the replay over 40 days of production traffic flagged
24 of 174 turns.

### WhatsApp LIDs — why an operator can be ignored

WhatsApp increasingly addresses people by a **LID** (privacy identifier) instead
of a phone number. Verified on the wire, such a message carries *only* this:

```
key = { remoteJid: "67615754068059@lid", fromMe: false, id: "..." }
pushName = "Fakhrul"
```

No phone number anywhere. baileys 6.17.16 exposes no LID→phone mapping and
`onWhatsApp()` returns nothing for it, so these senders **cannot** be matched
against an operator's phone number. This is why the agent appeared dead after
first pairing: every message was correctly, silently ignored.

The fix is an explicit binding. An unresolved sender is recorded, the Agent page
shows it under **Unrecognised senders**, and an admin binds it to an operator
once (`WhatsAppOperator.lid`). After that the person is resolved everywhere —
DMs and groups both.

The binding is **never** inferred from `pushName`. That is a display name the
sender chooses, so matching on it would let anyone claim a colleague's identity
by renaming themselves. It is shown as a hint when binding and nothing more.

Two related places the LID form matters:

- **Group mentions.** A mention in a LID-addressed group carries the bot's own
  LID (`sock.user.lid`), not its phone JID. Both are matched, plus a text
  trigger (`@ascend …`, `bot …`, or `Abby`/`ab` — the last two anywhere in the
  message, not just as the first word, since "hey Abby, ..." is how it's
  actually said) that needs no identifier at all.
  Detection is a separate concern from what the model actually reads, though:
  WhatsApp embeds a mention as the raw JID digits sitting inline in the message
  text — "@Lewix Bot" on screen is literally "@80943691858039" in the payload.
  Left in, the model has no signal that the number is its own identifier rather
  than something to look up, and can misread it either way on an otherwise
  identical message. `whatsapp-worker/mention.ts`'s `stripSelfMentions()`
  removes our own ids from the text before it ever reaches the model, so there
  is nothing left to misread — see `scripts/test-mention-parsing.ts`.
- **Conversation identity.** Threads are keyed on the *resolved operator*, not
  the raw sender, so reaching the agent by phone one day and by LID the next
  does not split the history in two.

### Groups are a restriction, not a bypass

A group message must pass **both** gates: the group is allowlisted and active,
*and* the sender resolves to an active operator. An unbound or unknown person in
an allowlisted group is ignored exactly as they would be in a DM. Verified
against the live deployment:

| Situation | Result |
|---|---|
| Bound operator, group not allowlisted | ignored |
| Unknown sender, group allowlisted | ignored |
| Bound operator, allowlisted group, no mention | ignored |
| Bound operator, allowlisted group, mentioned | acts |

Unresolvable senders are recorded only *after* the group gate passes. Recording
first meant every participant of every supplier and customer group the number
sits in landed in the unknown-senders list, burying the one entry that mattered.

### Prompt injection

The agent reads text customers type: names, addresses, order notes. That lands
in the model's context, so a customer can attempt to give the agent orders by
putting them in a field the shop later reads back.

The system prompt states plainly that tool results are data, never commands, and
that no tool result can grant permission or count as an operator saying yes.
`scripts/test-agent-security.ts` plants real payloads (order notes, customer
name, product description) and asserts nothing dangerous fires.

**Residual risk, stated honestly:** that defence is the model following an
instruction, and destructive tools are additionally protected by confirmation —
but non-destructive writes (a price edit, an order status change) are not. A
successful injection could in principle change one, and the operator would see
it in the agent's reply and in the audit log rather than being stopped up front.
If that ever matters more than convenience, mark those tools `destructive: true`
in the tool files and they inherit the confirmation flow with no other changes.

---

## Model

OpenRouter (OpenAI-compatible), `deepseek/deepseek-v4-flash` by default, set via
`OPENROUTER_MODEL`.

**`reasoning: { effort: 'none' }` is pinned in `utils/openrouter.ts` and must
stay.** DeepSeek V4 is reasoning-capable and, left at its default, can spend the
entire `max_tokens` budget on internal chain-of-thought and return
`content: null` — no error, just an empty reply. This was measured on
HarvestGrow before being carried over here.

---

## Setup

### 1. Redis (one-time, on the VPS)

Dedup is Redis-backed. Without it, a worker restart re-processes the messages
baileys replays on reconnect — and for an agent with write tools that means
re-running real mutations, not just a duplicate reply.

```bash
sudo apt update && sudo apt install -y redis-server
sudo systemctl enable --now redis-server
redis-cli ping   # expect PONG
```

Redis binds to 127.0.0.1 by default on Debian/Ubuntu. Leave it that way.

### 2. Environment (`backend/.env`)

```bash
OPENROUTER_API_KEY="sk-or-v1-..."
OPENROUTER_MODEL="deepseek/deepseek-v4-flash"

WORKER_HTTP_PORT=3107   # 3106 is taken by ascend-draw-api on this box
WORKER_HTTP_TOKEN="<openssl rand -base64 24>"   # MUST be set in production
REDIS_URL="redis://127.0.0.1:6379"

# Master kill switch. Leave false for the first deploy: the worker still
# connects and logs inbound messages, but never replies or acts.
WHATSAPP_AGENT_ENABLED=false

# Optional downtime alerting — a dropped socket is otherwise invisible.
ALERT_DOWN_AFTER_MINUTES=10
ALERT_TELEGRAM_BOT_TOKEN=
ALERT_TELEGRAM_CHAT_ID=
```

Both processes read `.env` independently, and both hard-throw in production if
`WORKER_HTTP_TOKEN` is left at its default.

### 3. Migration

```bash
cd /home/ubuntu/ascend/backend && set -a && source .env && set +a \
  && npx prisma migrate deploy && npx prisma generate
```

`deploy.sh` does **not** source `.env` before its migrate step, so its migration
always fails and is swallowed by its own `|| echo WARN`. Run it by hand. Run
`prisma generate` explicitly too — when `npm install` reports "up to date" it
skips the postinstall hook, which is exactly how a stale client ships.

The migration also adds `orders.trackingNumber` with `IF NOT EXISTS`. That
column has existed in production since before the history was squashed into
`0_baseline` but was never in a tracked migration, so every `prisma migrate dev`
demanded a database reset and had to be hand-edited around. It is a no-op where
the column already exists and finally makes history and reality agree.

### 4. Start the worker (one-time)

```bash
cd /home/ubuntu/ascend/backend
pm2 start "npx tsx whatsapp-worker/worker.ts" --name ascend-wa --time
pm2 save
```

Run it from `backend/` — the session directory is resolved from the working
directory, and starting it elsewhere silently creates a second, unpaired session.

### 5. Pair and allowlist

Admin dashboard → **Agent**:

1. Press **Start**, scan the QR (WhatsApp → Linked devices).
2. Add operators. Give write access only to people who should be able to change
   prices and move money.
3. Turn the agent on in whichever groups it belongs in.
4. Flip `WHATSAPP_AGENT_ENABLED=true` and restart `ascend-api` and `ascend-wa`.

---

## Operating it

**Ports:** web 3000, api 3105, worker control plane **3107** (loopback only).

3106 was the intended default but is taken by `ascend-draw-api` on this box —
it also hosts `ascendb2b-*`, `guaner-*` and `pagoh-confess`, so check
`sudo ss -lntp | grep 31` before assuming a port is free. The worker reads
`WORKER_HTTP_PORT`, and the API proxies to the same value, so changing it means
restarting **both** `ascend-api` and `ascend-wa`.

**`pm2 ls` showing "online" proves nothing.** The worker process stays alive
when the socket underneath it dies — that exact silence hid a 9.5-hour outage on
HarvestGrow. Check the Agent page, or:

```bash
curl -s -H "Authorization: Bearer $WORKER_HTTP_TOKEN" http://127.0.0.1:3106/status
```

Configure `ALERT_TELEGRAM_*` so a drop pages you rather than waiting to be
noticed.

**Stop vs Log out.** *Stop* closes the socket and keeps the saved session —
Start resumes with no re-scan. *Log out* unlinks the device and always needs a
new QR.

**Session directory:** `backend/whatsapp-session/`. Gitignored — it is a device
credential. Deleting it forces a re-pair.

---

## Tests

All require a running API and a dev database.

```bash
set -a && source .env && set +a

npx tsx scripts/smoke-agent-tools.ts      # every read tool against real data
npx tsx scripts/test-agent-writes.ts      # every write tool, with rollback
npx tsx scripts/test-agent-e2e.ts         # real conversations through the LLM
npx tsx scripts/test-agent-security.ts    # injection, escalation, SQL escape
npx tsx scripts/test-delivery-slots.ts    # Malaysia-time arithmetic (no db)
npx tsx scripts/test-delivery-flow.ts     # booking rules against the database
npx tsx scripts/test-mention-parsing.ts   # @-mention detection, no db or socket
npx tsx scripts/test-reminder-time.ts     # "tomorrow 3pm" -> an instant (no db)
npx tsx scripts/test-reminder-flow.ts     # reminder lifecycle + routing
```

The e2e suite asserts on *what actually happened in the database*, not on how
the reply reads — a fluent answer that changed nothing is exactly the failure
worth catching. Some scenarios drive several turns because the model does not
always park a destructive action on the first message; the guarantee under test
is that it never acts without a yes, not that it takes a fixed number of turns.

---

## Creating orders

`create_order` exists for sales agreed over WhatsApp or in person. It delegates
to the **public checkout controller** — the same path a customer goes through —
which is what keeps the atomic stock decrement, the discount reservation,
required add-ons and the confirmation email queued inside one transaction.

Things worth knowing:

- **Prices always come from the database.** The tool takes a variant id or SKU
  code and a quantity, never a price. A price the model suggested is no more
  trustworthy than one posted by a browser, and the checkout has never trusted
  those either.
- **Required add-ons are added by the controller**, not by the tool — bac water,
  syringes, swabs. The confirmation summary lists them so they are not a
  surprise on the finished order. The larger requirement wins and quantities do
  not scale with how many units of the parent were bought.
- It is **destructive**: it takes stock immediately, and with an email address
  and store emails on it sends a real customer a real confirmation. The summary
  states both before you agree.
- Stock is re-checked at execution, not just at confirmation — the two can be
  minutes apart.
- `WHATSAPP` (default) means manual transfer, order stays UNPAID until someone
  confirms the money. `BILLPLZ` creates a **real bill at the gateway** and
  returns a payment link; it needs an email address. `BILLPLZ` is a **legacy
  enum name** — it means "paid online", and the live gateway is ToyyibPay. The
  agent is told never to label anything "Billplz" to an operator, and the admin
  UI renders the gateway's real name.

## Delivery scheduling

Asywa's delivery diary — Calendly-shaped, but built in rather than integrated.
One booking per order, at whatever date and time she says. Bookings are made
from `/admin/delivery` or by telling the agent; there is no public booking page.

**There is deliberately no availability layer.** An earlier version had
recurring weekly windows, blackout dates and per-slot capacity, and it was
removed. Availability exists in Calendly because strangers book against your
calendar without consulting you. Nobody books against Asywa's — she is the only
person putting things in it. A rule about when bookings are allowed could
therefore only ever have blocked *her*, while also being hers to maintain. Don't
reintroduce it unless customers start booking their own slots.

**Timezone is the sharp edge.** Times are converted against a fixed UTC+8 —
deliberately **not** against the server's clock. That box currently runs
`Asia/Shanghai`, which is the same offset as Malaysia by coincidence; a schedule
that depended on it would shift by hours the day the server is rebuilt
elsewhere. Malaysia has never observed daylight saving, so a fixed offset is
exact, not an approximation. `scripts/test-delivery-slots.ts` asserts the answer
is identical under four different host timezones.

Rules worth knowing:

- **Any time is bookable**, including 21:30 on a Sunday, and two deliveries can
  share the same time — back-to-back drops in one area are normal.
- The only date check is a **typo guard**: more than two years out is refused,
  because a slipped year files the delivery somewhere nobody looks again and the
  run sheet quietly loses it. An unreadable time ("after lunch") is refused
  rather than guessed at.
- **Rescheduling moves the booking**, it never creates a second one, so an order
  can never be out for delivery twice. Rescheduling a cancelled or failed
  delivery makes it live again.
- **FAILED is not cancelled.** Failed means the run happened and the drop did
  not — nobody home, wrong address. It stays on the record; cancelling takes it
  off the run sheet.
- Marking a delivery COMPLETED records the delivery only — it does not touch the
  order's status or mark it paid. Those are separate facts.
- A **cancelled order** cannot be scheduled, and cancelling a delivery never
  touches the order.

`scripts/test-delivery-flow.ts` covers all of the above against the database.

## Reminders

"Remind me in 2 hours to chase the transfer." Three tools — `set_reminder`,
`list_reminders`, `cancel_reminder` — plus a sweep in `utils/reminder-sweep.ts`
fired from the interval in `server.ts`.

**A reminder is a row, not a cron entry.** Each one could have been a real
crontab line; none of them is. A row can be listed, cancelled and recovered,
survives a redeploy, and needs no shell access from the API process. It is the
same shape the transactional email outbox already uses, for the same reasons.
The practical payoff is that nothing is lost to downtime: a reminder that came
due while WhatsApp was disconnected is still PENDING when the worker returns
and goes out late, which is what someone who asked to be reminded wants.

Lifecycle: `PENDING` → `SENT`, or `CANCELLED` if called off, or `FAILED` after
six failed sends (1/2/4/8/16/30-minute backoff) or if it goes more than 24h
past due. A FAILED reminder is kept, never deleted — one that never reached
anyone should be visible rather than silently gone.

**Where it goes** is the part worth understanding:

- Default is the conversation it was set in. The target is stored as
  `AgentConversation.chatKey` verbatim (`dm:<phone>` / `group:<jid>`), so
  "send it back here" is a copy of the key rather than a second addressing
  scheme that can drift out of step with the first. A group key becomes a
  `jid` at send time; a DM key becomes a `phone`.
- `"me"` means the requester's own DM even when asked from a group.
- An operator can be named or numbered.
- **Anyone else is refused.** The agent's standing guarantee is that nothing it
  does reaches a customer except a transactional email. A tool that put
  arbitrary text on a schedule to an arbitrary number would quietly delete that
  guarantee and make the business number a spam vector, so a target must
  resolve to an allowlisted operator or to the current chat. If reminding a
  customer is ever genuinely wanted, that should be a deliberate separate
  decision rather than a side effect of this tool.

Times are Malaysia local and go through the same fixed +08:00 as the delivery
diary. Anything unparseable is refused rather than guessed at — "sometime next
week" has no defensible instant behind it, and picking one would leave an
operator believing they were covered. The confirmation string is 12-hour with
an explicit AM/PM because the model was observed reading a 24-hour "06:26" back
as "6:26 PM".

## Adding a tool

1. Add it to the right file in `src/modules/ai-agent/tools/`.
2. Set `write: true` if it mutates, `destructive: true` if it is hard to undo —
   destructive tools automatically inherit the confirmation flow and a note in
   their description telling the model not to ask for confirmation itself.
3. Give `summarize()` for anything destructive: the operator confirms *that*
   text, so build it from resolved arguments, never from the request.
4. Take money in **ringgit** (`amountRm`), never cents. `toCents()` converts.
   A model that has to remember to multiply by 100 will eventually forget, and a
   100x error on a payout is not recoverable.
5. Export it from `registry.ts`. Duplicate names throw at boot.
6. Delegate to an existing admin controller if one exists — that is where the
   side effects live.
