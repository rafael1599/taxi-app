import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';

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
  await app.register(fastifyRateLimit, { max: 200, timeWindow: '1 minute' });
  await app.register(fastifyJwt, { secret: JWT_SECRET });
  await app.register(fastifyWebsocket);

  // ── Error handler ─────────────────────────────────────────────────────────
  app.setErrorHandler(errorHandler);

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

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
