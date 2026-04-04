import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@rockland-taxi/db';
import { eq, desc, count, and, inArray } from 'drizzle-orm';
import { requireAdmin } from '../middleware/auth.js';

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/dashboard — summary stats
  app.get('/admin/dashboard', { preHandler: requireAdmin }, async () => {
    const [totalDrivers] = await db.select({ count: count() }).from(schema.drivers);
    const [activeDrivers] = await db
      .select({ count: count() })
      .from(schema.drivers)
      .where(and(eq(schema.drivers.isAvailable, true), eq(schema.drivers.isActive, true)));
    const [totalRiders] = await db.select({ count: count() }).from(schema.riders);
    const [totalRides] = await db.select({ count: count() }).from(schema.rides);
    const [pendingRides] = await db
      .select({ count: count() })
      .from(schema.rides)
      .where(inArray(schema.rides.status, ['requested', 'accepted', 'in_progress']));

    return {
      totalDrivers: totalDrivers.count,
      activeDrivers: activeDrivers.count,
      totalRiders: totalRiders.count,
      totalRides: totalRides.count,
      pendingRides: pendingRides.count,
    };
  });

  // GET /admin/drivers — list all drivers
  app.get('/admin/drivers', { preHandler: requireAdmin }, async (request) => {
    const { status } = (request.query as { status?: string }) ?? {};
    let where;
    if (status === 'active') where = eq(schema.drivers.isActive, true);
    else if (status === 'suspended') where = eq(schema.drivers.isActive, false);

    return db.query.drivers.findMany({
      where,
      columns: { passwordHash: false },
      orderBy: [desc(schema.drivers.createdAt)],
    });
  });

  // PATCH /admin/drivers/:id — approve or suspend
  app.patch('/admin/drivers/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ isActive: z.boolean() }).parse(request.body);

    const [updated] = await db
      .update(schema.drivers)
      .set({ isActive: body.isActive, updatedAt: new Date() })
      .where(eq(schema.drivers.id, id))
      .returning({ id: schema.drivers.id, isActive: schema.drivers.isActive });

    if (!updated) return reply.code(404).send({ error: 'Driver not found' });
    return updated;
  });

  // GET /admin/rides — list all rides with optional status filter
  app.get('/admin/rides', { preHandler: requireAdmin }, async (request) => {
    const { status, limit = '50', offset = '0' } = request.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    const validStatuses = ['requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'];
    const where =
      status && validStatuses.includes(status)
        ? eq(
            schema.rides.status,
            status as 'requested' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled',
          )
        : undefined;

    return db.query.rides.findMany({
      where,
      orderBy: [desc(schema.rides.createdAt)],
      limit: Math.min(Number(limit), 200),
      offset: Number(offset),
    });
  });

  // POST /admin/rides/:id/dispatch — manually assign a driver to a ride
  app.post('/admin/rides/:id/dispatch', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ driverId: z.string().uuid() }).parse(request.body);

    const ride = await db.query.rides.findFirst({ where: eq(schema.rides.id, id) });
    if (!ride) return reply.code(404).send({ error: 'Ride not found' });
    if (!['requested', 'accepted'].includes(ride.status)) {
      return reply.code(409).send({ error: 'Ride cannot be dispatched in current state' });
    }

    const driver = await db.query.drivers.findFirst({
      where: and(eq(schema.drivers.id, body.driverId), eq(schema.drivers.isActive, true)),
    });
    if (!driver) return reply.code(404).send({ error: 'Driver not found or inactive' });

    const [updated] = await db
      .update(schema.rides)
      .set({ driverId: body.driverId, status: 'accepted', acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.rides.id, id))
      .returning();

    await db
      .update(schema.drivers)
      .set({ isAvailable: false, updatedAt: new Date() })
      .where(eq(schema.drivers.id, body.driverId));

    return updated;
  });

  // GET /admin/drivers/live — active driver locations for map
  app.get('/admin/drivers/live', { preHandler: requireAdmin }, async () => {
    return db.query.drivers.findMany({
      where: and(eq(schema.drivers.isActive, true), eq(schema.drivers.isAvailable, true)),
      columns: {
        id: true,
        fullName: true,
        phone: true,
        currentLat: true,
        currentLng: true,
        locationAt: true,
        isAvailable: true,
      },
    });
  });
}
