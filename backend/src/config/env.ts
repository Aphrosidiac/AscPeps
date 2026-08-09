import { z } from 'zod';
import 'dotenv/config';

// z.coerce.boolean() is WRONG for string env vars: Boolean("false") === true,
// so any non-empty value (incl. "false") becomes true. Parse the string instead.
const envBool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .default(def)
    .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(v.trim().toLowerCase())));

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  PORT: z.coerce.number().default(3105),
  HOST: z.string().default('0.0.0.0'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default(''),
  // In production, nginx proxies the ENTIRE /api/ prefix on FRONTEND_URL's
  // public domain to this backend — so a request to `${FRONTEND_URL}/api/revalidate`
  // never reaches the Next.js server at all, it loops back here as a 404.
  // This must point directly at the Next.js process's own internal port,
  // bypassing nginx. Falls back to FRONTEND_URL for local dev, where the
  // frontend dev server IS already reachable directly (no nginx in front).
  FRONTEND_INTERNAL_URL: z.string().optional(),
  // Shared with the frontend's /api/revalidate route. Optional so a missing
  // secret degrades to "storefront stays cached until the next full deploy
  // or the 1hr window elapses" rather than crashing product saves.
  REVALIDATE_SECRET: z.string().optional(),
  WHATSAPP_NUMBER: z.string().default('601161092723'),
  BILLPLZ_API_KEY: z.string().optional(),
  BILLPLZ_COLLECTION_ID: z.string().optional(),
  BILLPLZ_SIGNATURE_KEY: z.string().optional(),
  BILLPLZ_SANDBOX: envBool(true),
  TOYYIBPAY_SECRET_KEY: z.string().optional(),
  TOYYIBPAY_CATEGORY_CODE: z.string().optional(),
  TOYYIBPAY_SANDBOX: envBool(true),
  // Offers DuitNow QR alongside FPX on the hosted bill page. On by default
  // because the account is approved for it and FPX-only is a dead end for
  // anyone without Malaysian online banking. Set to false to fall back to
  // FPX-only without a code change if the account ever loses approval —
  // createBill rejects enableDuitNowQR on a non-approved account.
  TOYYIBPAY_DUITNOW_QR: envBool(true),
  // Server-side analytics. This is the SAME project token the frontend uses
  // (PostHog project tokens are write-only, not a secret in the credential
  // sense) — but it lives here unprefixed because it must never be inlined
  // into the client bundle from this side. Absent key = analytics off.
  POSTHOG_API_KEY: z.string().optional(),
  // US to match the live project's region. A region mismatch does not error,
  // it silently drops events — keep in step with NEXT_PUBLIC_POSTHOG_HOST.
  POSTHOG_HOST: z.string().default('https://us.i.posthog.com'),
  POSTHOG_ENABLED: envBool(false),

  // ---- WhatsApp AI agent ----
  // The agent runs in its own PM2 process (whatsapp-worker/worker.ts) holding
  // the baileys socket; this API process only ever proxies to its localhost
  // control plane. Both read the same .env independently.
  WORKER_HTTP_PORT: z.coerce.number().default(3106),
  WORKER_HTTP_TOKEN: z.string().default('ascend-worker-token'),
  // Redis backs message dedup. Without it a worker restart re-processes the
  // messages baileys replays on reconnect — which for an agent with write
  // tools means re-running real mutations, not just a duplicate reply.
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  // Master kill-switch for ALL outbound WhatsApp traffic. Off by default so a
  // fresh deploy can pair the number and watch inbound traffic land before the
  // agent is allowed to speak (or act) in a real chat.
  WHATSAPP_AGENT_ENABLED: envBool(false),
  // OpenRouter (OpenAI-compatible). Absent key = agent disabled, worker still
  // connects and records inbound messages.
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('deepseek/deepseek-v4-flash'),
  // Downtime alerting. A dropped baileys socket is invisible from outside:
  // PM2 stays green (the process never dies, only the socket does) and the
  // site keeps returning 200. These are the out-of-band signal.
  ALERT_DOWN_AFTER_MINUTES: z.coerce.number().default(10),
  ALERT_TELEGRAM_BOT_TOKEN: z.string().optional(),
  ALERT_TELEGRAM_CHAT_ID: z.string().optional(),
  ALERT_WEBHOOK_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);

// Mirrors the production guard the worker applies to itself. Kept here too so
// a misconfigured API process fails at boot rather than silently proxying to a
// control plane protected by a publicly-known default token.
if (process.env.NODE_ENV === 'production' && env.WORKER_HTTP_TOKEN === 'ascend-worker-token') {
  throw new Error(
    "WORKER_HTTP_TOKEN must be set to a non-default value in production (openssl rand -base64 24), matching the value in the worker's environment."
  );
}
