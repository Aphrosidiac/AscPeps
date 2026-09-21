/**
 * Pure message-text logic split out of worker.ts so it can be unit tested
 * against a realistic baileys message shape without a live socket — see
 * scripts/test-mention-parsing.ts. Takes `ids` (our own phone/LID digit
 * strings) as a parameter rather than reaching into `sock` state itself.
 */

// What a message IS, once the wrappers are off.
//
// WhatsApp nests the real content inside envelopes — disappearing messages
// (ephemeralMessage), view-once (viewOnceMessage, V2, V2Extension), a document
// sent with a caption (documentWithCaptionMessage), an edit (editedMessage).
// Reading `msg.message.conversation` straight off the top misses all of them:
// an operator in a group with disappearing messages on was ignored entirely,
// because their text never surfaced at the top level.
export type MediaKind = 'image' | 'video' | 'voice message' | 'audio' | 'file' | 'sticker' | 'contact' | 'location' | 'poll'

export interface MessageContent {
  text: string
  media?: MediaKind
  contextInfo?: any
  // The message this one replies to, when it is a reply. WhatsApp puts the
  // whole quoted message on the wire (contextInfo.quotedMessage), so what
  // the operator is pointing at is right there — for months it was read
  // only to decide whether the bot had been addressed, then thrown away, and
  // "@Abby key this in" as a reply to a customer's message reached the model
  // with nothing after it.
  quoted?: QuotedContent
  // Something the agent should never react to: a reaction, a delete, an
  // edit's bookkeeping, a protocol message.
  silent: boolean
}

export interface QuotedContent {
  text: string
  media?: MediaKind
  // Who wrote the quoted message, as the JID WhatsApp gave (phone or LID
  // form). Resolved to a name by the API; our own JID means "the bot".
  participantJid: string | null
  // The quoted message's id, and its raw content — what downloadMediaMessage
  // needs to fetch a quoted picture.
  stanzaId: string | null
  raw: any
}

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'] as const

export function unwrapMessage(message: any): any {
  let m = message
  for (let i = 0; i < 6 && m; i++) {
    const key = WRAPPERS.find((k) => m[k]?.message)
    if (!key) break
    m = m[key].message
  }
  return m ?? {}
}

export function contentOf(rawMessage: any): MessageContent {
  const m = unwrapMessage(rawMessage)
  const pick = (node: any, media?: MediaKind, text?: string): MessageContent => ({
    text: (text ?? '').toString(),
    media,
    contextInfo: node?.contextInfo,
    quoted: quotedOf(node?.contextInfo),
    silent: false,
  })
  if (typeof m.conversation === 'string') return pick(m, undefined, m.conversation)
  if (m.extendedTextMessage) return pick(m.extendedTextMessage, undefined, m.extendedTextMessage.text)
  if (m.imageMessage) return pick(m.imageMessage, 'image', m.imageMessage.caption)
  if (m.videoMessage) return pick(m.videoMessage, 'video', m.videoMessage.caption)
  if (m.audioMessage) return pick(m.audioMessage, m.audioMessage.ptt ? 'voice message' : 'audio')
  if (m.documentMessage) return pick(m.documentMessage, 'file', m.documentMessage.caption)
  if (m.stickerMessage) return pick(m.stickerMessage, 'sticker')
  if (m.contactMessage || m.contactsArrayMessage) return pick(m.contactMessage ?? m.contactsArrayMessage, 'contact')
  if (m.locationMessage || m.liveLocationMessage) return pick(m.locationMessage ?? m.liveLocationMessage, 'location')
  if (m.pollCreationMessage || m.pollCreationMessageV2 || m.pollCreationMessageV3) return pick(m.pollCreationMessage ?? m.pollCreationMessageV2 ?? m.pollCreationMessageV3, 'poll')
  // Reactions, deletes, edits' protocol bookkeeping, poll votes, keep-alives:
  // nothing a person said to us.
  return { text: '', silent: true }
}

// The replied-to message, in the same shape as a top-level one. A quoted
// message is a full message object, so it goes through the same unwrapping;
// the one difference is that it is never silent — a reply to a reaction is
// not a thing WhatsApp lets you send.
function quotedOf(contextInfo: any): QuotedContent | undefined {
  const q = contextInfo?.quotedMessage
  if (!q || typeof q !== 'object') return undefined
  const inner = contentOf(q)
  if (inner.silent) return undefined
  return {
    text: inner.text,
    media: inner.media,
    participantJid: typeof contextInfo.participant === 'string' ? contextInfo.participant : null,
    stanzaId: typeof contextInfo.stanzaId === 'string' ? contextInfo.stanzaId : null,
    raw: q,
  }
}

// Did this message address the bot? Three ways count: an explicit @-mention of
// the connected number, a reply to one of the bot's own messages, or the text
// opening with the trigger word. Groups with requireMention set act on nothing else.
//
// The contextInfo is read from whatever the content node is — an image with a
// caption that tags the bot carries its mentions on imageMessage, not on an
// extendedTextMessage it does not have.
export function mentionsBot(msg: any, text: string, ids: string[]): boolean {
  const ctx = contentOf(msg.message).contextInfo ?? msg.message?.extendedTextMessage?.contextInfo
  const mentioned: string[] = ctx?.mentionedJid ?? []
  if (ids.length && mentioned.some((jid) => ids.some((id) => jid.startsWith(id)))) return true

  // A reply to one of our own messages.
  if (ids.length && ctx?.participant && ids.some((id) => ctx.participant.startsWith(id))) return true

  // Text trigger. Deliberately kept as a fallback that needs no identifier at
  // all, so addressing the agent still works even if WhatsApp changes how
  // mentions are encoded again.
  //
  // "ascend"/"bot" stay anchored to the start of the message: both are common
  // enough words that matching them anywhere risks false-triggering on
  // ordinary chatter ("is this a bot", "trading bot").
  if (/^\s*(@?ascend|@?bot)\b/i.test(text)) return true

  // "Abby"/"AB" — the name and its short form — same reasoning as above:
  // matched anywhere, not anchored, since real usage is "hey Abby, ..." or
  // "ab, check this" as often as leading with it. Both are distinctive enough
  // as whole words that this is safe. \b keeps "Abbygail" from matching on
  // the name, and keeps "ab" from matching inside "grab", "cab", "lab".
  return /@?\b(abby|ab)\b/i.test(text)
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
