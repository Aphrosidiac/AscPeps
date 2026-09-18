import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendWhatsAppMessage, targetFromChatKey } from '../../utils/whatsapp-send.js';
import { activeRun, actionView, approveAction, declineAction, startTurn, stopRun, subscribe, undoAction, type AgentEvent, type TurnOptions } from './core/run.js';
import { providerConfigured } from './core/provider.js';
import { AGENT_MODELS, EFFORTS, agentModelSettings, saveAgentModelSettings } from './core/models.js';
import { relay, operatorDirectory } from './agent.service.js';
import { ALL_TOOLS, toolsFor } from './registry.js';
import { tierOf, type AgentActor } from './tool-kit.js';
import { deleteMemory, listMemory, readMemory, writeMemory } from './memory.js';
import { runReflection } from './reflect.js';
import { startDigest } from './digest.js';

// The Assistant page's API: threads, turns, and a stream of what a turn is
// doing. The stream is plain SSE over a fetch with the normal auth header —
// not EventSource, which cannot carry one — with event ids so a client that
// drops mid-turn picks up where it left off.
//
// Admin-only, like everything under /api/v1/admin. An admin on the dashboard
// is a full-access actor: the dashboard already lets them do everything the
// tools do, with fewer checks.
export default async function assistantRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  async function webActor(request: FastifyRequest): Promise<AgentActor> {
    const user = request.user as { id?: string; email?: string };
    const admin = user.id ? await fastify.prisma.adminUser.findUnique({ where: { id: user.id }, select: { name: true, email: true } }) : null;
    return { phone: '', name: admin?.name || admin?.email || user.email || 'Admin', canWrite: true };
  }

  function webOptions(actor: AgentActor, threadId: string): TurnOptions {
    return { actor, channel: 'web', origin: { kind: 'web', chatKey: `web:${threadId}`, label: 'the dashboard' } };
  }

  const fail = (reply: FastifyReply, err: unknown) => {
    const e = err as Error & { statusCode?: number };
    return reply.status(e.statusCode ?? 500).send({ message: e.message });
  };

  // ── Threads ──
  fastify.get('/threads', async (request) => {
    const q = request.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(q.limit ?? '60', 10) || 60, 1), 200);
    const threads = await fastify.prisma.agentThread.findMany({
      where: q.kind ? { kind: q.kind } : {},
      orderBy: { lastMessageAt: 'desc' },
      take,
      include: { _count: { select: { actions: { where: { status: 'pending' } } } } },
    });
    return {
      threads: threads.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        chatKey: t.chatKey,
        status: t.status,
        running: !!activeRun(t.id),
        pending: t._count.actions,
        model: t.model,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        costUsd: t.costUsd,
        turns: t.turns,
        lastMessageAt: t.lastMessageAt,
        createdAt: t.createdAt,
      })),
      configured: providerConfigured(),
      model: (await agentModelSettings(fastify)).model,
    };
  });

  fastify.post('/threads', async (request) => {
    const actor = await webActor(request);
    const thread = await fastify.prisma.agentThread.create({ data: { kind: 'chat', model: (await agentModelSettings(fastify)).model, createdBy: actor.name } });
    return { thread: { ...thread, running: false, pending: 0 } };
  });

  fastify.get<{ Params: { id: string } }>('/threads/:id', async (request, reply) => {
    const thread = await fastify.prisma.agentThread.findUnique({
      where: { id: request.params.id },
      include: { messages: { orderBy: { seq: 'asc' } }, actions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!thread) return reply.status(404).send({ message: 'Conversation not found' });
    return {
      thread: {
        ...thread,
        running: !!activeRun(thread.id),
        pending: thread.actions.filter((a) => a.status === 'pending').length,
        messages: thread.messages.map((m) => ({ id: m.id, seq: m.seq, role: m.role, content: m.content, actorName: m.actorName, createdAt: m.createdAt })),
        actions: thread.actions.map(actionView),
      },
    };
  });

  fastify.put<{ Params: { id: string } }>('/threads/:id', async (request, reply) => {
    const title = String((request.body as Record<string, unknown> | undefined)?.title ?? '').trim().slice(0, 120);
    if (!title) return reply.status(400).send({ message: 'Give it a title' });
    const thread = await fastify.prisma.agentThread.update({ where: { id: request.params.id }, data: { title } });
    return { thread };
  });

  fastify.delete<{ Params: { id: string } }>('/threads/:id', async (request, reply) => {
    if (activeRun(request.params.id)) return reply.status(409).send({ message: 'Stop the assistant first' });
    await fastify.prisma.agentThread.delete({ where: { id: request.params.id } });
    return { ok: true };
  });

  // ── Turns ──
  fastify.post<{ Params: { id: string } }>('/threads/:id/turns', async (request, reply) => {
    const text = String((request.body as Record<string, unknown> | undefined)?.text ?? '').trim().slice(0, 20_000);
    if (!text) return reply.status(400).send({ message: 'Say something' });
    const thread = await fastify.prisma.agentThread.findUnique({ where: { id: request.params.id }, select: { kind: true } });
    if (!thread) return reply.status(404).send({ message: 'Conversation not found' });
    // A WhatsApp thread belongs to the operator on the phone; typing into it
    // from here would produce a reply they never see.
    if (thread.kind === 'whatsapp') return reply.status(409).send({ message: 'This conversation is over WhatsApp — reply from there, or start a new one here.' });
    if (!providerConfigured()) return reply.status(503).send({ message: 'OpenRouter is not configured (OPENROUTER_API_KEY missing)' });
    const actor = await webActor(request);
    try {
      const { userMessage } = await startTurn(fastify, request.params.id, text, webOptions(actor, request.params.id));
      return { userMessage };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post<{ Params: { id: string } }>('/threads/:id/stop', async (request) => ({ stopped: stopRun(request.params.id) }));

  // Events of the current (or just-finished) run, from `since` onward.
  fastify.get<{ Params: { id: string } }>('/threads/:id/events', async (request, reply) => {
    const since = Math.max(parseInt((request.query as Record<string, string>).since ?? '0', 10) || 0, 0);
    reply.hijack();
    const raw = reply.raw;
    const origin = request.headers.origin;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // reply.hijack() bypasses @fastify/cors, so the browser needs these set here.
      ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
    });
    const send = (eventId: number, event: AgentEvent) => {
      if (raw.writableEnded) return;
      raw.write(`id: ${eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done' || event.type === 'error') raw.end();
    };
    const unsubscribe = subscribe(request.params.id, since, send);
    if (!unsubscribe) {
      raw.write('event: idle\ndata: {}\n\n');
      raw.end();
      return;
    }
    // A finished run past its last event: nothing more will come.
    if (!activeRun(request.params.id) && !raw.writableEnded) raw.end();
    const ping = setInterval(() => {
      if (!raw.writableEnded) raw.write(': ping\n\n');
    }, 15_000);
    request.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  // ── The operator's decisions ──
  //
  // On a WhatsApp thread the resumed reply has nowhere to go by itself, so it
  // is relayed to the chat the confirmation came from — the operator on the
  // phone sees the outcome whether they answered there or here.
  async function relayIfWhatsApp(threadId: string) {
    const thread = await fastify.prisma.agentThread.findUnique({ where: { id: threadId }, select: { kind: true, chatKey: true } });
    if (thread?.kind !== 'whatsapp' || !thread.chatKey) return;
    const text = await relay(threadId, await operatorDirectory(fastify));
    try {
      await sendWhatsAppMessage(targetFromChatKey(thread.chatKey), text);
    } catch (err) {
      fastify.log.error({ err, threadId }, 'could not relay a dashboard decision to WhatsApp');
    }
  }

  fastify.post<{ Params: { id: string } }>('/actions/:id/approve', async (request, reply) => {
    const actor = await webActor(request);
    const action = await fastify.prisma.agentAction.findUnique({ where: { id: request.params.id }, select: { threadId: true } });
    if (!action) return reply.status(404).send({ message: 'Action not found' });
    try {
      const view = await approveAction(fastify, request.params.id, webOptions(actor, action.threadId));
      void relayIfWhatsApp(action.threadId);
      return { action: view };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post<{ Params: { id: string } }>('/actions/:id/decline', async (request, reply) => {
    const actor = await webActor(request);
    const action = await fastify.prisma.agentAction.findUnique({ where: { id: request.params.id }, select: { threadId: true } });
    if (!action) return reply.status(404).send({ message: 'Action not found' });
    const reason = String((request.body as Record<string, unknown> | undefined)?.reason ?? '').trim() || undefined;
    try {
      const view = await declineAction(fastify, request.params.id, webOptions(actor, action.threadId), reason);
      void relayIfWhatsApp(action.threadId);
      return { action: view };
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.post<{ Params: { id: string } }>('/actions/:id/undo', async (request, reply) => {
    const actor = await webActor(request);
    const action = await fastify.prisma.agentAction.findUnique({ where: { id: request.params.id }, select: { threadId: true } });
    if (!action) return reply.status(404).send({ message: 'Action not found' });
    try {
      return await undoAction(fastify, request.params.id, webOptions(actor, action.threadId));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Memory ──
  //
  // The directory the assistant reads and writes, readable and editable here.
  // Nothing it knows about how to work with you is hidden from you; an admin's
  // edit is attributed to them like any other write.
  fastify.get('/memory', async () => ({
    files: (await listMemory(fastify.prisma)).map((f) => ({ ...f, updatedAt: f.updatedAt.toISOString() })),
  }));

  fastify.get<{ Params: { '*': string } }>('/memory/*', async (request, reply) => {
    const path = decodeURIComponent(request.params['*']);
    const file = await readMemory(fastify.prisma, path);
    if (!file) return reply.status(404).send({ message: 'No such memory file' });
    return { path, content: file.content, updatedBy: file.updatedBy, updatedAt: file.updatedAt.toISOString() };
  });

  fastify.put<{ Params: { '*': string } }>('/memory/*', async (request, reply) => {
    const path = decodeURIComponent(request.params['*']);
    const content = (request.body as Record<string, unknown> | undefined)?.content;
    if (typeof content !== 'string') return reply.status(400).send({ message: 'Send { content }' });
    const actor = await webActor(request);
    try {
      const r = await writeMemory(fastify.prisma, path, content, actor.name);
      return { path: r.path, chars: r.chars };
    } catch (err) {
      return reply.status(400).send({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  fastify.delete<{ Params: { '*': string } }>('/memory/*', async (request, reply) => {
    const path = decodeURIComponent(request.params['*']);
    const r = await deleteMemory(fastify.prisma, path);
    if (!r.deleted) return reply.status(404).send({ message: 'No such memory file' });
    return { ok: true };
  });

  // ── Model ──
  //
  // Which model answers, which one takes over when it fails, and how much it
  // thinks. Stored in settings; the environment is the fallback.
  fastify.get('/settings', async () => ({
    settings: await agentModelSettings(fastify),
    models: AGENT_MODELS,
    efforts: EFFORTS,
  }));

  fastify.put('/settings', async (request, reply) => {
    const body = (request.body ?? {}) as Partial<{ model: string; escalationModel: string | null; effort: string }>;
    try {
      return { settings: await saveAgentModelSettings(fastify, body) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  // ── Housekeeping ──
  fastify.post('/reflect', async (request, reply) => {
    if (!providerConfigured()) return reply.status(503).send({ message: 'OpenRouter is not configured' });
    const actor = await webActor(request);
    return { threadId: await runReflection(fastify, actor) };
  });

  // Answers as soon as the brief's thread exists; the page opens it and
  // watches it being written, and the send happens when the run ends.
  fastify.post('/digest', async (request, reply) => {
    if (!providerConfigured()) return reply.status(503).send({ message: 'OpenRouter is not configured' });
    const actor = await webActor(request);
    const { threadId, finished } = await startDigest(fastify, actor);
    void finished.catch((err) => fastify.log.error({ err, threadId }, 'morning brief failed'));
    return { threadId };
  });

  fastify.get('/tools', async () => {
    const offered = new Set(toolsFor(true).map((t) => t.name));
    return {
      tools: ALL_TOOLS.map((t) => ({ name: t.name, tier: tierOf(t), description: t.description, undoable: !!t.undo, offered: offered.has(t.name) })),
    };
  });

}
