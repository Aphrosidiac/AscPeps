import { Resend } from 'resend';

// Deliberately read straight from process.env (dotenv is loaded by
// config/env.ts) rather than the zod schema there: email is fully optional
// infrastructure, and a missing/blank key must never fail server boot.
const FROM_DEFAULT = 'ASCEND Peptides <orders@ascendpeptides.my>';

// EMAIL_ENABLED must be EXACTLY 'true' — the kill switch defaults to off so a
// fresh env (or a staging clone of the prod DB) can never mail real customers.
export function isEmailEnabled(): boolean {
  return process.env.EMAIL_ENABLED === 'true' && !!process.env.RESEND_API_KEY;
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
  // Guard only — the outbox worker checks isEmailEnabled() before picking
  // rows, so hitting this means a code path bypassed the worker.
  if (!isEmailEnabled()) {
    throw new Error('Email sending is disabled (EMAIL_ENABLED must be "true" and RESEND_API_KEY set)');
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
