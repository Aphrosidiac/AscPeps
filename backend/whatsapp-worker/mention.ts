/**
 * Pure message-text logic split out of worker.ts so it can be unit tested
 * against a realistic baileys message shape without a live socket — see
 * scripts/test-mention-parsing.ts. Takes `ids` (our own phone/LID digit
 * strings) as a parameter rather than reaching into `sock` state itself.
 */

// Did this message address the bot? Three ways count: an explicit @-mention of
// the connected number, a reply to one of the bot's own messages, or the text
// opening with the trigger word. Groups with requireMention set act on nothing else.
export function mentionsBot(msg: any, text: string, ids: string[]): boolean {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
  const mentioned: string[] = ctx?.mentionedJid ?? []
  if (ids.length && mentioned.some((jid) => ids.some((id) => jid.startsWith(id)))) return true

  // A reply to one of our own messages.
  if (ids.length && ctx?.participant && ids.some((id) => ctx.participant.startsWith(id))) return true

  // Text trigger. Deliberately kept as a fallback that needs no identifier at
  // all, so addressing the agent still works even if WhatsApp changes how
  // mentions are encoded again. "Abby" is the name the team actually calls it
  // by in chat, alongside the generic "bot"/"ascend".
  return /^\s*(@?ascend|@?bot|@?abby)\b/i.test(text)
}

// WhatsApp embeds a mention as the raw JID digits sitting in the text itself —
// what the app renders as "@Lewix Bot" arrives here as the literal string
// "@80943691858039". There is nothing in that token to tell the model the
// number is its OWN identifier rather than a customer or order reference to
// look up, and an LLM given the same ambiguous input twice does not have to
// resolve it the same way both times: sometimes it correctly reads the tag as
// WhatsApp mention furniture and answers the actual question, sometimes it
// goes looking for "80943691858039" as if it were a real record and, finding
// nothing, says so ("I can't see who that tag points to"). No code changed
// between those two outcomes — the raw text shape was always this, verified
// against production message history — only which way the model happened to
// read it. A reply never has this ambiguity: mentionsBot() disambiguates a
// reply via contextInfo.participant, never via the body text, which is why
// replying to the bot worked throughout and tagging it did not.
//
// Removing our own identifiers from the text before the model ever sees them
// deletes the ambiguity at the source rather than trying to out-prompt an
// LLM's pattern-matching. A message that was ONLY the mention, with nothing
// left after stripping, falls back to the original text so the model still
// has something to respond to.
export function stripSelfMentions(text: string, ids: string[]): string {
  if (!ids.length) return text
  let out = text
  for (const id of ids) {
    out = out.replace(new RegExp(`@${id}\\b`, 'g'), ' ')
  }
  // Removing a mid-sentence mention leaves a gap where it sat; collapse that
  // back to a single space rather than handing the model "ok  any delivery?".
  out = out.replace(/[ \t]+/g, ' ').trim()
  return out || text
}
