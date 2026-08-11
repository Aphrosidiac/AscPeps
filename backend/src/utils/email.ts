import { Resend } from 'resend';
import type { PrismaClient, Prisma } from '@prisma/client';

// Deliberately read straight from process.env (dotenv is loaded by
// config/env.ts) rather than the zod schema there: email is fully optional
// infrastructure, and a missing/blank key must never fail server boot.
const FROM_DEFAULT = 'Ascend Peptides <orders@ascendpeptides.my>';
// Marketing sender. A separate mailbox from orders@ on purpose: mailbox
// providers score reputation per from-address, so a newsletter that picks up
// complaints must not be able to push order confirmations and payment
// receipts into anyone's spam folder.
//
// Derived from EMAIL_FROM by swapping only the local part, rather than
// hardcoding a domain. Resend will only send from a domain that has been
// verified there, and this deployment's verified domain is a subdomain
// (mail.ascendpeptides.my) — a hardcoded news@ascendpeptides.my would be
// rejected at send time, i.e. an entire campaign failing for a reason
// invisible from the code. Deriving it means marketing always leaves from
// whatever domain transactional mail already leaves from, which is by
// definition verified.
const MARKETING_LOCAL_PART = 'news';
const MARKETING_FROM_DEFAULT = `Ascend Peptides <${MARKETING_LOCAL_PART}@ascendpeptides.my>`;

export function marketingFrom(): string {
  if (process.env.EMAIL_FROM_MARKETING) return process.env.EMAIL_FROM_MARKETING;

  const transactional = process.env.EMAIL_FROM;
  // Matches both "Name <user@host>" and a bare "user@host".
  const match = transactional?.match(/^(.*<)?[^@<\s]+@([^>\s]+)>?$/);
  if (match) {
    const prefix = match[1] ?? '';
    const domain = match[2];
    return prefix ? `${prefix}${MARKETING_LOCAL_PART}@${domain}>` : `${MARKETING_LOCAL_PART}@${domain}`;
  }
  return MARKETING_FROM_DEFAULT;
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

// The actual on/off switch is a DB setting (key "emails_enabled"), not an env
// var — every environment (local, staging, prod) has its own database, so
// this stays independently controllable per environment with no redeploy or
// restart, toggleable from the admin Emails page. Defaults to disabled when
// the row doesn't exist yet, so a freshly-deployed or staging-cloned database
// can never mail real customers until someone flips it on deliberately.
// RESEND_API_KEY is still a hard prerequisite — without it there's nothing to
// toggle on.
export async function isEmailEnabled(prisma: PrismaLike): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  const setting = await prisma.setting.findUnique({ where: { key: 'emails_enabled' } });
  return setting?.value === 'true';
}

// Lazy singleton — constructing Resend at import time would throw when the
// key is absent, taking down deployments that don't use email at all.
let client: Resend | null = null;
function getClient(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
  // Extra RFC headers. Only marketing mail uses this, to carry the
  // List-Unsubscribe pair (see utils/marketing.ts) that Gmail and Yahoo now
  // require on bulk sends — omitting it is itself treated as a spam signal.
  headers?: Record<string, string>;
  // Overrides EMAIL_FROM for this one send. Marketing goes out from a
  // different mailbox than orders so that a newsletter complaint can never
  // drag the reputation of the address that sends payment receipts down with
  // it — the two are separated at the sender, not just in intent.
  from?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<{ id: string }> {
  // Guard only — the outbox worker and enqueueEmail() both check
  // isEmailEnabled() before this is ever reached, so hitting this means a
  // code path bypassed both. This checks just the capability (a key to call
  // Resend with), not the on/off setting — that's their job, not this one's.
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Email sending is disabled (RESEND_API_KEY not set)');
  }

  const { data, error } = await getClient().emails.send({
    from: params.from || process.env.EMAIL_FROM || FROM_DEFAULT,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments,
    headers: params.headers,
  });

  // The Resend SDK reports API failures via `error`, not by throwing —
  // normalize to a throw so the worker's retry/backoff handling sees it.
  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  if (!data) throw new Error('Resend: no response data');
  return { id: data.id };
}
