import { defineConfig } from 'tsup';

export default defineConfig({
  // The browser worker is its own entry: core/browser.ts forks
  // dist/browser-worker.js only while Abby's browser is awake.
  entry: { server: 'src/server.ts', 'browser-worker': 'src/modules/ai-agent/core/browser-worker.ts' },
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
    'pdfkit',
  ],
  noExternal: [
    'fastify-plugin',
  ],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});
