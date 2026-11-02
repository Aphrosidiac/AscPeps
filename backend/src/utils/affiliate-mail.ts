import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { renderAffiliateEmail, type AffiliateMail, type AffiliateMailContext } from '../emails/affiliate.js';
import { isEmailEnabled, sendEmail } from './email.js';
import { getAffiliateSettings, pct } from './affiliate.js';
import { affiliatePortalUrl } from './affiliate-url.js';

/** Everything a template needs about one affiliate, read fresh. */
export async function affiliateMailContext(fastify: FastifyInstance, affiliateId: string): Promise<AffiliateMailContext & { to: string }> {
  const [a, settings] = await Promise.all([
    fastify.prisma.affiliate.findUniqueOrThrow({
      where: { id: affiliateId },
      select: { fullName: true, rateBps: true, member: { select: { email: true } }, discountCode: { select: { code: true } } },
    }),
    getAffiliateSettings(fastify.prisma),
  ]);
  const store = env.FRONTEND_URL.replace(/\/$/, '');
  return {
    to: a.member.email,
    // First name only: "Hi Amir," not "Hi Amir Hakim bin Abdullah,".
    name: a.fullName.trim().split(/\s+/)[0] || a.fullName,
    code: a.discountCode.code,
    rate: pct(a.rateBps),
    customerDiscountPct: settings.customerDiscountPct,
    portalUrl: affiliatePortalUrl(),
    shareUrl: `${/localhost|127\.0\.0\.1/.test(store) ? store : 'https://ascendpeptides.my'}/?ref=${a.discountCode.code}`,
  };
}

/**
 * Email an affiliate about their application, a payout or a change of
 * details. Behind the same switch as every other mail (emails_enabled + a
 * Resend key); while it is off the mail is only logged. Never throws: the
 * approval, payout or decision it reports has already happened, and the
 * portal shows the same thing.
 */
export async function mailAffiliate(fastify: FastifyInstance, affiliateId: string, mail: AffiliateMail): Promise<void> {
  try {
    const { to, ...ctx } = await affiliateMailContext(fastify, affiliateId);
    const settingsRows = await fastify.prisma.setting.findMany();
    const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
    const { subject, html } = renderAffiliateEmail(mail, ctx, settings);
    if (!(await isEmailEnabled(fastify.prisma))) {
      fastify.log.info({ to, subject, kind: mail.kind }, 'Email disabled — affiliate email not sent');
      return;
    }
    await sendEmail({ to, subject, html });
  } catch (err) {
    fastify.log.error({ err, affiliateId, kind: mail.kind }, 'affiliate email could not be sent');
  }
}
