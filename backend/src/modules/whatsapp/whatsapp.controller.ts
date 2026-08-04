import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
// Thin proxy from the admin dashboard to the worker's localhost control plane.
// The worker binds to 127.0.0.1 only, so this is the sole path to it — which is
// the point: pairing, stopping and logging out are admin-authenticated here,
// and unreachable from outside the box.
//
// The request helper itself lives in utils/whatsapp-send.ts so the reminder
// sweep can send without a FastifyReply to answer — one path to the worker,
// not two that can drift apart.
import { workerRequest } from '../../utils/whatsapp-send.js';

// A dead worker must render as "worker unreachable" in the UI, not as a broken
// page. PM2 can report the process online while the socket inside it is gone,
// so the dashboard needs to distinguish "no worker" from "worker up, WhatsApp down".
export async function getWhatsAppStatus(_request: FastifyRequest, reply: FastifyReply) {
  try {
    const res = await workerRequest('/status');
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    return reply.send({ success: true, data: await res.json() });
  } catch {
    return reply.send({
      success: true,
      data: {
        phase: 'worker_unreachable',
        connected: false,
        phone: null,
        connectedAt: null,
        hasQr: false,
        qrAge: null,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        hasSession: false,
        stopped: false,
        stopReason: null,
        agentEnabled: false,
      },
    });
  }
}

export async function getWhatsAppQR(_request: FastifyRequest, reply: FastifyReply) {
  try {
    const res = await workerRequest('/qr');
    if (!res.ok) throw new Error('Worker unavailable');
    return reply.send({ success: true, data: await res.json() });
  } catch {
    return reply.status(503).send({ success: false, message: 'WhatsApp worker unavailable' });
  }
}

export async function connectWhatsApp(_request: FastifyRequest, reply: FastifyReply) {
  try {
    const res = await workerRequest('/connect', {});
    return reply.send({ success: true, data: await res.json() });
  } catch (e: any) {
    return reply.status(503).send({ success: false, message: e.message || 'Worker unavailable' });
  }
}

export async function stopWhatsApp(_request: FastifyRequest, reply: FastifyReply) {
  try {
    await workerRequest('/stop', {});
    return reply.send({ success: true, message: 'Stopped' });
  } catch (e: any) {
    return reply.status(503).send({ success: false, message: e.message || 'Worker unavailable' });
  }
}

export async function disconnectWhatsApp(_request: FastifyRequest, reply: FastifyReply) {
  try {
    await workerRequest('/disconnect', {});
    return reply.send({ success: true, message: 'Disconnected' });
  } catch (e: any) {
    return reply.status(503).send({ success: false, message: e.message || 'Worker unavailable' });
  }
}

// Groups the connected number is currently in, merged with which ones the agent
// is enabled for. This is what backs the group picker — an admin should never
// have to discover and paste a raw JID.
export async function listWhatsAppGroups(fastify: FastifyInstance, _request: FastifyRequest, reply: FastifyReply) {
  try {
    const res = await workerRequest('/groups');
    if (res.status === 409) {
      return reply.status(409).send({ success: false, message: 'WhatsApp is not connected' });
    }
    if (!res.ok) throw new Error(`Worker returned ${res.status}`);
    const data = (await res.json()) as { groups: { jid: string; subject: string; participantCount: number }[] };

    const enabled = await fastify.prisma.whatsAppGroup.findMany();
    const byJid = new Map(enabled.map((g) => [g.groupJid, g]));

    return reply.send({
      success: true,
      data: data.groups.map((g) => {
        const row = byJid.get(g.jid);
        return {
          ...g,
          enabled: row?.active ?? false,
          requireMention: row?.requireMention ?? true,
        };
      }),
    });
  } catch (e: any) {
    return reply.status(503).send({ success: false, message: e.message || 'Worker unavailable' });
  }
}

export async function sendTestMessage(
  request: FastifyRequest<{ Body: { phone: string; message: string } }>,
  reply: FastifyReply
) {
  const { phone, message } = request.body ?? ({} as any);
  if (!phone || !message) {
    return reply.status(400).send({ success: false, message: 'Phone and message are required' });
  }
  try {
    const res = await workerRequest('/send', { phone, message });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({ message: 'Send failed' }))) as any;
      return reply.status(res.status).send({ success: false, message: err.message || 'Send failed' });
    }
    return reply.send({ success: true, data: await res.json() });
  } catch (e: any) {
    return reply.status(503).send({ success: false, message: e.message || 'Worker unavailable' });
  }
}

// ---- operator / group allowlist management (admin dashboard) --------------

export async function listOperators(fastify: FastifyInstance) {
  const [operators, groups] = await Promise.all([
    fastify.prisma.whatsAppOperator.findMany({ orderBy: { createdAt: 'asc' } }),
    fastify.prisma.whatsAppGroup.findMany({ orderBy: { subject: 'asc' } }),
  ]);
  return { operators, groups };
}

export async function upsertOperator(fastify: FastifyInstance, body: any) {
  const { normalizePhone } = await import('../../utils/phone.js');
  if (!body?.phone || !body?.name) throw { statusCode: 400, message: 'phone and name are required' };
  // Normalized on the way in so it can never diverge from the shape the
  // inbound path looks up.
  const phone = normalizePhone(String(body.phone));
  return fastify.prisma.whatsAppOperator.upsert({
    where: { phone },
    create: { phone, name: String(body.name), active: body.active !== false, canWrite: body.canWrite !== false },
    update: { name: String(body.name), active: body.active !== false, canWrite: body.canWrite !== false },
  });
}

export async function deleteOperator(fastify: FastifyInstance, id: string) {
  await fastify.prisma.whatsAppOperator.delete({ where: { id } });
  return { deleted: true };
}

export async function upsertGroup(fastify: FastifyInstance, body: any) {
  if (!body?.groupJid) throw { statusCode: 400, message: 'groupJid is required' };
  return fastify.prisma.whatsAppGroup.upsert({
    where: { groupJid: String(body.groupJid) },
    create: {
      groupJid: String(body.groupJid),
      subject: String(body.subject ?? body.groupJid),
      active: !!body.active,
      requireMention: body.requireMention !== false,
    },
    update: {
      ...(body.subject ? { subject: String(body.subject) } : {}),
      active: !!body.active,
      requireMention: body.requireMention !== false,
    },
  });
}

// ---- unrecognised senders -------------------------------------------------
//
// The recovery path for WhatsApp LIDs. Many direct messages now arrive with a
// privacy identifier and no phone number, so an operator cannot be matched by
// number at all — an admin binds the identifier to them here, once.

export async function listUnknownSenders(fastify: FastifyInstance) {
  return fastify.prisma.whatsAppUnknownSender.findMany({
    orderBy: { lastSeenAt: 'desc' },
    take: 25,
  });
}

export async function bindUnknownSender(fastify: FastifyInstance, body: any) {
  const identifier = String(body?.identifier ?? '').trim();
  const operatorId = String(body?.operatorId ?? '').trim();
  if (!identifier || !operatorId) throw { statusCode: 400, message: 'identifier and operatorId are required' };

  const row = await fastify.prisma.whatsAppUnknownSender.findUnique({ where: { identifier } });
  if (!row) throw { statusCode: 404, message: 'Unknown sender not found' };
  if (!row.isLid) {
    // A plain phone number needs no binding — it matches by number already, so
    // the operator's phone is simply wrong or inactive. Say so rather than
    // writing a LID column that will never be consulted.
    throw {
      statusCode: 400,
      message: `${identifier} is a phone number, not a WhatsApp LID. Add or re-activate it as an operator's phone instead.`,
    };
  }

  // One LID belongs to one person. Claiming it from whoever held it before
  // keeps the unique index from rejecting a re-bind after a mistake.
  await fastify.prisma.whatsAppOperator.updateMany({ where: { lid: identifier }, data: { lid: null } });
  const operator = await fastify.prisma.whatsAppOperator.update({
    where: { id: operatorId },
    data: { lid: identifier },
  });
  await fastify.prisma.whatsAppUnknownSender.delete({ where: { identifier } });
  return { bound: true, operator: operator.name, identifier };
}

export async function dismissUnknownSender(fastify: FastifyInstance, identifier: string) {
  await fastify.prisma.whatsAppUnknownSender.deleteMany({ where: { identifier } });
  return { dismissed: true };
}

// ---- conversation + audit views ------------------------------------------

export async function listConversations(fastify: FastifyInstance) {
  return fastify.prisma.agentConversation.findMany({
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
  });
}

export async function getConversation(fastify: FastifyInstance, id: string) {
  const conversation = await fastify.prisma.agentConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 200 } },
  });
  if (!conversation) throw { statusCode: 404, message: 'Conversation not found' };
  return conversation;
}

export async function listToolCalls(fastify: FastifyInstance, query: Record<string, string>) {
  const where: any = {};
  if (query.failedOnly === 'true') where.ok = false;
  if (query.destructiveOnly === 'true') where.destructive = true;
  if (query.toolName) where.toolName = query.toolName;
  return fastify.prisma.agentToolCall.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(query.limit ?? '100', 10) || 100, 200),
  });
}
