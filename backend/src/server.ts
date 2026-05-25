import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { env } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import authPlugin from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';

import categoryRoutes from './modules/categories/categories.routes.js';
import productRoutes from './modules/products/products.routes.js';
import orderRoutes from './modules/orders/orders.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import adminProductRoutes from './modules/admin/admin-products.routes.js';
import adminOrderRoutes from './modules/admin/admin-orders.routes.js';
import adminDashboardRoutes from './modules/admin/admin-dashboard.routes.js';
import adminSettingsRoutes from './modules/admin/admin-settings.routes.js';
import publicSettingsRoutes from './modules/settings/settings.routes.js';
import adminUploadRoutes from './modules/admin/admin-upload.routes.js';

const fastify = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
});

const corsOrigins = [env.FRONTEND_URL, ...env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)];
await fastify.register(cors, { origin: corsOrigins, credentials: true });
await fastify.register(helmet, { contentSecurityPolicy: false });
await fastify.register(rateLimit, { max: 100, timeWindow: '1 minute', keyGenerator: (req) => req.ip });
await fastify.register(formbody);
await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
await fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), 'uploads'),
  prefix: '/uploads/',
  decorateReply: false,
});

await fastify.register(prismaPlugin);
await fastify.register(authPlugin);
await fastify.register(errorHandler);

fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

await fastify.register(categoryRoutes, { prefix: '/api/v1/categories' });
await fastify.register(productRoutes, { prefix: '/api/v1/products' });
await fastify.register(orderRoutes, { prefix: '/api/v1/orders' });
await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
await fastify.register(publicSettingsRoutes, { prefix: '/api/v1/settings' });
await fastify.register(adminProductRoutes, { prefix: '/api/v1/admin/products' });
await fastify.register(adminOrderRoutes, { prefix: '/api/v1/admin/orders' });
await fastify.register(adminDashboardRoutes, { prefix: '/api/v1/admin/dashboard' });
await fastify.register(adminSettingsRoutes, { prefix: '/api/v1/admin/settings' });
await fastify.register(adminUploadRoutes, { prefix: '/api/v1/admin/upload' });

try {
  await fastify.listen({ port: env.PORT, host: env.HOST });
  fastify.log.info(`ASCEND API running on http://${env.HOST}:${env.PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
