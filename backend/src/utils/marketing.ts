import crypto from 'crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { isEmailEnabled } from './email.js';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const SITE_URL = 'https://ascendpeptides.my';

function siteUrl(): string {
  return process.env.FRONTEND_URL || SITE_URL;
}

/**
 * Marketing mail is gated by its own setting ON TOP of the transactional one,
 * not instead of it. The two are genuinely separate decisions: an outage, a
 * domain-reputation scare, or simply "stop the campaigns for now" should be
 * able to silence newsletters while order confirmations and payment receipts
 * keep going out. Collapsing them into one switch means the only way to pause
 * marketing is to stop telling customers their orders exist.
 *
 * Defaults to OFF when the row is absent, same as isEmailEnabled — a
 * freshly-seeded or staging-cloned database cannot mail a real list by
 * accident.
 */
export async function isMarketingEnabled(prisma: PrismaLike): Promise<boolean> {
  if (!(await isEmailEnabled(prisma))) return false;
  const setting = await prisma.setting.findUnique({ where: { key: 'marketing_emails_enabled' } });
  return setting?.value === 'true';
}

/**
 * 32 url-safe characters from the CSPRNG. Long enough that guessing one to
 * unsubscribe a stranger is not a thing, short enough to survive being
 * wrapped by a mail client mid-URL.
 */
export function newUnsubscribeToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function unsubscribeUrl(token: string): string {
  return `${siteUrl()}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * RFC 8058 one-click unsubscribe. Gmail and Yahoo both require this on bulk
 * mail now, and its absence is itself a spam signal — so every marketing send
 * carries it, and the POST endpoint it points at must work without a session,
 * a redirect, or a confirmation page.
 *
 * The mailto: fallback is listed second deliberately: clients that understand
 * List-Unsubscribe-Post use the https URL, and the ones that don't at least
 * have somewhere to send a human-readable request.
 */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  const url = `${siteUrl()}/api/v1/subscribers/unsubscribe?token=${encodeURIComponent(token)}`;
  return {
    'List-Unsubscribe': `<${url}>, <mailto:unsubscribe@ascendpeptides.my>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Mint the single-use first-order code that rides in the welcome email.
 *
 * Unambiguous alphabet: no O/0, I/1, or S/5 — this code gets read off a phone
 * screen and retyped into the checkout box, and the pairs above are where that
 * goes wrong. Codes are stored (and compared) uppercase, matching the existing
 * discount-code convention.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ23456789';

export function newWelcomeCode(): string {
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `ASC${out}`;
}
