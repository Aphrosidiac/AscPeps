import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  external: [
    '@prisma/client',
    '@prisma/adapter-pg',
    'prisma',
    'bcryptjs',
    'pg',
    'pino-pretty',
  ],
  noExternal: [
    'fastify-plugin',
  ],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});
