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
import adminEmailRoutes from './modules/admin/admin-emails.routes.js';
import adminDashboardRoutes from './modules/admin/admin-dashboard.routes.js';
import adminFinanceRoutes from './modules/admin/admin-finance.routes.js';
import adminSettingsRoutes from './modules/admin/admin-settings.routes.js';
import publicSettingsRoutes from './modules/settings/settings.routes.js';
import adminUploadRoutes from './modules/admin/admin-upload.routes.js';
import adminDiscountRoutes from './modules/admin/admin-discounts.routes.js';
import paymentRoutes from './modules/payments/payments.routes.js';
import insightRoutes from './modules/insights/insights.routes.js';
import adminInsightRoutes from './modules/admin/admin-insights.routes.js';
import adminDeliveryRoutes from './modules/admin/admin-delivery.routes.js';
import resendWebhookRoutes from './modules/webhooks/resend-webhook.routes.js';
import whatsappRoutes from './modules/whatsapp/whatsapp.routes.js';
import internalAgentRoutes from './modules/ai-agent/agent.routes.js';
import { reconcileStaleOrders } from './utils/payment-reconcile.js';
import { processEmailOutbox } from './utils/email-worker.js';

const fastify = Fastify({
  // Trust exactly one hop (the nginx in front) — `true` would trust the
  // client-supplied X-Forwarded-For chain, letting anyone spoof req.ip and
  // reset their rate-limit bucket per request.
  trustProxy: 1,
  // pino-pretty is a devDependency — hardcoding the transport crashes a
  // production `npm ci --omit=dev` deploy at boot. Plain JSON logs in prod.
  logger: process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : true,
});

const corsOrigins = [env.FRONTEND_URL, ...env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)];
// @fastify/cors defaults `methods` to 'GET,HEAD,POST' — it does NOT infer
// allowed methods from registered routes. Left implicit, this silently
// blocks every PATCH/DELETE admin action (edit/deactivate/delete a
// product, order, discount, etc.) for any genuinely cross-origin caller.
// Harmless in production today only because nginx reverse-proxies the API
// on the same origin as the frontend, so real browser traffic there never
// triggers a CORS preflight at all — but it breaks local dev (frontend and
// backend on different ports) and any future different-origin deployment.
await fastify.register(cors, {
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
});
await fastify.register(helmet, { contentSecurityPolicy: false });
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
  // The WhatsApp worker calls the agent endpoint from the loopback interface,
  // so every message it forwards shares a single per-IP bucket — a busy ops
  // group would rate-limit the agent against itself. That route has its own
  // stronger gate (loopback source address + the shared worker token), so the
  // public limiter adds nothing there but a failure mode.
  allowList: (req) => req.url.startsWith('/api/v1/internal/agent'),
});
await fastify.register(formbody);
await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
await fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), 'uploads'),
  prefix: '/uploads/',
  decorateReply: false,
  // Defense-in-depth for user-uploaded files: even if a file's bytes were
  // somehow HTML/SVG, this CSP + nosniff stops the browser executing it.
  setHeaders: (res) => {
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
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
await fastify.register(adminEmailRoutes, { prefix: '/api/v1/admin/emails' });
await fastify.register(adminDashboardRoutes, { prefix: '/api/v1/admin/dashboard' });
await fastify.register(adminFinanceRoutes, { prefix: '/api/v1/admin/finance' });
await fastify.register(adminSettingsRoutes, { prefix: '/api/v1/admin/settings' });
await fastify.register(adminUploadRoutes, { prefix: '/api/v1/admin/upload' });
await fastify.register(adminDiscountRoutes, { prefix: '/api/v1/admin/discounts' });
await fastify.register(paymentRoutes, { prefix: '/api/v1/payments' });
await fastify.register(insightRoutes, { prefix: '/api/v1/insights' });
await fastify.register(adminInsightRoutes, { prefix: '/api/v1/admin/insights' });
await fastify.register(adminDeliveryRoutes, { prefix: '/api/v1/admin/delivery' });
// Public — Resend's servers call this directly (see the route file for why
// it needs its own scoped raw-body content-type parser). The global rate
// limiter above still applies fine as-is.
await fastify.register(resendWebhookRoutes, { prefix: '/api/v1/webhooks/resend' });
// Admin-authenticated control of the WhatsApp worker and the agent's allowlists.
await fastify.register(whatsappRoutes, { prefix: '/api/v1/admin/whatsapp' });
// The WhatsApp worker's callback into the agent. Guarded by loopback source
// address + the shared worker token rather than the admin JWT — the caller is a
// sibling process, not a signed-in human. Registered last so nothing above can
// shadow it.
await fastify.register(internalAgentRoutes, { prefix: '/api/v1/internal/agent' });

try {
  await fastify.listen({ port: env.PORT, host: env.HOST });
  fastify.log.info(`ASCEND API running on http://${env.HOST}:${env.PORT}`);

  // Reconcile stale online-payment orders: confirm any whose callback was
  // missed, and release stock held by abandoned/never-paid orders.
  //
  // This deployment only ever runs each app as a single PM2 fork instance
  // (never cluster mode — see the bcryptjs+cluster note elsewhere in this
  // codebase), so there is inherently only one process to run these
  // intervals on; no "primary instance" guard is needed.
  //
  // A previous version of this guard checked `pm_id === '0'`/
  // `NODE_APP_INSTANCE === '0'` to skip extra copies in a hypothetical
  // cluster-mode future. That check was actually silently broken in
  // production the whole time it existed: this server runs six unrelated
  // PM2 apps under one shared daemon, and pm_id/NODE_APP_INSTANCE are
  // apparently assigned from a value tied to that daemon-wide process
  // count, not one scoped per app name — ascend-api's pm_id was 2, never
  // 0. The guard was therefore always false here, and both intervals below
  // silently never ran. If cluster mode is ever introduced for a specific
  // app, reintroduce a guard then — using something that actually
  // identifies "am I cluster worker 0 of THIS app" (e.g. Node's own
  // `cluster.isPrimary`), not a raw pm_id/NODE_APP_INSTANCE comparison.
  const RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
  const timer = setInterval(() => {
    reconcileStaleOrders(fastify).catch((err) =>
      fastify.log.error({ err }, 'payment reconcile sweep failed')
    );
  }, RECONCILE_INTERVAL_MS);
  timer.unref();

  // Drain the transactional-email outbox (order confirmations / payment
  // receipts queued by state changes). No-op until emails_enabled is set.
  const EMAIL_INTERVAL_MS = 30 * 1000;
  const emailTimer = setInterval(() => {
    processEmailOutbox(fastify).catch((err) =>
      fastify.log.error({ err }, 'email outbox sweep failed')
    );
  }, EMAIL_INTERVAL_MS);
  emailTimer.unref();
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
