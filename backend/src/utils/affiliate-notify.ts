import type { FastifyInstance } from 'fastify';
import { orderNotifyEnabled, orderNotifyRecipients } from './order-notify.js';
import { sendWhatsAppMessage } from './whatsapp-send.js';

/**
 * Tells the team about affiliate events that need a person: a new application
 * to approve, a payout to transfer. Goes to whoever gets the order notices
 * (Routines → Order notice) and only while those are switched on — the same
 * people, the same switch, no second list to keep. Never throws.
 */
export async function notifyAffiliateTeam(fastify: FastifyInstance, text: string): Promise<number> {
  try {
    if (!(await orderNotifyEnabled(fastify))) return 0;
    let sent = 0;
    for (const t of await orderNotifyRecipients(fastify)) {
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
