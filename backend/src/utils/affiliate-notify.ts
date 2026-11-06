import type { FastifyInstance } from 'fastify';
import { orderNotifyEnabled, orderNotifyRecipients } from './order-notify.js';
import { sendWhatsAppMessage } from './whatsapp-send.js';

// Just what a notice needs, so the ledger can send one from a plain client.
export type Notifier = Pick<FastifyInstance, 'prisma' | 'log'>;

// For test-affiliate.ts: sees every notice instead of WhatsApp.
let sink: ((text: string) => void) | null = null;
export function captureAffiliateNotices(fn: ((text: string) => void) | null) {
  sink = fn;
}

/**
 * Tells the team about the affiliate events that need a person or that moved
 * money (the list is in docs/affiliate.md, kept short on purpose). Goes to whoever gets the order notices
 * (Routines → Order notice) and only while those are switched on — the same
 * people, the same switch, no second list to keep. Never throws.
 */
export async function notifyAffiliateTeam(fastify: Notifier, text: string): Promise<number> {
  try {
    if (sink) {
      sink(text);
      return 1;
    }
    if (!(await orderNotifyEnabled(fastify as FastifyInstance))) return 0;
    let sent = 0;
    for (const t of await orderNotifyRecipients(fastify as FastifyInstance)) {
      try {
        await sendWhatsAppMessage(t.to, text);
        sent++;
      } catch (err) {
        fastify.log.error({ err, to: t.name }, 'affiliate notice could not be sent');
      }
    }
    return sent;
  } catch (err) {
    fastify.log.error({ err }, 'affiliate notice failed');
    return 0;
  }
}
