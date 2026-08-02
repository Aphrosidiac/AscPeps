/**
 * ASCEND — WhatsApp worker
 *
 * Runs as a separate PM2 process (fork mode). Listens on 127.0.0.1:WORKER_HTTP_PORT.
 * Keeps a baileys connection alive and hands inbound messages to the API's agent.
 *
 * The connection layer here is ported from HarvestGrow's worker, which has been
 * hardened in production over a long outage-driven feedback loop. The reconnect
 * strategy, the paired-session distinction, the Redis-backed dedup, the downtime
 * alerting and the control-plane surface are all preserved deliberately — the
 * comments explaining *why* each one is shaped the way it is are the valuable
 * part, and every one of them was written after something broke.
 *
 * What is NOT ported: HarvestGrow's own agents (DM agent, group order parsing,
 * the hold-back buffer). ASCEND's agent is a different thing entirely and lives
 * in the API process (src/modules/ai-agent) — this file only moves bytes.
 *
 * Why the agent lives in the API and not here: ASCEND's admin logic is Fastify-
 * and Prisma-coupled (stock restoration, refunds, PostHog revenue capture, the
 * transactional email outbox). Reimplementing any of it in a second process
 * would guarantee drift. So this worker holds the socket, the API holds the
 * business logic, and they talk over authenticated localhost HTTP.
 */
import Fastify from 'fastify'
import Redis from 'ioredis'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from 'baileys'
type WASocket = ReturnType<typeof makeWASocket>
import * as QRCode from 'qrcode'
import path from 'path'
import fs from 'fs'
import { config as loadEnv } from 'dotenv'
import { mentionsBot, stripSelfMentions } from './mention.js'

loadEnv()

const PORT = parseInt(process.env.WORKER_HTTP_PORT || '3106')
const TOKEN = process.env.WORKER_HTTP_TOKEN || 'ascend-worker-token'
// This process reads its own env independently of the API's config/env.ts, so
// the same production hard-throw guard has to be duplicated here — the API's
// check has no way to see this process's environment.
if (process.env.NODE_ENV === 'production' && (!process.env.WORKER_HTTP_TOKEN || process.env.WORKER_HTTP_TOKEN === 'ascend-worker-token')) {
  throw new Error(
    'WORKER_HTTP_TOKEN must be set to a non-default value in production (openssl rand -base64 24), matching the value configured in the API\'s backend/.env.'
  )
}

const SESSION_DIR = path.resolve(process.cwd(), 'whatsapp-session')
const API_BASE = process.env.WORKER_API_BASE || `http://127.0.0.1:${process.env.PORT || '3105'}`

// Global kill-switch for the agent. While false the worker still connects and
// still receives messages (so you can pair the number and watch traffic land),
// but nothing is sent and no tool ever runs. This is the safe default for a
// fresh deploy: pair first, watch, then switch on.
const AGENT_ENABLED = ['true', '1', 'yes'].includes((process.env.WHATSAPP_AGENT_ENABLED || '').trim().toLowerCase())
if (!AGENT_ENABLED) {
  console.log('[worker] Agent is DISABLED (set WHATSAPP_AGENT_ENABLED=true to enable). Inbound messages are received and logged but never answered or acted on.')
}

// NOTE: HarvestGrow's worker downloads and base64-relays inbound images and
// voice notes, with a 10MB pre-download size check read off the protobuf's own
// fileLength. That is deliberately not ported: this agent runs on a text model,
// so there is nothing to relay media to, and downloading it would buffer
// many-MB payloads in this single process for no benefit. Media is acknowledged
// with a short reply instead (see handleInbound). If a vision tier is adopted
// later, port that size guard back with it — not after.

// Persistent message dedup — an in-memory Set is recreated on every reconnect
// and lost entirely on restart, so a crash/redeploy mid-conversation causes the
// agent to re-process old messages and re-run side-effecting tools. For an
// agent that can cancel orders and record payouts, that is not a duplicate
// reply, it is a duplicate *action*. Redis survives both.
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379')
// Without this listener an emitted Redis error (e.g. Redis briefly unreachable)
// becomes an uncaught exception, which the crash handler below turns into a
// process.exit(1) — a PM2 crash loop for a transient, self-recovering condition.
redis.on('error', (err) => console.error('[redis] connection error:', err.message))

async function alreadyProcessed(msgId: string): Promise<boolean> {
  // SET ... NX EX: atomically claims the id; returns null if already claimed.
  // 7-day TTL (not 1h) — baileys can redeliver older messages on device
  // re-pair or offline catch-up, well outside a 1-hour window.
  const claimed = await redis.set(`wa:dedup:${msgId}`, '1', 'EX', 604800, 'NX')
  return claimed === null
}

const MAX_RECONNECT_ATTEMPTS = 5
const MAX_BACKOFF_MS = 5 * 60 * 1000

// ─── Downtime alerting ───
// A dropped socket is completely silent: PM2 stays green (the process never
// dies, only the socket does), the API stays up, the site returns 200. On
// HarvestGrow that silence once hid a 9.5-hour outage. These are the
// out-of-band signal.
//
// WhatsApp itself is deliberately NOT a sink: it's the thing that's down.
const ALERT_DOWN_AFTER_MS = parseInt(process.env.ALERT_DOWN_AFTER_MINUTES || '10') * 60_000
const ALERT_TELEGRAM_BOT_TOKEN = process.env.ALERT_TELEGRAM_BOT_TOKEN || ''
const ALERT_TELEGRAM_CHAT_ID = process.env.ALERT_TELEGRAM_CHAT_ID || ''
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || ''

let disconnectedSince: number | null = Date.now()
let downAlertSentAt: number | null = null
let lastDowntimeMs: number | null = null

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// Every sink is best-effort and independently guarded: an alert failing to send
// must never take down the worker or block a reconnect. The console line always
// fires, so even with zero channels configured the outage is greppable in PM2.
async function emitAlert(level: 'DOWN' | 'RECOVERED', text: string) {
  console.error(`[worker][ALERT:${level}] ${text}`)

  if (ALERT_TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ALERT_TELEGRAM_CHAT_ID, text: `ASCEND WhatsApp — ${level}\n\n${text}` }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err: any) {
      console.error('[worker] Telegram alert failed:', err?.message)
    }
  }

  if (ALERT_WEBHOOK_URL) {
    try {
      await fetch(ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'ascend-whatsapp', level, text, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err: any) {
      console.error('[worker] Webhook alert failed:', err?.message)
    }
  }
}

let sock: WASocket | null = null
let qrCode: string | null = null
let qrGeneratedAt = 0
let connected = false
let connectedPhone: string | null = null
let connectedAt: number | null = null
let connecting = false
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
// Operator-requested stop (via POST /stop). While true, connectWhatsApp()
// refuses to run and the close handler won't schedule a reconnect — this is the
// only state meaning "stay off" rather than "keep retrying." POST /connect clears it.
let stopped = false
// Distinguishes an operator pressing Stop from the worker giving up on its own
// after MAX_RECONNECT_ATTEMPTS — same `stopped` state either way, but the UI
// should say something different ("you stopped this" vs "nobody scanned the QR").
let stopReason: 'manual' | 'max_attempts' | null = null

function giveUpReconnecting() {
  console.log(`[worker] Giving up after ${MAX_RECONNECT_ATTEMPTS} failed attempts — stopped. POST /connect to try again.`)
  stopped = true
  stopReason = 'max_attempts'
  qrCode = null
  qrGeneratedAt = 0
}

// The existence of creds.json is NOT proof that anyone ever scanned the QR, so
// it must not be what decides whether to keep retrying. useMultiFileAuthState
// writes that file on every `creds.update` baileys emits, and not all of those
// require a pairing. initAuthCreds() sets no `me` at all; only
// configureSuccessfulPairing() fills it in, and that runs solely on
// `pair-success` (i.e. after a real scan). So `me.id` is the honest "this
// session is actually paired" signal, and the one thing standing between an
// unscanned QR and an invisible infinite retry loop.
//
// `creds.registered` is deliberately NOT used: a live paired session has
// registered:false, because baileys only sets that flag for the pairing-code
// flow — this worker pairs by QR, so it stays false forever even when connected.
function hasPairedSession(): boolean {
  try {
    const raw = fs.readFileSync(path.join(SESSION_DIR, 'creds.json'), 'utf-8')
    return !!JSON.parse(raw)?.me?.id
  } catch {
    // Missing, unreadable, or corrupt all mean the same thing: this cannot
    // resume without a human, which is what the give-up path exists for.
    return false
  }
}

// A paired session on disk separates the two failures that used to share a
// give-up path:
//   - NO session  → nobody scanned the QR. Nothing changes without a human, so
//                   parking the worker is correct.
//   - HAS session → credentials are fine and WhatsApp is simply refusing us
//                   right now. Its 405/503 reconnect-rejection storms are
//                   transient and clear on their own, but routinely outlast the
//                   ~2.5min five attempts allows. Giving up there turned a
//                   self-healing blip into a 9.5-hour outage on HarvestGrow.
//                   With a session we retry indefinitely, capped at MAX_BACKOFF_MS.
function scheduleReconnect(code?: number | string) {
  reconnectAttempts++
  // Read once: the answer must not change between the give-up decision and the
  // log line describing it, and it saves a second file read on every retry.
  const paired = hasPairedSession()
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS && !paired) {
    giveUpReconnecting()
    return
  }
  // Math.pow overflows to Infinity around attempt 1025; Math.min clamps it so
  // an unbounded retry loop settles at a steady MAX_BACKOFF_MS rather than breaking.
  const backoffMs = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), MAX_BACKOFF_MS)
  const limit = paired ? '∞' : String(MAX_RECONNECT_ATTEMPTS)
  console.log(`[worker] Disconnected (code: ${code ?? 'n/a'}) — reconnecting in ${Math.round(backoffMs / 1000)}s (attempt ${reconnectAttempts}/${limit})`)
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWhatsApp().catch(console.error) }, backoffMs)
}

// Polls rather than firing from the close handler, because the condition that
// matters is "still down N minutes later", not "a socket closed" — sockets close
// and recover within seconds all day long, and alerting on every one is noise.
setInterval(() => {
  if (connected || disconnectedSince === null) return
  // An operator who pressed Stop knows it's off; that's intent, not an incident.
  if (stopped && stopReason === 'manual') return
  if (downAlertSentAt) return
  const downFor = Date.now() - disconnectedSince
  if (downFor < ALERT_DOWN_AFTER_MS) return
  downAlertSentAt = Date.now()
  const detail = stopped
    ? 'Worker has GIVEN UP reconnecting (no saved session — a QR re-scan is required).'
    : `Still retrying (attempt ${reconnectAttempts}). No messages are being read.`
  emitAlert('DOWN', `WhatsApp disconnected for ${fmtDuration(downFor)}. ${detail}`).catch(() => {})
}, 60_000).unref()

// baileys' typed emitter requires an explicit event name — there is no
// zero-arg removeAllListeners(). Detaching matters more than it looks: a stale
// socket that keeps its 'connection.update' listener will schedule its own
// reconnect alongside the new one, and the two then fight over `sock`.
function detachListeners(s: WASocket) {
  for (const event of ['creds.update', 'connection.update', 'messages.upsert'] as const) {
    try { s.ev.removeAllListeners(event) } catch {}
  }
}

function currentPhase(): 'connected' | 'stopped' | 'qr_pending' | 'connecting' | 'reconnecting' | 'idle' {
  if (connected) return 'connected'
  if (stopped) return 'stopped'
  if (qrCode) return 'qr_pending'
  if (connecting) return 'connecting'
  if (reconnectTimer) return 'reconnecting'
  return 'idle'
}

// The connected number, digits only. Used for display and for detecting
// @-mentions of ourselves.
function selfNumber(): string | null {
  return sock?.user?.id?.split(':')[0]?.split('@')[0] ?? null
}

// Every identifier that means "us". WhatsApp addresses us by phone JID in some
// chats and by our own LID in others (baileys exposes both on `sock.user` —
// e.g. id "60137566001:4@s.whatsapp.net", lid "80943691858039:4@lid"), and a
// mention in a LID-addressed group carries the LID form. Matching only the
// phone digits meant an @-mention in such a group was never recognised, so a
// group with requireMention on would ignore the operator entirely.
function selfIds(): string[] {
  const ids: string[] = []
  const phone = selfNumber()
  if (phone) ids.push(phone)
  const lid = (sock?.user as any)?.lid?.split(':')[0]?.split('@')[0]
  if (lid) ids.push(lid)
  return ids
}

async function connectWhatsApp() {
  if (connecting || stopped) return
  connecting = true

  if (sock) {
    detachListeners(sock)
    try { sock.end(undefined) } catch {}
    sock = null
  }

  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)

    let version: [number, number, number]
    try {
      const res = await fetchLatestBaileysVersion()
      version = res.version
    } catch {
      version = [2, 3000, 1015901307]
    }

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u

      if (qr) {
        try {
          qrCode = await QRCode.toDataURL(qr)
          qrGeneratedAt = Date.now()
          console.log('[worker] QR generated — scan with WhatsApp on your phone')
        } catch (err) {
          console.error('[worker] QR generation failed:', err)
        }
      }

      if (connection === 'open') {
        connected = true
        connectedAt = Date.now()
        qrCode = null
        qrGeneratedAt = 0
        reconnectAttempts = 0
        connectedPhone = selfNumber()
        console.log(`[worker] WhatsApp connected as +${connectedPhone}`)

        if (disconnectedSince !== null) lastDowntimeMs = Date.now() - disconnectedSince
        disconnectedSince = null
        // Only close the loop if a DOWN alert actually went out — otherwise a
        // routine few-second blip pages everyone with an all-clear for an
        // alarm nobody got.
        if (downAlertSentAt) {
          downAlertSentAt = null
          emitAlert(
            'RECOVERED',
            `WhatsApp reconnected as +${connectedPhone} after ${fmtDuration(lastDowntimeMs ?? 0)} down. ` +
              `Messages queued during the outage are replayed on reconnect (dedup is Redis-backed, so already-processed ones are skipped).`
          ).catch(() => {})
        }
      }

      if (connection === 'close') {
        connected = false
        connectedPhone = null
        connectedAt = null
        qrCode = null
        qrGeneratedAt = 0
        // Keep the ORIGINAL drop time across a retry storm — each failed
        // attempt emits its own 'close', and resetting here would restart the
        // downtime clock every few seconds so the alert threshold is never reached.
        if (disconnectedSince === null) disconnectedSince = Date.now()

        // POST /stop already removed listeners before closing, so this is only
        // reached if the phone/server closed at the same moment.
        if (stopped) return

        const code = (lastDisconnect?.error as any)?.output?.statusCode
        if (code === DisconnectReason.loggedOut) {
          console.log('[worker] WhatsApp logged out — session cleared, manual re-scan required')
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }) } catch {}
          reconnectAttempts = 0
          reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWhatsApp().catch(console.error) }, 3000)
          return
        }

        scheduleReconnect(code)
      }
    })

    sock.ev.on('messages.upsert', async (m: any) => {
      // baileys tags live inbound messages as 'notify'; history-sync/append
      // events (catch-up after a reconnect or device re-pair) come through this
      // same event with a different `type` and must NOT be treated as new. For
      // an agent with write tools, replaying history would re-run real actions.
      if (m.type !== 'notify') return

      for (const msg of m.messages || []) {
        if (msg.key.fromMe) continue

        const msgId = msg.key.id
        if (msgId) {
          // Fail OPEN on a Redis error. Unguarded, a Redis blip throws and
          // kills the whole handler (unhandledRejection), leaving inbound
          // silently dead while /status still reports connected. A rare
          // duplicate beats total inbound silence — and every destructive
          // action needs a fresh confirmation anyway, so a replayed message
          // cannot silently re-delete anything.
          try {
            if (await alreadyProcessed(msgId)) continue
          } catch (err) {
            console.error('[worker] Redis dedup check failed — proceeding without dedup:', err)
          }
        }

        try {
          await handleInbound(msg)
        } catch (err) {
          console.error('[worker] inbound handler error:', err)
        }
      }
    })
  } catch (err) {
    console.error('[worker] connect error:', err)
    connecting = false
    if (stopped) return
    scheduleReconnect()
    return
  }
  connecting = false
}

// ─── Inbound → API agent → reply ───────────────────────────

function extractText(msg: any): string {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    ''
  )
}

async function handleInbound(msg: any) {
  const remoteJid: string = msg.key.remoteJid || ''
  if (!remoteJid) return
  const isGroup = remoteJid.endsWith('@g.us')

  // In a group the sender is `participant`; `remoteJid` is the group itself.
  const senderJid: string = (isGroup ? msg.key.participant : remoteJid) || ''

  // A `@lid` JID is WhatsApp's privacy identifier, NOT a phone number, and
  // WhatsApp now delivers many direct messages with only a LID. Verified on the
  // wire: the entire message key is {remoteJid:"...@lid", fromMe, id} — there is
  // no phone number in the payload, `onWhatsApp()` returns nothing for it, and
  // baileys 6.17.16 exposes no LID→phone mapping.
  //
  // The digits of a LID are NOT a phone number, so they must never be treated
  // as one — that could match the wrong operator, or one by coincidence.
  // Instead the identifier is passed through as-is and the API resolves it
  // against operators an admin has explicitly bound. Unbound senders are
  // recorded (so the dashboard can offer the binding) and still ignored.
  const isLid = senderJid.endsWith('@lid')
  const senderLid = isLid ? senderJid.replace('@lid', '') : undefined
  const senderPhone = isLid ? '' : senderJid.replace('@s.whatsapp.net', '').split(':')[0]
  if (!senderLid && !senderPhone) return

  let text = extractText(msg)

  // Media is acknowledged but not yet fed to the model: DeepSeek V4 Flash is
  // the text tier, and silently dropping an image the operator sent would look
  // like the agent ignored them.
  if (!text && (msg.message?.imageMessage || msg.message?.audioMessage || msg.message?.documentMessage)) {
    const kind = msg.message?.imageMessage ? 'image' : msg.message?.audioMessage ? 'voice message' : 'file'
    if (AGENT_ENABLED && sock) {
      await sock.sendMessage(remoteJid, {
        text: `I can only read text right now — send that ${kind}'s details as a message and I'll act on it.`,
      })
    }
    return
  }
  if (!text.trim()) return

  // Computed on the RAW text — mentionsBot's JID matching doesn't touch the
  // body text at all, and its text-trigger fallback only looks for a leading
  // "ascend"/"bot" word, never a numeric id, so stripping first vs after makes
  // no difference here. Order matters for `text` itself, though: it must be
  // cleaned before it reaches the payload, not before this check.
  const ids = selfIds()
  const mentionedBot = isGroup ? mentionsBot(msg, text, ids) : true
  text = stripSelfMentions(text, ids)

  const payload = {
    kind: isGroup ? 'group' : 'dm',
    senderPhone,
    senderLid,
    senderName: msg.pushName || null,
    text,
    groupJid: isGroup ? remoteJid : undefined,
    groupSubject: isGroup ? (await groupSubject(remoteJid)) : undefined,
    mentionsBot: mentionedBot,
  }

  if (!AGENT_ENABLED) {
    console.log(`[worker] (agent disabled) inbound from ${senderLid ? `lid:${senderLid}` : senderPhone}${isGroup ? ` in ${remoteJid}` : ''}: ${text.slice(0, 80)}`)
    return
  }

  // A turn can run several tool calls, so this is slow by design. Show the
  // typing indicator rather than leaving the operator staring at nothing, and
  // refresh it — WhatsApp expires presence after a few seconds.
  let typing: ReturnType<typeof setInterval> | null = null
  try {
    await sock?.sendPresenceUpdate('composing', remoteJid).catch(() => {})
    typing = setInterval(() => {
      sock?.sendPresenceUpdate('composing', remoteJid).catch(() => {})
    }, 4000)
    ;(typing as any).unref?.()

    const res = await fetch(`${API_BASE}/api/v1/internal/agent/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(payload),
      // Generous: a multi-tool turn against the LLM legitimately takes a while.
      signal: AbortSignal.timeout(180_000),
    })

    if (!res.ok) {
      console.error(`[worker] agent API returned ${res.status}`)
      return
    }

    const data = (await res.json()) as { action: 'ignore' | 'reply'; text?: string; reason?: string }
    if (data.action !== 'reply' || !data.text) {
      if (data.reason) console.log(`[worker] ignored message from ${senderLid ? `lid:${senderLid}` : senderPhone}: ${data.reason}`)
      return
    }

    // Sending is its own failure domain and must be logged as such. Folding it
    // in with the API call produced "[worker] agent call failed: not-acceptable"
    // for a reply the agent had generated perfectly well — the failure was
    // WhatsApp rejecting the outbound stanza, which reads nothing like that.
    if (sock) {
      try {
        await sock.sendMessage(remoteJid, { text: data.text })
      } catch (sendErr: any) {
        const reason = sendErr?.message ?? String(sendErr)
        console.error(
          `[worker] REPLY GENERATED BUT SEND FAILED to ${remoteJid} (${isGroup ? 'group' : 'dm'}): ${reason}`
        )
        // `not-acceptable` on a group is the known signature of this baileys
        // version not understanding LID-addressed groups: it has no concept of
        // addressingMode, so the stanza it builds is rejected outright. Nothing
        // in the agent or the gating is wrong when this happens.
        if (isGroup && /not-acceptable/i.test(reason)) {
          console.error(
            '[worker] This is the known LID-addressed group limitation of baileys 6.x — group replies cannot be delivered until the library is upgraded. Direct messages are unaffected.'
          )
        }
        throw sendErr
      }
    }
  } catch (err: any) {
    console.error('[worker] inbound handling failed:', err?.message ?? err)
    // Only surface an error to a chat the agent is actually allowed to speak
    // in — an unknown sender must get silence even when things break, or the
    // failure itself becomes the confirmation that a bot is listening.
    // The API decides that, and it never answered, so say nothing.
  } finally {
    if (typing) clearInterval(typing)
    await sock?.sendPresenceUpdate('paused', remoteJid).catch(() => {})
  }
}

// Group subjects are cached briefly: an active group would otherwise hit
// WhatsApp's metadata API on every single message.
const groupSubjectCache = new Map<string, { subject: string; expiresAt: number }>()
async function groupSubject(jid: string): Promise<string | undefined> {
  const hit = groupSubjectCache.get(jid)
  if (hit && hit.expiresAt > Date.now()) return hit.subject
  try {
    const meta = await sock?.groupMetadata(jid)
    if (meta?.subject) {
      groupSubjectCache.set(jid, { subject: meta.subject, expiresAt: Date.now() + 300_000 })
      return meta.subject
    }
  } catch {
    // Metadata is a nicety for display; never let it break message handling.
  }
  return undefined
}

function toJid(phone: string): string {
  let cleaned = phone.replace(/[^0-9]/g, '')
  if (cleaned.startsWith('0')) cleaned = '60' + cleaned.slice(1)
  return `${cleaned}@s.whatsapp.net`
}

// ─── HTTP control plane (localhost only) ───────────────────
const app = Fastify({ logger: false, requestTimeout: 30000 })

app.addHook('preHandler', async (request, reply) => {
  const ip = request.ip
  const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1']
  if (!allowed.includes(ip)) return reply.status(403).send({ error: 'forbidden' })
  const auth = request.headers.authorization || ''
  if (auth !== `Bearer ${TOKEN}`) return reply.status(401).send({ error: 'unauthorized' })
})

app.get('/status', async () => ({
  phase: currentPhase(),
  connected,
  phone: connectedPhone,
  connectedAt,
  hasQr: !!qrCode,
  qrAge: qrGeneratedAt ? Math.round((Date.now() - qrGeneratedAt) / 1000) : null,
  reconnectAttempts,
  maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
  // Drives the settings page's "Start resumes without scanning a new QR" copy,
  // which is only true for a genuinely paired session.
  hasSession: hasPairedSession(),
  stopped,
  stopReason,
  agentEnabled: AGENT_ENABLED,
  disconnectedSince,
  downSeconds: disconnectedSince ? Math.round((Date.now() - disconnectedSince) / 1000) : null,
  downAlertSentAt,
  lastDowntimeMs,
  alertChannels: {
    telegram: !!(ALERT_TELEGRAM_BOT_TOKEN && ALERT_TELEGRAM_CHAT_ID),
    webhook: !!ALERT_WEBHOOK_URL,
    downAfterMinutes: Math.round(ALERT_DOWN_AFTER_MS / 60_000),
  },
}))

// Lets the admin UI offer a real picker of groups the connected number is in,
// instead of an admin having to discover and paste a raw JID by hand.
app.get('/groups', async (_request, reply) => {
  if (!sock || !connected) return reply.status(409).send({ error: 'not_connected' })
  try {
    const groups = await sock.groupFetchAllParticipating()
    return {
      groups: Object.values(groups).map((g: any) => ({
        jid: g.id,
        subject: g.subject,
        participantCount: g.participants?.length ?? 0,
      })),
    }
  } catch (err: any) {
    return reply.status(500).send({ error: err?.message || 'Failed to fetch groups' })
  }
})

app.get('/qr', async () => ({
  qr: qrCode,
  connected,
  generatedAt: qrGeneratedAt || null,
  expired: qrGeneratedAt ? Date.now() - qrGeneratedAt > 120_000 : false,
}))

// Start (or resume). Clears a prior /stop and any pending backoff retry, then
// attempts a fresh handshake — reuses saved session creds if present (no
// re-scan needed), otherwise a new QR is generated.
app.post('/connect', async () => {
  if (connected) return { ok: true, message: 'already connected' }
  stopped = false
  stopReason = null
  reconnectAttempts = 0
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  connectWhatsApp().catch(console.error)
  return { ok: true }
})

// Graceful stop: closes the socket and suppresses auto-reconnect, but keeps the
// saved session on disk — POST /connect afterward resumes without a re-scan.
// /disconnect below is the destructive "Logout" that always wipes and re-pairs.
app.post('/stop', async () => {
  stopped = true
  stopReason = 'manual'
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (sock) {
    detachListeners(sock)
    try { sock.end(undefined) } catch {}
    sock = null
  }
  connecting = false
  connected = false
  connectedPhone = null
  connectedAt = null
  qrCode = null
  qrGeneratedAt = 0
  return { ok: true }
})

// Logout: invalidates the session phone-side ("unlink device"), wipes the local
// session dir, and starts a fresh pairing attempt. Unlike /stop this cannot be
// resumed — the next connection always needs a re-scan.
app.post('/disconnect', async () => {
  stopped = false
  stopReason = null
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  if (sock) {
    // Remove listeners before logging out so the socket's own 'close' event
    // can't race this handler's cleanup and schedule a second connect.
    detachListeners(sock)
    try { await sock.logout() } catch {}
    try { sock.end(undefined) } catch {}
    sock = null
  }
  try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }) } catch {}
  connecting = false
  connected = false
  connectedPhone = null
  connectedAt = null
  qrCode = null
  qrGeneratedAt = 0
  reconnectAttempts = 0
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectWhatsApp().catch(console.error) }, 2000)
  return { ok: true }
})

// Outbound send, used by the admin UI's test button and by any future
// proactive notification from the API.
app.post('/send', async (request, reply) => {
  if (!AGENT_ENABLED) {
    return reply.status(409).send({ message: 'WhatsApp agent is disabled (WHATSAPP_AGENT_ENABLED is not true).' })
  }
  const { phone, message, jid } = request.body as any
  if (!sock || !connected) return reply.status(409).send({ message: 'WhatsApp not connected' })
  if (!message || (!phone && !jid)) return reply.status(400).send({ message: 'phone (or jid) and message are required' })
  const target = jid || toJid(phone)
  await sock.sendMessage(target, { text: message })
  return { ok: true, to: target }
})

await app.listen({ port: PORT, host: '127.0.0.1' })
console.log(`[worker] control plane on http://127.0.0.1:${PORT}`)

connectWhatsApp().catch(console.error)

// ─── Crash handlers ────────────────────────────────────────
process.on('uncaughtException', async (err) => {
  console.error('[CRASH] Uncaught exception:', err)
  await new Promise((r) => setTimeout(r, 500))
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason)
})

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} — shutting down`)
  if (sock) detachListeners(sock)
  try { sock?.end(undefined) } catch {}
  try { await app.close() } catch {}
  try { redis.disconnect() } catch {}
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
