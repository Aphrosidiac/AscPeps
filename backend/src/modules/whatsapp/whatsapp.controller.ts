import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

// Thin proxy from the admin dashboard to the worker's localhost control plane.
// The worker binds to 127.0.0.1 only, so this is the sole path to it — which is
// the point: pairing, stopping and logging out are admin-authenticated here,
// and unreachable from outside the box.
async function workerRequest(path: string, body?: any) {
  const url = `http://127.0.0.1:${env.WORKER_HTTP_PORT}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WORKER_HTTP_TOKEN}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

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
