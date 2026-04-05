import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@rockland-taxi/db';
import { eq, and, desc } from 'drizzle-orm';
import { requireRider, requireDriver, requireAuth, getCompanyId } from '../middleware/auth.js';
import { estimateFare } from '../services/fare.js';

const requestRideSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  pickupAddress: z.string().min(1),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
  dropoffAddress: z.string().min(1),
});

const cancelRideSchema = z.object({
  reason: z.string().optional(),
});

export async function rideRoutes(app: FastifyInstance) {
  // POST /rides — rider requests a ride
  app.post('/rides', { preHandler: requireRider }, async (request, reply) => {
    const user = request.user as { sub: string; companyId: string };
    const body = requestRideSchema.parse(request.body);

    const { distanceKm, durationMin, fareUsd } = estimateFare(
      body.pickupLat,
      body.pickupLng,
      body.dropoffLat,
      body.dropoffLng,
    );

    const [ride] = await db
      .insert(schema.rides)
      .values({
        companyId: user.companyId,
        riderId: user.sub,
        pickupLat: body.pickupLat,
        pickupLng: body.pickupLng,
        pickupAddress: body.pickupAddress,
        dropoffLat: body.dropoffLat,
        dropoffLng: body.dropoffLng,
        dropoffAddress: body.dropoffAddress,
        distanceKm,
        durationMin,
        fareEstimate: fareUsd.toFixed(2),
        status: 'requested',
      })
      .returning();

    return reply.code(201).send(ride);
  });

  // GET /rides — list caller's rides
  app.get('/rides', { preHandler: requireAuth }, async (request) => {
    const user = request.user as { sub: string; role: string; companyId?: string };

    const conditions = [
      user.role === 'rider'
        ? eq(schema.rides.riderId, user.sub)
        : eq(schema.rides.driverId, user.sub),
    ];

    // Company scope for non-admins
    if (user.companyId) {
      conditions.push(eq(schema.rides.companyId, user.companyId));
    }

    return db.query.rides.findMany({
      where: and(...conditions),
      orderBy: [desc(schema.rides.createdAt)],
      limit: 50,
    });
  });

  // GET /rides/:id — get a single ride (ownership enforced for riders/drivers)
  app.get('/rides/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; role: string; companyId?: string };
    const ride = await db.query.rides.findFirst({
      where: eq(schema.rides.id, id),
    });
    if (!ride) return reply.code(404).send({ error: 'Ride not found' });

    // Company scope check
    if (user.companyId && ride.companyId !== user.companyId) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    // Admins can see any ride within their company; riders/drivers can only see their own
    if (user.role !== 'admin') {
      const isOwner = ride.riderId === user.sub || ride.driverId === user.sub;
      if (!isOwner) return reply.code(403).send({ error: 'Forbidden' });
    }

    return ride;
  });

  // POST /rides/:id/accept — driver accepts a ride
  app.post('/rides/:id/accept', { preHandler: requireDriver }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };

    const [updated] = await db
      .update(schema.rides)
      .set({
        driverId: user.sub,
        status: 'accepted',
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.rides.id, id),
          eq(schema.rides.status, 'requested'),
          eq(schema.rides.companyId, user.companyId),
        ),
      )
      .returning();

    if (!updated) {
      return reply.code(409).send({ error: 'Ride is no longer available' });
    }

    // Mark driver unavailable while on a ride
    await db
      .update(schema.drivers)
      .set({ isAvailable: false, updatedAt: new Date() })
      .where(eq(schema.drivers.id, user.sub));

    return updated;
  });

  // POST /rides/:id/start — driver starts the ride (picked up rider)
  app.post('/rides/:id/start', { preHandler: requireDriver }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };

    const [updated] = await db
      .update(schema.rides)
      .set({
        status: 'in_progress',
        pickedUpAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.rides.id, id),
          eq(schema.rides.driverId, user.sub),
          eq(schema.rides.status, 'accepted'),
          eq(schema.rides.companyId, user.companyId),
        ),
      )
      .returning();

    if (!updated) {
      return reply.code(409).send({ error: 'Cannot start ride in current state' });
    }

    return updated;
  });

  // POST /rides/:id/complete — driver completes the ride
  app.post('/rides/:id/complete', { preHandler: requireDriver }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };

    const ride = await db.query.rides.findFirst({
      where: and(
        eq(schema.rides.id, id),
        eq(schema.rides.driverId, user.sub),
        eq(schema.rides.status, 'in_progress'),
        eq(schema.rides.companyId, user.companyId),
      ),
    });
    if (!ride) {
      return reply.code(409).send({ error: 'Cannot complete ride in current state' });
    }

    const [updated] = await db
      .update(schema.rides)
      .set({
        status: 'completed',
        droppedOffAt: new Date(),
        fareFinal: ride.fareEstimate,
        updatedAt: new Date(),
      })
      .where(eq(schema.rides.id, id))
      .returning();

    // Mark driver available again
    await db
      .update(schema.drivers)
      .set({ isAvailable: true, updatedAt: new Date() })
      .where(eq(schema.drivers.id, user.sub));

    // Create payment record
    await db.insert(schema.payments).values({
      companyId: user.companyId,
      rideId: id,
      riderId: ride.riderId,
      amount: ride.fareEstimate ?? '0.00',
      currency: 'USD',
      status: 'pending',
    });

    return updated;
  });

  // POST /rides/:id/cancel — rider or driver cancels a ride
  app.post('/rides/:id/cancel', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string; role: string; companyId?: string };
    const body = cancelRideSchema.parse(request.body ?? {});

    const conditions = [eq(schema.rides.id, id)];
    if (user.companyId) {
      conditions.push(eq(schema.rides.companyId, user.companyId));
    }

    const ride = await db.query.rides.findFirst({ where: and(...conditions) });
    if (!ride) return reply.code(404).send({ error: 'Ride not found' });

    // Only the rider or the assigned driver may cancel
    const isCaller =
      (user.role === 'rider' && ride.riderId === user.sub) ||
      (user.role === 'driver' && ride.driverId === user.sub);
    if (!isCaller) return reply.code(403).send({ error: 'Forbidden' });

    const cancellable: string[] = ['requested', 'accepted', 'arrived'];
    if (!cancellable.includes(ride.status)) {
      return reply.code(409).send({ error: 'Ride cannot be cancelled in current state' });
    }

    const [updated] = await db
      .update(schema.rides)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: body.reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.rides.id, id))
      .returning();

    // Free driver if one was assigned
    if (ride.driverId) {
      await db
        .update(schema.drivers)
        .set({ isAvailable: true, updatedAt: new Date() })
        .where(eq(schema.drivers.id, ride.driverId));
    }

    return updated;
  });
}
