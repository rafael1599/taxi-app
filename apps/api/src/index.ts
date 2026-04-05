import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';

import { sql } from 'drizzle-orm';
import { getRedis, closeRedis } from './services/redis.js';
import { initTripWorker, initMaintenanceWorker, closeTripQueue } from './services/tripQueue.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { rideRoutes } from './routes/rides.js';
import { driverRoutes } from './routes/drivers.js';
import { riderRoutes } from './routes/riders.js';
import { locationWsRoutes } from './ws/locationHandler.js';
import { adminAuthRoutes } from './routes/adminAuth.js';
import { adminRoutes } from './routes/admin.js';
import { companyRoutes } from './routes/companies.js';
import { pricingRoutes } from './routes/pricing.js';
import { tripLifecycleRoutes } from './routes/tripLifecycle.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { billingRoutes } from './routes/billing.js';
import { ratingRoutes } from './routes/ratings.js';
import { initWhatsAppSessions } from './services/whatsapp.js';
import { initSentry } from './plugins/sentry.js';

initSentry(process.env.npm_package_version);

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export async function buildApp() {
  const app = Fastify({ logger: true });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await app.register(fastifyHelmet);
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : true;
  await app.register(fastifyCors, { origin: allowedOrigins });
  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: '1 minute',
    redis: getRedis(),
    keyGenerator: (request) => {
      // Rate limit per user (from JWT) or per IP
      const userId = (request as any).user?.id;
      if (userId) return `user:${userId}`;
      return request.ip;
    },
  });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(fastifyWebsocket);

  // ── Error handler ─────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async () => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // Redis check
    try {
      const pong = await getRedis().ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'degraded';
    } catch {
      checks.redis = 'down';
      healthy = false;
    }

    // DB check
    try {
      const { db: database } = await import('@rockland-taxi/db');
      await database.execute(sql`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'down';
      healthy = false;
    }

    return {
      status: healthy ? 'ok' : 'degraded',
      ts: Date.now(),
      checks,
    };
  });

  // ── Metrics endpoint ──────────────────────────────────────────────────────
  app.get('/health/metrics', async () => {
    const redis = getRedis();
    const info = await redis.info('clients');
    const connectedClients = info.match(/connected_clients:(\d+)/)?.[1] ?? '0';
    const sseConnections = (
      await import('./services/sseManager.js')
    ).sseManager.getConnectionCount();

    return {
      ts: Date.now(),
      redis: { connectedClients: Number(connectedClients) },
      sse: { activeConnections: sseConnections },
    };
  });

  // ── Routes ────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(rideRoutes, { prefix: '/api/v1' });
  await app.register(driverRoutes, { prefix: '/api/v1' });
  await app.register(riderRoutes, { prefix: '/api/v1' });
  await app.register(locationWsRoutes, { prefix: '/api/v1' });
  await app.register(adminAuthRoutes, { prefix: '/api/v1' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  await app.register(companyRoutes, { prefix: '/api/v1' });
  await app.register(pricingRoutes, { prefix: '/api/v1' });
  await app.register(tripLifecycleRoutes, { prefix: '/api/v1' });
  await app.register(whatsappRoutes, { prefix: '/api/v1' });
  await app.register(billingRoutes, { prefix: '/api/v1' });
  await app.register(ratingRoutes, { prefix: '/api/v1' });

  // Initialize Redis-backed services after server is ready
  app.addHook('onReady', async () => {
    // Start BullMQ workers
    initTripWorker();
    initMaintenanceWorker();

    // Initialize WhatsApp sessions
    initWhatsAppSessions().catch((err) => {
      app.log.error({ err }, 'Failed to initialize WhatsApp sessions');
    });
  });

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await closeTripQueue();
    await closeRedis();
  });

  return app;
}

// Start server only when run directly (not when imported in tests)
import { fileURLToPath } from 'url';
import { resolve } from 'path';
const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isMain) {
  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`API server listening on port ${PORT}`);
}
