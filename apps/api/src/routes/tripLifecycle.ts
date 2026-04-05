import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireDriver, requireAuth, requireRider } from '../middleware/auth.js';
import {
  startDriverSearch,
  acceptOffer,
  rejectOffer,
  updateTripStatus,
  checkAutoArrival,
  setDriverOnline,
  setDriverOffline,
} from '../services/tripLifecycle.js';
import { updateDriverLocation } from '../services/dispatch.js';
import { sseManager } from '../services/sseManager.js';

const offerResponseSchema = z.object({
  offerId: z.string().uuid(),
});

const statusUpdateSchema = z.object({
  status: z.enum(['en_route', 'arrived', 'picked_up', 'completed']),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export async function tripLifecycleRoutes(app: FastifyInstance) {
  // ── POST /rides/:id/dispatch — trigger automatic driver search ────────────
  app.post('/rides/:id/dispatch', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };

    const result = await startDriverSearch(id, user.companyId);
    if (!result.success) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.send(result);
  });

  // ── POST /trips/offers/:offerId/accept — driver accepts offer ─────────────
  app.post(
    '/trips/offers/:offerId/accept',
    { preHandler: requireDriver },
    async (request, reply) => {
      const { offerId } = request.params as { offerId: string };
      const user = request.user as { sub: string; companyId: string };

      const result = await acceptOffer(offerId, user.sub, user.companyId);
      if (!result.success) {
        return reply.code(409).send({ error: result.error });
      }
      return reply.send(result);
    },
  );

  // ─�� POST /trips/offers/:offerId/reject — driver rejects offer ─────���───────
  app.post(
    '/trips/offers/:offerId/reject',
    { preHandler: requireDriver },
    async (request, reply) => {
      const { offerId } = request.params as { offerId: string };
      const user = request.user as { sub: string; companyId: string };

      const result = await rejectOffer(offerId, user.sub, user.companyId);
      if (!result.success) {
        return reply.code(409).send({ error: result.error });
      }
      return reply.send(result);
    },
  );

  // ── POST /rides/:id/status — driver updates trip status ─────────���─────────
  app.post('/rides/:id/status', { preHandler: requireDriver }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };
    const { status } = statusUpdateSchema.parse(request.body);

    const result = await updateTripStatus(id, user.sub, user.companyId, status);
    if (!result.success) {
      return reply.code(409).send({ error: result.error });
    }
    return reply.send(result.ride);
  });

  // ── POST /drivers/location — driver GPS update (every 10s) ────────────────
  app.post('/drivers/location', { preHandler: requireDriver }, async (request, reply) => {
    const user = request.user as { sub: string };
    const { lat, lng } = locationSchema.parse(request.body);

    await updateDriverLocation(user.sub, lat, lng);

    // Check auto-arrival
    await checkAutoArrival(user.sub, lat, lng);

    return reply.send({ ok: true });
  });

  // ── POST /drivers/online — driver goes online ─────────────────────────────
  app.post('/drivers/online', { preHandler: requireDriver }, async (request, reply) => {
    const user = request.user as { sub: string; companyId: string };
    await setDriverOnline(user.sub, user.companyId);
    return reply.send({ status: 'idle' });
  });

  // ── POST /drivers/offline — driver goes offline ───────────────────────────
  app.post('/drivers/offline', { preHandler: requireDriver }, async (request, reply) => {
    const user = request.user as { sub: string; companyId: string };
    await setDriverOffline(user.sub, user.companyId);
    return reply.send({ status: 'offline' });
  });

  // ── GET /drivers/events — SSE stream for driver real-time updates ─────────
  app.get('/drivers/events', { preHandler: requireDriver }, async (request, reply) => {
    const user = request.user as { sub: string };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connected event
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ driverId: user.sub })}\n\n`);

    // Register connection
    sseManager.addConnection(user.sub, reply);

    // Keep alive every 30s
    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseManager.removeConnection(user.sub);
      }
    }, 30_000);

    // Clean up on disconnect
    request.raw.on('close', () => {
      clearInterval(keepAlive);
      sseManager.removeConnection(user.sub);
    });

    // Don't call reply.send() — we're streaming
  });
}
