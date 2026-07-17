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
});

export const env = envSchema.parse(process.env);
