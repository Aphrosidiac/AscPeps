# WhatsApp AI agent

An admin assistant that runs ASCEND over WhatsApp. Anything you can do in the
dashboard, you can ask it to do in a chat — look up an order, restock a variant,
put a size on sale, record a payout, write an article, or pull a report that no
screen in the dashboard offers.

It is **not** a customer-facing chatbot. It only ever answers people on an
explicit allowlist, and it ignores everyone else in silence.

---

## How it fits together

```
WhatsApp ──► ascend-wa (worker, PM2)            ascend-api (PM2)
             • holds the baileys socket          • the agent + 53 tools
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

**Why the agent lives in the API and not the worker.** ASCEND's admin logic is
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

Plus two things learned from testing:

- **Bare "yes" can never fabricate an action.** With nothing parked, a "yes"
  re-drives the model to actually call a tool; it cannot simply narrate success.
- **Honesty guard.** If a reply claims a change was made and no write tool
  succeeded that turn, the reply is suppressed and replaced. An operator who
  believes a change landed stops checking, so this is the one failure mode worth
  a hard code-level backstop.

Everything the agent does is written to `agent_tool_calls` — tool, arguments,
actor, success, duration — and shown on the admin page.

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
  trigger (`@ascend …`) that needs no identifier at all.
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
  returns a payment link; it needs an email address.

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
