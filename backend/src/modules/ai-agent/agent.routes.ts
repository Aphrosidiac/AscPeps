import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { handleMessage, MEDIA_KINDS, type InboundMessage, type InboundQuoted, type MediaKind } from './agent.service.js';
import type { InboundImage } from './core/vision.js';
import { sendEmail } from '../../utils/email.js';

// The worker → API hop. This endpoint can run every tool the agent has, so it
// is guarded exactly like the worker's own control plane: localhost source
// address AND the shared bearer token. It is registered outside the admin JWT
// scope because the caller is a process, not a logged-in human.
export default async function internalAgentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // `trustProxy: 1` is set on this server, so request.ip is the client
    // address as forwarded by nginx. The worker connects over the loopback
    // interface directly and never passes through nginx, so it presents as
    // 127.0.0.1 — anything else did come through the proxy and is not the worker.
    const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
    if (!allowed.includes(request.ip)) {
      return reply.status(403).send({ error: 'forbidden' });
    }
    if ((request.headers.authorization || '') !== `Bearer ${env.WORKER_HTTP_TOKEN}`) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
  });

  // A picture rides along as base64 — up to 10 MB decoded, which the worker
  // enforces before downloading — so this one route takes bodies well past
  // the server's default 1 MiB.
  fastify.post('/inbound', { bodyLimit: 32 * 1024 * 1024 }, async (request, reply) => {
    const body = request.body as Partial<InboundMessage>;
    // Either identity is acceptable — a LID-only sender has no phone at all.
    if ((!body?.senderPhone && !body?.senderLid) || typeof body.text !== 'string') {
      return reply.status(400).send({ error: 'senderPhone or senderLid, plus text, are required' });
    }
    const media = mediaKind(body.media);
    const quoted = quotedOf(body.quoted);
    if (!body.text.trim() && !media && !quoted) return reply.status(400).send({ error: 'text or media is required' });

    const msg: InboundMessage = {
      kind: body.kind === 'group' ? 'group' : 'dm',
      senderPhone: body.senderPhone ?? '',
      senderLid: body.senderLid,
      senderName: body.senderName ?? null,
      text: body.text,
      media,
      image: imageOf(body.image),
      imageOversized: body.imageOversized === true,
      quoted,
      groupJid: body.groupJid,
      groupSubject: body.groupSubject,
      mentionsBot: body.mentionsBot ?? true,
    };

    const outcome = await handleMessage(fastify, msg);
    return reply.send(outcome);
  });

  // Out-of-band alerting for the WhatsApp connection.
  //
  // The worker already emits DOWN/RECOVERED alerts, to a console line plus
  // optional Telegram and webhook sinks — and in production neither optional
  // sink was ever configured, so every alert it has ever raised went to a log
  // file nobody was reading. On 17 Aug 2026 the session was logged out at
  // 05:05 and the agent was completely deaf for 4h22m; PM2 showed green the
  // whole time and the first anyone knew of it was an operator finding the bot
  // unresponsive.
  //
  // This sink needs no new credential: it reuses the Resend key the shop
  // already sends receipts with, and addresses ADMIN users out of the database
  // so there is no address to configure and forget. WhatsApp is deliberately
  // not a sink — it is the thing that is down.
  fastify.post('/alert', async (request, reply) => {
    const body = request.body as { level?: string; text?: string };
    const level = body?.level === 'RECOVERED' ? 'RECOVERED' : 'DOWN';
    const text = typeof body?.text === 'string' ? body.text.slice(0, 2000) : '';

    // Logged first and unconditionally: if the email path fails, the record of
    // the outage must still exist.
    fastify.log.error({ level, text }, `[whatsapp-alert] ${level}`);

    const extra = (process.env.ALERT_EMAIL_TO || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    let recipients = extra;
    try {
      // AdminUser has no role column — every row in it is an admin.
      const admins = await fastify.prisma.adminUser.findMany({ select: { email: true } });
      recipients = [...new Set([...extra, ...admins.map((a) => a.email).filter(Boolean)])];
    } catch (err) {
      fastify.log.error({ err }, 'could not load admin recipients for WhatsApp alert');
    }

    if (!recipients.length || !process.env.RESEND_API_KEY) {
      return reply.send({ sent: 0, reason: 'no recipients or no RESEND_API_KEY' });
    }

    const subject =
      level === 'DOWN' ? 'Ascend MY WhatsApp agent is DOWN' : 'Ascend MY WhatsApp agent has RECOVERED';
    const html = `<p><strong>${subject}</strong></p><p>${escapeHtml(text)}</p><p style="color:#666">Sent by the WhatsApp worker on ascend-vps. While it is down the agent reads nothing — messages sent to it are not queued for a human.</p>`;

    let sent = 0;
    for (const to of recipients) {
      try {
        await sendEmail({ to, subject, html });
        sent++;
      } catch (err) {
        fastify.log.error({ err, to }, 'WhatsApp alert email failed');
      }
    }
    return reply.send({ sent });
  });
}

function mediaKind(value: unknown): MediaKind | undefined {
  return (MEDIA_KINDS as readonly string[]).includes(String(value)) ? (value as MediaKind) : undefined;
}

// Only a picture, only as base64. The worker is trusted, but the shape is
// checked so a stray field never reaches the vision model as a data: URL.
function imageOf(value: unknown): InboundImage | undefined {
  const v = value as Partial<InboundImage> | undefined;
  if (!v || typeof v.base64 !== 'string' || !v.base64) return undefined;
  const mimeType = typeof v.mimeType === 'string' && /^image\/[\w.+-]+$/.test(v.mimeType) ? v.mimeType : 'image/jpeg';
  return { mimeType, base64: v.base64 };
}

function quotedOf(value: unknown): InboundQuoted | undefined {
  const v = value as Partial<InboundQuoted> | undefined;
  if (!v || typeof v !== 'object') return undefined;
  const text = typeof v.text === 'string' ? v.text : '';
  const media = mediaKind(v.media);
  const image = imageOf(v.image);
  if (!text.trim() && !media && !image) return undefined;
  return {
    text,
    media,
    participantJid: typeof v.participantJid === 'string' ? v.participantJid : null,
    fromBot: v.fromBot === true,
    image,
    imageOversized: v.imageOversized === true,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
