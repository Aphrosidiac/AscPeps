/**
 * The mention/reply detector and self-mention stripper, against realistic
 * baileys message shapes.
 *
 * No socket, no network. This exists because nothing previously exercised
 * `mentionsBot()` or the text the model actually receives against a message
 * object shaped like what WhatsApp sends — so a real production bug (the bot
 * "@-mentioning" itself into a raw digit string it then tried to look up as a
 * customer) had nothing to catch it. See the comment on stripSelfMentions in
 * mention.ts for the incident.
 *
 *   npx tsx scripts/test-mention-parsing.ts
 */
import { contentOf, mentionsBot, stripSelfMentions } from '../whatsapp-worker/mention.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name} — ${e?.message}`);
    fail++;
    failures.push(name);
  }
}

const eq = (actual: unknown, expected: unknown, msg = '') => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} got ${a}, expected ${b}`);
};

// The bot's own identifiers, exactly as selfIds() produces them — bare
// digits, no @s.whatsapp.net or @lid suffix.
const OWN_PHONE = '60137566001';
const OWN_LID = '80943691858039';
const IDS = [OWN_PHONE, OWN_LID];

// A group message with an @-mention, shaped like the real payload: the
// mentioned JID carries our LID form, and the visible text has the raw digits
// inline at the point the mention chip was typed — this is genuinely what
// WhatsApp puts on the wire; the app only *renders* it as "@Lewix Bot".
function mentionMessage(text: string) {
  return {
    message: {
      extendedTextMessage: {
        text,
        contextInfo: { mentionedJid: [`${OWN_LID}@lid`] },
      },
    },
  };
}

function replyMessage(text: string) {
  return {
    message: {
      extendedTextMessage: {
        text,
        contextInfo: { participant: `${OWN_PHONE}@s.whatsapp.net`, stanzaId: 'ABC123' },
      },
    },
  };
}

// ---------------------------------------------------------------- detection

check('an @-mention of our LID is detected', () => {
  const msg = mentionMessage(`@${OWN_LID} what time is my delivery?`);
  eq(mentionsBot(msg, msg.message.extendedTextMessage.text, IDS), true);
});

check('a reply to our own message is detected', () => {
  const msg = replyMessage('any delivery?');
  eq(mentionsBot(msg, msg.message.extendedTextMessage.text, IDS), true);
});

check('an unrelated message in a group is not detected', () => {
  const msg = { message: { extendedTextMessage: { text: 'lol', contextInfo: {} } } };
  eq(mentionsBot(msg, 'lol', IDS), false);
});

check('the text trigger works with no identifiers at all', () => {
  const msg = { message: { extendedTextMessage: { text: 'bot, any orders today?', contextInfo: {} } } };
  eq(mentionsBot(msg, 'bot, any orders today?', []), true);
});

check('"Abby" is recognised as a name for the bot', () => {
  const msg = { message: { extendedTextMessage: { text: 'Abby, what time is my delivery?', contextInfo: {} } } };
  eq(mentionsBot(msg, 'Abby, what time is my delivery?', []), true);
});

check('"Abby" is recognised even when it is not the first word', () => {
  // The actual reported bug: "hey Abby, ..." was silently ignored because the
  // trigger only matched at position 0.
  const msg = { message: { extendedTextMessage: { text: 'hey Abby, what time is my delivery?', contextInfo: {} } } };
  eq(mentionsBot(msg, 'hey Abby, what time is my delivery?', []), true);
});

check('a name that merely contains "abby" does not false-trigger', () => {
  // Word-boundary guard: "Abbyson" or "abbygail" must not be read as the trigger.
  const msg = { message: { extendedTextMessage: { text: 'Abbygail called about her order', contextInfo: {} } } };
  eq(mentionsBot(msg, 'Abbygail called about her order', []), false);
});

check('"AB" — the short form — is recognised as a name for the bot', () => {
  const msg = { message: { extendedTextMessage: { text: 'ab, what time is my delivery?', contextInfo: {} } } };
  eq(mentionsBot(msg, 'ab, what time is my delivery?', []), true);
});

check('"AB" is recognised even when it is not the first word', () => {
  const msg = { message: { extendedTextMessage: { text: 'yo AB check this', contextInfo: {} } } };
  eq(mentionsBot(msg, 'yo AB check this', []), true);
});

check('"ab" inside an ordinary word does not false-trigger', () => {
  // Word-boundary guard: "grab"/"cab"/"lab" must not read as the trigger.
  const msg = { message: { extendedTextMessage: { text: 'can you grab the parcel from the cab', contextInfo: {} } } };
  eq(mentionsBot(msg, 'can you grab the parcel from the cab', []), false);
});

check('"bot" still requires being the first word — not relaxed like "Abby"', () => {
  // "bot" is common enough that matching it anywhere would false-trigger on
  // ordinary chatter ("is this a bot", "trading bot"); "Abby" is distinctive
  // enough that it doesn't have this problem.
  const msg = { message: { extendedTextMessage: { text: 'is this a bot replying', contextInfo: {} } } };
  eq(mentionsBot(msg, 'is this a bot replying', []), false);
});

check('a mention of someone else is not detected as us', () => {
  const msg = {
    message: {
      extendedTextMessage: { text: '@60123456789 what did you order?', contextInfo: { mentionedJid: ['60123456789@s.whatsapp.net'] } },
    },
  };
  eq(mentionsBot(msg, msg.message.extendedTextMessage.text, IDS), false);
});

// ---------------------------------------------------------------- stripping

check('a self-mention is stripped, leaving the real question', () => {
  eq(stripSelfMentions(`@${OWN_LID} what time is my delivery for tonight again ?`, IDS), 'what time is my delivery for tonight again ?');
});

check('a self-mention anywhere in the message is stripped, not just at the start', () => {
  eq(stripSelfMentions(`ok @${OWN_LID} any delivery?`, IDS), 'ok any delivery?');
});

check('the phone-JID form of a self-mention is stripped too', () => {
  eq(stripSelfMentions(`@${OWN_PHONE} give me the total`, IDS), 'give me the total');
});

check('a mention of someone else is left alone', () => {
  eq(stripSelfMentions('@60123456789 what did you order?', IDS), '@60123456789 what did you order?');
});

check('a message that is ONLY the mention falls back to the original text', () => {
  // Nothing left to protect once the mention is the whole message — stripping
  // to empty would leave the agent with nothing to respond to.
  eq(stripSelfMentions(`@${OWN_LID}`, IDS), `@${OWN_LID}`);
});

check('a longer number that merely starts with our id is not falsely stripped', () => {
  // Regression guard for the \b boundary: "801112223333" contains our LID as a
  // prefix but is a different number entirely.
  eq(stripSelfMentions(`@${OWN_LID}0 hello`, IDS), `@${OWN_LID}0 hello`);
});

check('no identifiers means the text passes through untouched', () => {
  eq(stripSelfMentions(`@${OWN_LID} hi`, []), `@${OWN_LID} hi`);
});

// -------------------------------------------------- the actual production case

check('the exact production failure — clean text after stripping', () => {
  // Verbatim (redacted phone) from the live incident: mentionsBot() correctly
  // says "yes, respond" and the model would previously have received the raw
  // id inline, which is what it sometimes misread as a lookup target.
  const raw = `@${OWN_LID} what time of my delivery for tonight again ?`;
  const msg = mentionMessage(raw);
  eq(mentionsBot(msg, raw, IDS), true, 'should still be treated as addressed to us:');
  eq(stripSelfMentions(raw, IDS), 'what time of my delivery for tonight again ?', 'model should now see a clean question:');
});

// -------------------------------------------------- what a message is

check('plain text', () => {
  const c = contentOf({ conversation: 'hi' });
  eq(c.text, 'hi');
  eq(c.media, undefined);
  eq(c.silent, false);
});

check('a disappearing-messages group: text one level down', () => {
  // The shape baileys delivers in a group with disappearing messages on. Read
  // at the top level this is an empty message, and the operator was ignored.
  const c = contentOf({ ephemeralMessage: { message: { extendedTextMessage: { text: 'ab how many orders today' } } } });
  eq(c.text, 'ab how many orders today');
});

check('view-once image, no caption', () => {
  const c = contentOf({ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } });
  eq(c.media, 'image');
  eq(c.text, '');
});

check('a video with a caption is text, and still knows it was a video', () => {
  const c = contentOf({ videoMessage: { caption: 'ab check this', seconds: 12 } });
  eq(c.text, 'ab check this');
  eq(c.media, 'video');
});

check('a voice note is not merely audio', () => {
  eq(contentOf({ audioMessage: { ptt: true } }).media, 'voice message');
  eq(contentOf({ audioMessage: { ptt: false } }).media, 'audio');
});

check('a document sent with a caption is unwrapped', () => {
  const c = contentOf({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'invoice for 0042', fileName: 'inv.pdf' } } } });
  eq(c.text, 'invoice for 0042');
  eq(c.media, 'file');
});

check('stickers, contacts, locations and polls are named', () => {
  eq(contentOf({ stickerMessage: {} }).media, 'sticker');
  eq(contentOf({ contactMessage: { displayName: 'X' } }).media, 'contact');
  eq(contentOf({ locationMessage: { degreesLatitude: 1 } }).media, 'location');
  eq(contentOf({ pollCreationMessageV3: { name: 'Lunch?' } }).media, 'poll');
});

check('reactions, deletes and protocol traffic are silent', () => {
  eq(contentOf({ reactionMessage: { text: '👍' } }).silent, true);
  eq(contentOf({ protocolMessage: { type: 0 } }).silent, true);
  eq(contentOf({}).silent, true);
  eq(contentOf(undefined).silent, true);
});

check('a caption that tags the bot counts as a mention', () => {
  // The mention sits on imageMessage.contextInfo, not on an extendedTextMessage
  // the message does not have.
  const msg = { message: { imageMessage: { caption: `@${OWN_LID} is this the right label?`, contextInfo: { mentionedJid: [`${OWN_LID}@lid`] } } } };
  eq(mentionsBot(msg, contentOf(msg.message).text, IDS), true);
});

// -------------------------------------------------- the replied-to message
//
// 21 Sep 2026: "ab put in a new order under the name andrew" was a reply to
// a customer's message pasted into the group; the model got the nine words
// and nothing else. The quoted message is on the wire as
// contextInfo.quotedMessage and must come through in full.

check('a reply carries the quoted text and its author', () => {
  const msg = {
    message: {
      extendedTextMessage: {
        text: `@${OWN_LID} key this in`,
        contextInfo: {
          mentionedJid: [`${OWN_LID}@lid`],
          participant: '60123456789@s.whatsapp.net',
          stanzaId: 'QUOTED1',
          quotedMessage: { conversation: 'Andrew Tan, 2x BPC-157 5mg, No 12 Jalan Setia 3/4, 81100 JB' },
        },
      },
    },
  };
  const c = contentOf(msg.message);
  eq(c.text, `@${OWN_LID} key this in`);
  eq(c.quoted?.text, 'Andrew Tan, 2x BPC-157 5mg, No 12 Jalan Setia 3/4, 81100 JB');
  eq(c.quoted?.participantJid, '60123456789@s.whatsapp.net');
  eq(c.quoted?.stanzaId, 'QUOTED1');
  eq(c.quoted?.media, undefined);
});

check('a reply to a picture knows it is a picture and keeps the raw node for download', () => {
  const quotedMessage = { imageMessage: { caption: 'my order', mimetype: 'image/jpeg', url: 'https://mmg.whatsapp.net/x', mediaKey: 'k', fileLength: 51685 } };
  const msg = { message: { extendedTextMessage: { text: 'ab key this in', contextInfo: { participant: '60123456789@s.whatsapp.net', quotedMessage } } } };
  const c = contentOf(msg.message);
  eq(c.quoted?.media, 'image');
  eq(c.quoted?.text, 'my order');
  eq(c.quoted?.raw, quotedMessage);
});

check('a reply to the bot is attributed to the bot JID', () => {
  const msg = replyMessage('yes that one');
  const c = contentOf({ ...msg.message, extendedTextMessage: { ...msg.message.extendedTextMessage, contextInfo: { ...msg.message.extendedTextMessage.contextInfo, quotedMessage: { conversation: 'Which order — 0031 or 0032?' } } } });
  eq(c.quoted?.participantJid, `${OWN_PHONE}@s.whatsapp.net`);
  eq(c.quoted?.text, 'Which order — 0031 or 0032?');
});

check('a quoted message in a disappearing-messages group is unwrapped too', () => {
  const msg = { message: { extendedTextMessage: { text: 'this one', contextInfo: { quotedMessage: { ephemeralMessage: { message: { conversation: 'inner' } } } } } } };
  eq(contentOf(msg.message).quoted?.text, 'inner');
});

check('a message that is not a reply has no quoted message', () => {
  eq(contentOf({ conversation: 'hi' }).quoted, undefined);
  const msg = mentionMessage(`@${OWN_LID} hi`);
  eq(contentOf(msg.message).quoted, undefined);
});

check('a picture with a caption is a picture, and the caption is its text', () => {
  const c = contentOf({ imageMessage: { caption: 'ab put in a new order under the name andrew', mimetype: 'image/jpeg' } });
  eq(c.media, 'image');
  eq(c.text, 'ab put in a new order under the name andrew');
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
