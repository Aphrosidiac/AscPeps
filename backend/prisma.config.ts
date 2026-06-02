import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join(import.meta.dirname, 'prisma', 'schema.prisma'),
  datasource: {
    // `prisma generate` (run from postinstall) doesn't connect to the DB, but the
    // CLI still requires the URL to resolve. Fall back to a placeholder so a fresh
    // install without DATABASE_URL can still generate the client. The running app
    // uses its own validated env (config/env.ts + plugins/prisma.ts); db push /
    // migrate are always run with the real DATABASE_URL present.
    url: process.env.DATABASE_URL || 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
