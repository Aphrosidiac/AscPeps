import type { FastifyInstance } from 'fastify';
import { normalizePhone } from '../../utils/phone.js';
import type { AgentActor } from './tool-kit.js';
import { activeRun, approveAction, awaitTurn, declineAction, livePendingActions, startTurn, type TurnOptions } from './core/run.js';

// The WhatsApp door onto the assistant.
//
// Everything model-facing — the loop, the tools, the guards, the transcript —
// lives in core/run.ts and is shared with the dashboard's Assistant page.
// This file is what is specific to a phone: who may talk (the allowlist and
// the group gate), what a "yes" means (a parked action), and how the answer
// has to be written (WhatsApp's own formatting). One thread per chat key,
// same as before; a WhatsApp thread shows on the Assistant page like any
// other, read-only, with the same cards and the same undo.

export { CLAIMS_COMPLETION } from './core/run.js';

export interface InboundMessage {
  // 'dm' | 'group'
  kind: 'dm' | 'group';
  // Sender's phone as digits from the JID (60...). Normalized here. Empty when
  // WhatsApp only gave us a LID.
  senderPhone: string;
  // WhatsApp's privacy identifier, when that is all the message carried. Many
  // direct messages now arrive this way with no phone number at all, so this is
  // the primary identity for those senders — see WhatsAppOperator.lid.
  senderLid?: string;
  senderName: string | null;
  text: string;
  // Group only.
  groupJid?: string;
  groupSubject?: string;
  // Whether the message mentioned/replied to the bot. Groups with
  // requireMention set only act on messages where this is true.
  mentionsBot?: boolean;
}

export type AgentOutcome =
  | { action: 'ignore'; reason: string }
  | { action: 'reply'; text: string };

// ---------------------------------------------------------------- turn locking

/**
 * One turn at a time per conversation.
 *
 * `handleMessage` is re-entrant and, until this, nothing stopped two messages
 * on the same thread being processed at once. In a group with two operators
 * that is the normal case, not an edge case: on 17 Aug at 09:30:39 and 09:30:44
 * two people asked about the same order, both turns ran concurrently, and the
 * group got two overlapping replies six seconds apart that disagreed with each
 * other. Worse, each turn loaded history that did not contain the other's
 * message, so neither could see it was duplicating work.
 *
 * Queueing rather than dropping: the second message is a real question and
 * deserves an answer — it just deserves one written with the first turn's
 * result already in the thread.
 *
 * In-process is sufficient because the API runs under PM2 in fork mode (one
 * process). If it is ever moved to cluster mode this must become a Postgres
 * advisory lock (`pg_advisory_xact_lock` on a hash of the chatKey), or the
 * guarantee silently disappears while the code still looks correct.
 */
const turnQueues = new Map<string, Promise<unknown>>();

function withConversationLock<T>(chatKey: string, run: () => Promise<T>): Promise<T> {
  const previous = turnQueues.get(chatKey) ?? Promise.resolve();
  // `then(run, run)` so a turn that threw still releases the queue — otherwise
  // one failure would wedge that conversation permanently.
  const result = previous.then(run, run);
  // The stored tail never rejects; the caller gets the real error from `result`.
  const tail = result.then(
    () => undefined,
    () => undefined
  );
  turnQueues.set(chatKey, tail);
  // Drop the entry once this is the last turn in the queue, so a long-lived
  // process does not accumulate one promise per conversation forever.
  void tail.then(() => {
    if (turnQueues.get(chatKey) === tail) turnQueues.delete(chatKey);
  });
  return result;
}

// A confirmation is a WHOLE message, not a prefix.
//
// These were anchored but open-ended (`/^(no|...)\b/`), which meant any
// instruction that merely began with one of these words was swallowed by the
// confirmation machinery and never reached the model at all. On 17 Aug
// "No the latest order ab, try again" — a real request, mid-conversation —
// matched `^no\b` and was answered with the canned "Nothing was pending, so
// nothing has changed", while the operator sat there having asked a question.
//
// AFFIRMATIVE had the same shape and the worse failure mode: "ok what's the
// latest order" would have been treated as a bare yes and pushed the model to
// carry out whatever it thought it had last proposed.
//
// Trailing punctuation and a short courtesy tail ("yes please", "no thanks")
// still count — anything longer is a sentence and belongs to the model.
const AFFIRMATIVE =
  /^(y|ya|yes|yep|yeah|yup|ok|okay|okey|k|confirm|confirmed|go|go ahead|do it|proceed|betul|boleh|sure)(\s+(please|pls|boss|ab|abby|thanks|tq))?\s*[.!]*$/i;
const NEGATIVE =
  /^(n|no|nope|nah|cancel|stop|abort|jangan|tak|tidak|nevermind|never mind)(\s+(thanks|thank you|tq|please|pls|boss|ab|abby))?\s*[.!]*$/i;

// Converts the markdown the model reaches for into WhatsApp's own formatting.
//
// WhatsApp uses *single* asterisks for bold; **double** renders as literal
// asterisks around the word. Telling the model this in the prompt helps but
// does not hold — it is trained on markdown and slips back constantly — and
// every slip is visible in the operator's chat. Fixing it in code is
// deterministic and costs nothing.
//
// Applied to the final reply only, never to tool arguments.
function toWhatsAppText(text: string): string {
  return (
    text
      // ### Heading -> *Heading* (WhatsApp has no headings at all)
      .replace(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm, '*$1*')
      // **bold** / __bold__ -> *bold*
      .replace(/\*\*(.+?)\*\*/gs, '*$1*')
      .replace(/__(.+?)__/gs, '*$1*')
      // ~~strike~~ -> ~strike~
      .replace(/~~(.+?)~~/gs, '~$1~')
      // Markdown links: keep the text and the URL, drop the syntax.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
      // Tables. WhatsApp has no table rendering at all, so a markdown table
      // arrives as a wall of pipe characters on a phone screen. Stripping only
      // the |---|---| separator (the first attempt at this) was worse than
      // useless: it left the pipe rows behind and added a blank line where the
      // separator had been. Drop separators with their newline, then flatten
      // each remaining row into a readable line.
      .replace(/^[ \t]*\|?[\s:|-]{6,}\|?[ \t]*\r?\n/gm, '')
      .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row: string) =>
        row
          .split('|')
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(' · ')
      )
      // Collapse the runs of blank lines the substitutions can leave behind.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// ------------------------------------------------------------------ access

export async function resolveActor(
  fastify: FastifyInstance,
  rawPhone: string,
  lid?: string
): Promise<AgentActor | null> {
  // LID first. When WhatsApp sends a LID there is no phone number in the
  // message at all, so this is the only identity available — and it is a
  // stronger one, because it was bound to this operator by an admin rather
  // than inferred.
  if (lid) {
    const byLid = await fastify.prisma.whatsAppOperator.findFirst({ where: { lid, active: true } });
    return byLid ? { phone: byLid.phone, name: byLid.name, canWrite: byLid.canWrite } : null;
  }

  if (!rawPhone) return null;
  const phone = normalizePhone(rawPhone);
  const op = await fastify.prisma.whatsAppOperator.findFirst({ where: { phone, active: true } });
  if (!op) return null;
  return { phone: op.phone, name: op.name, canWrite: op.canWrite };
}

// Records a sender we could not resolve, so the dashboard can offer to bind
// them. Without this the LID case is invisible: the operator messages, nothing
// happens, and the only trace is a line in the PM2 log.
//
// Recording grants nothing — the sender is still ignored.
async function noteUnknownSender(fastify: FastifyInstance, msg: InboundMessage) {
  const identifier = msg.senderLid || normalizePhone(msg.senderPhone);
  if (!identifier) return;
  try {
    await fastify.prisma.whatsAppUnknownSender.upsert({
      where: { identifier },
      create: {
        identifier,
        isLid: !!msg.senderLid,
        pushName: msg.senderName,
        lastMessage: msg.text.slice(0, 200),
      },
      update: {
        pushName: msg.senderName,
        lastMessage: msg.text.slice(0, 200),
        lastSeenAt: new Date(),
        messageCount: { increment: 1 },
      },
    });
  } catch (err) {
    fastify.log.error({ err }, 'failed to record unknown WhatsApp sender');
  }
}

// Decide whether a message should be acted on at all. Runs before any LLM call,
// so an unknown sender costs nothing and — importantly — gets no reply. A
// refusal would confirm the number is live and that there is an admin bot
// behind it; silence gives a stranger nothing.
export async function shouldHandle(
  fastify: FastifyInstance,
  msg: InboundMessage
): Promise<{ ok: false; reason: string } | { ok: true; actor: AgentActor }> {
  // The ROOM is checked before the person, and before anything is recorded.
  //
  // Order matters here. The connected number sits in supplier, customer and
  // unrelated project groups, and every participant in all of them is an
  // unresolvable sender. Resolving the person first meant every one of those
  // strangers got written to the unknown-senders table — turning a recovery
  // aid into a log of other people's group chatter, and burying the one entry
  // that actually needs binding.
  if (msg.kind === 'group') {
    if (!msg.groupJid) return { ok: false, reason: 'group message without a group jid' };
    const group = await fastify.prisma.whatsAppGroup.findFirst({
      where: { groupJid: msg.groupJid, active: true },
    });
    // Both gates must pass in a group: the person AND the room. A group is
    // never a way around the operator allowlist — it is an additional
    // restriction on top of it.
    if (!group) return { ok: false, reason: 'group is not allowlisted' };
    if (group.requireMention && !msg.mentionsBot) {
      return { ok: false, reason: 'group requires an explicit mention' };
    }
  }

  const actor = await resolveActor(fastify, msg.senderPhone, msg.senderLid);
  if (!actor) {
    // Only reached in a DM, or in a group the agent was actually addressed in —
    // i.e. somewhere a real operator plausibly just tried to talk to it.
    await noteUnknownSender(fastify, msg);
    return {
      ok: false,
      reason: msg.senderLid
        ? `sender arrived as a WhatsApp LID (${msg.senderLid}) that is not bound to any operator — bind it on the admin Agent page`
        : 'sender is not an allowlisted operator',
    };
  }

  return { ok: true, actor };
}


// ------------------------------------------------------------- the thread

// The tail of every confirmation this adapter sends. What the operator is
// agreeing to is the action's summary, built from the RESOLVED arguments.
export const CONFIRM_SUFFIX = 'Reply *yes* to go ahead, or *no* to cancel.';

export function confirmationPrompt(summary: string): string {
  return `About to ${summary}.\n\n${CONFIRM_SUFFIX}`;
}

// One thread per chat key, keyed on the RESOLVED operator for a DM rather
// than the raw sender: the same person can reach us by phone JID one day and
// by LID the next, and keying on whatever the transport sent would split
// their history in two.
export async function whatsappThread(fastify: FastifyInstance, msg: InboundMessage, actor: AgentActor) {
  const chatKey = msg.kind === 'group' ? `group:${msg.groupJid}` : `dm:${actor.phone}`;
  const title = msg.kind === 'group' ? `${msg.groupSubject ?? 'Group'} · WhatsApp` : `${actor.name} · WhatsApp`;
  return fastify.prisma.agentThread.upsert({
    where: { chatKey },
    create: { chatKey, kind: 'whatsapp', title },
    update: { title },
  });
}

export function turnOptionsFor(msg: InboundMessage, actor: AgentActor, chatKey: string, title: string): TurnOptions {
  return {
    actor,
    channel: msg.kind,
    origin: {
      kind: msg.kind,
      chatKey,
      label: msg.kind === 'group' ? `this group — ${title.replace(/ · WhatsApp$/, '')}` : `${actor.name} (DM)`,
    },
  };
}

// --------------------------------------------------------------- main entry

export async function handleMessage(fastify: FastifyInstance, msg: InboundMessage): Promise<AgentOutcome> {
  const gate = await shouldHandle(fastify, msg);
  if (!gate.ok) return { action: 'ignore', reason: gate.reason };
  const actor = gate.actor;

  // The gate is deliberately OUTSIDE the lock: an unknown sender must never be
  // able to make a real operator queue behind them.
  const chatKey = msg.kind === 'group' ? `group:${msg.groupJid}` : `dm:${actor.phone}`;
  return withConversationLock(chatKey, () => runWhatsAppTurn(fastify, msg, actor));
}

async function runWhatsAppTurn(fastify: FastifyInstance, msg: InboundMessage, actor: AgentActor): Promise<AgentOutcome> {
  const thread = await whatsappThread(fastify, msg, actor);
  const opts = turnOptionsFor(msg, actor, thread.chatKey!, thread.title);
  const text = msg.text.trim();

  // A dashboard approval may have this thread mid-resume; a WhatsApp message
  // waits its turn rather than colliding with it.
  if (activeRun(thread.id)) await awaitTurn(thread.id);

  // ---- 1. Resolve any parked action first.
  //
  // Deliberately handled in code, not by the model. Asking the LLM to remember
  // "you were waiting for a yes" across turns is exactly the kind of state it
  // loses, and the failure mode is executing a delete that was never confirmed.
  const pending = await livePendingActions(fastify, thread.id);
  const mine = pending.find((p) => p.actorPhone === actor.phone) ?? null;

  if (mine) {
    if (AFFIRMATIVE.test(text)) {
      try {
        await approveAction(fastify, mine.id, opts);
      } catch (err: any) {
        return { action: 'reply', text: `Couldn't do it: ${err?.message ?? String(err)}` };
      }
      return { action: 'reply', text: await relay(thread.id) };
    }
    if (NEGATIVE.test(text)) {
      // No model turn on a decline: "Cancelled" needs no narration, and the
      // operator on a phone wants the acknowledgement, not a paragraph.
      await declineAction(fastify, mine.id, opts, undefined, false);
      return { action: 'reply', text: 'Cancelled — nothing was changed.' };
    }
    // Neither yes nor no: they have moved on. Decline it rather than leaving
    // it armed for a later, unrelated "ok".
    await declineAction(fastify, mine.id, opts, 'the operator moved on without answering', false);
  } else if (NEGATIVE.test(text)) {
    return { action: 'reply', text: "Nothing was pending, so nothing has changed. Tell me what you'd like me to do." };
  }

  // A bare "yes" with nothing parked. This happens when the model wrote its own
  // "are you sure?" instead of calling the tool. Left alone the operator hits a
  // dead end: they confirmed something that was never armed. So push the model
  // to actually act — it still cannot shortcut the safety model: a destructive
  // tool parks for a real confirmation as usual, and the write guard stops it
  // claiming success without having called anything.
  const systemNote =
    !mine && AFFIRMATIVE.test(text)
      ? 'The operator just confirmed. Carry out the action you last proposed by calling the appropriate tool NOW. Do not ask again and do not describe the action as already done — call the tool. If you cannot tell what was being confirmed, say so and ask what they want.'
      : undefined;

  // ---- 2. The turn.
  try {
    await startTurn(fastify, thread.id, text, { ...opts, systemNote });
  } catch (err: any) {
    return { action: 'reply', text: `Something went wrong on my side: ${err?.message ?? 'unknown error'}. Nothing was changed by this message.` };
  }
  return { action: 'reply', text: await relay(thread.id) };
}

// Waits for the thread's run to finish and turns its outcome into one
// WhatsApp message: the assistant's answer, then a confirmation prompt for
// each action it parked. One place every reply passes through, so nothing
// can bypass the formatter.
export async function relay(threadId: string): Promise<string> {
  const outcome = await awaitTurn(threadId);
  const parts: string[] = [];
  if (outcome.error) parts.push(`Something went wrong on my side: ${outcome.error}. Nothing was changed by this message.`);
  else if (outcome.aborted) parts.push('Stopped before I could finish.');
  else if (outcome.text) parts.push(toWhatsAppText(outcome.text));
  for (const p of outcome.pending) parts.push(confirmationPrompt(p.summary ?? p.tool));
  if (!parts.length) parts.push('I ran that but have nothing to report back — try asking again more specifically.');
  return parts.join('\n\n');
}
