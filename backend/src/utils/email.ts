import { Resend } from 'resend';
import type { PrismaClient, Prisma } from '@prisma/client';

// Deliberately read straight from process.env (dotenv is loaded by
// config/env.ts) rather than the zod schema there: email is fully optional
// infrastructure, and a missing/blank key must never fail server boot.
const FROM_DEFAULT = 'ASCEND Peptides <orders@ascendpeptides.my>';

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
    from: process.env.EMAIL_FROM || FROM_DEFAULT,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments,
  });

  // The Resend SDK reports API failures via `error`, not by throwing —
  // normalize to a throw so the worker's retry/backoff handling sees it.
  if (error) throw new Error(`Resend: ${error.name}: ${error.message}`);
  if (!data) throw new Error('Resend: no response data');
  return { id: data.id };
}
