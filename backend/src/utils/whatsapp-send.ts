/**
 * Sending a WhatsApp message from the API.
 *
 * The API cannot talk to WhatsApp directly — the worker process holds the
 * baileys socket, and it binds to 127.0.0.1 only. Everything outbound goes
 * through its control plane, so this is the single place that knows how.
 *
 * Kept separate from whatsapp.controller.ts because the reminder sweep needs
 * to send without going anywhere near a FastifyReply: a scheduled job has no
 * HTTP request to answer, and threading a fake one through would be worse than
 * having one shared function both callers use.
 */
import { env } from '../config/env.js';

export interface SendTarget {
  /** A phone number in any format — the worker normalises it to a JID. */
  phone?: string;
  /** A full JID. Required for groups, which have no phone number. */
  jid?: string;
}

export async function workerRequest(path: string, body?: any) {
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

/**
 * Send one message. Throws with a readable reason on failure — the caller
 * decides whether that means "retry later" (the reminder sweep) or "show the
 * admin an error" (the dashboard's test button).
 */
export async function sendWhatsAppMessage(target: SendTarget, message: string): Promise<void> {
  const res = await workerRequest('/send', { ...target, message });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as any;
    // 409 is the worker saying WhatsApp is not connected — a temporary state
    // worth retrying, not a bad request. The message says so plainly because
    // it ends up stored on the reminder as lastError and read by a human.
    throw new Error(body?.message || `worker returned ${res.status}`);
  }
}

/**
 * Resolve a conversation key ("dm:0123456789" / "group:120…@g.us") into
 * something the worker can address.
 *
 * Deliberately the same key format AgentConversation uses, so "send it back to
 * where we are talking" is a straight copy rather than a second addressing
 * scheme that can drift out of step with the first.
 */
export function targetFromChatKey(chatKey: string): SendTarget {
  if (chatKey.startsWith('group:')) return { jid: chatKey.slice('group:'.length) };
  if (chatKey.startsWith('dm:')) return { phone: chatKey.slice('dm:'.length) };
  throw new Error(`Unrecognised chat key: ${chatKey}`);
}
