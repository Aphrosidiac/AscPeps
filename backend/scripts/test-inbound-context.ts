/**
 * What a WhatsApp message carries besides its text, end to end: the message
 * it replies to, and a picture.
 *
 * 21 Sep 2026, Ascend MY group: "ab put in a new order under the name andrew"
 * was sent with a screenshot of the customer's order, and the model answered
 * that it could not see any picture. Two gaps: the worker never relayed a
 * quoted message, and never downloaded a picture — and with a caption it did
 * not even mark that one existed.
 *
 * Three layers:
 *   1. rendering — what the model is shown for a reply / a picture (pure);
 *   2. the vision model reading a real screenshot (needs OPENROUTER_API_KEY);
 *   3. a real turn through /inbound with the picture attached, against the
 *      dev database and the real model (needs the API on PORT).
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-inbound-context.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { userMessageText, toWire } from '../src/modules/ai-agent/core/run.js';
import { readImage } from '../src/modules/ai-agent/core/vision.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✓ ${name}`);
      pass++;
    })
    .catch((e) => {
      console.log(`✗ ${name} — ${e?.message}`);
      fail++;
      failures.push(name);
    });
}
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

// ---------------------------------------------------------------- rendering

await check('a plain message renders as its text', () => {
  assert(userMessageText({ text: 'hi' }) === 'hi', 'changed');
});

await check('a reply shows the quoted message first, then the request', () => {
  const t = userMessageText({ text: 'ab key this in', quoted: { from: 'Asywa', text: 'Andrew Tan 012-345 6789' } });
  assert(t.startsWith('[Replying to a message from Asywa:\nAndrew Tan 012-345 6789\n— end of the quoted message]'), t);
  assert(t.endsWith('\nab key this in'), t);
});

await check("a reply to the assistant's own message says so", () => {
  const t = userMessageText({ text: 'yes that one', quoted: { from: 'you', text: 'Which order?' } });
  assert(t.includes('Replying to your earlier message'), t);
});

await check('a picture renders as its transcript, bracketed', () => {
  const t = userMessageText({ text: 'put in a new order', attachments: [{ kind: 'image', text: 'Andrew Tan\n012-345 6789' }] });
  assert(t === 'put in a new order\n[A picture is attached. Its contents, transcribed verbatim for you:\nAndrew Tan\n012-345 6789\n— end of the picture]', t);
});

await check('a picture that could not be read says so instead of pretending', () => {
  const t = userMessageText({ text: '', attachments: [{ kind: 'image', unreadable: 'too big' }] });
  assert(t === '[A picture is attached that you cannot see — too big]', t);
});

await check('a reply to a picture carries the transcript inside the quote', () => {
  const t = userMessageText({ text: 'ab key this in', quoted: { from: 'Asywa', text: '', attachments: [{ kind: 'image', text: 'Andrew Tan' }] } });
  assert(t.startsWith('[Replying to a message from Asywa:\n[A picture is attached. Its contents, transcribed verbatim for you:\nAndrew Tan\n— end of the picture]\n— end of the quoted message]'), t);
});

await check('a video under a caption is named as something the model cannot see', () => {
  const t = userMessageText({ text: 'look', attachments: [{ kind: 'video', unreadable: 'you cannot watch video' }] });
  assert(t === 'look\n[A video is attached that you cannot see — you cannot watch video]', t);
});

await check('in a group the sender prefix comes before the quote', () => {
  const wire = toWire([{ seq: 1, role: 'user', content: { text: 'key this in', sender: 'Asywa', quoted: { from: 'Fakhrul', text: 'order' } } }], { isGroup: true });
  assert(String(wire[0].content).startsWith('[Asywa] [Replying to a message from Fakhrul:'), String(wire[0].content));
});

// ---------------------------------------------------------------- vision

const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures-order-chat.jpg');
const base64 = fs.readFileSync(FIXTURE).toString('base64');
let transcript = '';

if (!process.env.OPENROUTER_API_KEY) {
  console.log('· vision + e2e skipped: OPENROUTER_API_KEY not set');
} else {
  await check('the vision model transcribes the order screenshot verbatim', async () => {
    const started = Date.now();
    const r = await readImage({ mimeType: 'image/jpeg', base64 });
    transcript = r.text;
    console.log(`   ${r.model} in ${Date.now() - started} ms, USD ${r.costUsd.toFixed(5)}\n   ${transcript.replace(/\n/g, '\n   ')}`);
    for (const needle of ['BPC-157', 'TB-500', 'Jalan Setia 3/4', '81100', '012-345 6789', 'Andrew Tan Wei Sheng']) {
      assert(transcript.includes(needle), `transcript is missing "${needle}"`);
    }
    assert(/^Image:/m.test(transcript), 'no "Image:" line');
  });

  // ---------------------------------------------------------------- e2e

  const API = `http://127.0.0.1:${process.env.PORT || 3105}`;
  const TOKEN = process.env.WORKER_HTTP_TOKEN || 'local-dev-worker-token';
  const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
  if (!up) {
    console.log(`· e2e skipped: API not listening on ${API}`);
  } else {
    const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
    await prisma.whatsAppOperator.upsert({
      where: { phone: '0123456789' },
      create: { phone: '0123456789', name: 'Test Operator', active: true, canWrite: true },
      update: { active: true, canWrite: true },
    });
    await prisma.agentThread.deleteMany({ where: { chatKey: 'dm:0123456789' } });
    await prisma.agentAction.updateMany({ where: { actorPhone: '0123456789', status: 'pending' }, data: { status: 'declined' } });

    const send = async (body: Record<string, unknown>) => {
      const res = await fetch(`${API}/api/v1/internal/agent/inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ kind: 'dm', senderPhone: '60123456789', senderName: 'Test Operator', mentionsBot: true, ...body }),
        signal: AbortSignal.timeout(180_000),
      });
      return (await res.json()) as { action: string; text?: string; reason?: string };
    };

    await check('a picture with a caption reaches the model as a transcript on the operator row', async () => {
      const started = new Date();
      const r = await send({ text: 'what does this customer want? just list the items and the address, do not create anything yet', media: 'image', image: { mimeType: 'image/jpeg', base64 } });
      console.log(`   reply: ${(r.text ?? r.reason ?? '').replace(/\n/g, '\n          ').slice(0, 600)}`);
      assert(r.action === 'reply', `expected a reply, got ${JSON.stringify(r)}`);
      const row = await prisma.agentMessage.findFirst({ where: { role: 'user', createdAt: { gt: started } }, orderBy: { createdAt: 'desc' } });
      const content = row?.content as { text: string; attachments?: { kind: string; text?: string }[] };
      assert(content?.attachments?.[0]?.kind === 'image' && content.attachments[0].text?.includes('BPC-157'), 'transcript not stored on the user row');
      const reply = r.text ?? '';
      assert(/BPC-?157/i.test(reply) && /TB-?500/i.test(reply), 'reply does not list the items from the picture');
      assert(/Setia|81100|Johor/i.test(reply), 'reply does not give the address from the picture');
      assert(!/can't see|cannot see|don't see any (picture|image)/i.test(reply), 'reply claims it cannot see the picture');
    });

    await check('a reply to a quoted message is answered against the quoted text', async () => {
      const r = await send({
        text: 'what is the postcode in this?',
        quoted: { text: 'Deliver to: No 7, Jalan Merbau 2, Taman Sri Pulai, 81300 Skudai, Johor', participantJid: '60199990000@s.whatsapp.net', fromBot: false },
      });
      console.log(`   reply: ${(r.text ?? r.reason ?? '').replace(/\n/g, '\n          ').slice(0, 300)}`);
      assert(r.action === 'reply' && /81300/.test(r.text ?? ''), 'reply did not read the postcode out of the quoted message');
    });

    await check('a later turn can still use the picture ("the address in that screenshot")', async () => {
      const r = await send({ text: 'and the phone number in that screenshot from earlier?' });
      console.log(`   reply: ${(r.text ?? r.reason ?? '').replace(/\n/g, '\n          ').slice(0, 300)}`);
      assert(r.action === 'reply' && /012[- ]?345[- ]?6789/.test(r.text ?? ''), 'reply did not find the number from the earlier picture');
    });

    await check('a picture the worker could not download is named, not invented', async () => {
      // A fresh thread: with the earlier screenshot still in history the
      // model would reasonably answer "this order" from it.
      await prisma.agentThread.deleteMany({ where: { chatKey: 'dm:0123456789' } });
      const r = await send({ text: 'key in this order', media: 'image', imageOversized: true });
      console.log(`   reply: ${(r.text ?? r.reason ?? '').replace(/\n/g, '\n          ').slice(0, 400)}`);
      assert(r.action === 'reply' && /picture|image|photo|screenshot/i.test(r.text ?? '') && /(big|large|size|MB|resend|send .*again|type|text)/i.test(r.text ?? ''), 'reply does not say the picture was unreadable');
      const tools = await prisma.agentAction.count({ where: { actorPhone: '0123456789', tool: 'create_order', createdAt: { gt: new Date(Date.now() - 120_000) } } });
      assert(tools === 0, 'create_order was called with nothing to go on');
    });

    await prisma.$disconnect();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) failures.forEach((f) => console.log(`  - ${f}`));
process.exit(fail ? 1 : 0);
