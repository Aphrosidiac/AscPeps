import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  PORT: z.coerce.number().default(3105),
  HOST: z.string().default('0.0.0.0'),
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  WHATSAPP_NUMBER: z.string().default('601161092723'),
  BILLPLZ_API_KEY: z.string().optional(),
  BILLPLZ_COLLECTION_ID: z.string().optional(),
  BILLPLZ_SIGNATURE_KEY: z.string().optional(),
  BILLPLZ_SANDBOX: z.coerce.boolean().default(true),
});

export const env = envSchema.parse(process.env);
