import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@rockland-taxi/db';
import { eq, and } from 'drizzle-orm';
import { requireDriver } from '../middleware/auth.js';
import { updateDriverLocation } from '../services/dispatch.js';

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const availabilitySchema = z.object({
  isAvailable: z.boolean(),
});

export async function driverRoutes(app: FastifyInstance) {
  // GET /drivers/me — get own profile
  app.get('/drivers/me', { preHandler: requireDriver }, async (request) => {
    const user = request.user as { sub: string; companyId: string };
    const driver = await db.query.drivers.findFirst({
      where: and(eq(schema.drivers.id, user.sub), eq(schema.drivers.companyId, user.companyId)),
      columns: { passwordHash: false },
    });
    return driver;
  });

  // PATCH /drivers/me/location — update GPS position
  app.patch('/drivers/me/location', { preHandler: requireDriver }, async (request) => {
    const user = request.user as { sub: string };
    const { lat, lng } = locationSchema.parse(request.body);
    await updateDriverLocation(user.sub, lat, lng);
    return { ok: true };
  });

  // PATCH /drivers/me/availability — toggle online/offline
  app.patch('/drivers/me/availability', { preHandler: requireDriver }, async (request) => {
    const user = request.user as { sub: string };
    const { isAvailable } = availabilitySchema.parse(request.body);

    await db
      .update(schema.drivers)
      .set({ isAvailable, updatedAt: new Date() })
      .where(eq(schema.drivers.id, user.sub));

    return { ok: true, isAvailable };
  });

  // GET /drivers/me/vehicles — list driver's vehicles
  app.get('/drivers/me/vehicles', { preHandler: requireDriver }, async (request) => {
    const user = request.user as { sub: string; companyId: string };
    return db.query.vehicles.findMany({
      where: and(
        eq(schema.vehicles.driverId, user.sub),
        eq(schema.vehicles.companyId, user.companyId),
      ),
    });
  });

  // POST /drivers/me/vehicles — register a vehicle
  app.post('/drivers/me/vehicles', { preHandler: requireDriver }, async (request, reply) => {
    const user = request.user as { sub: string; companyId: string };
    const vehicleSchema = z.object({
      make: z.string().min(1),
      model: z.string().min(1),
      year: z
        .number()
        .int()
        .min(2000)
        .max(new Date().getFullYear() + 1),
      color: z.string().min(1),
      plate: z.string().min(1),
    });
    const body = vehicleSchema.parse(request.body);

    const [vehicle] = await db
      .insert(schema.vehicles)
      .values({ ...body, driverId: user.sub, companyId: user.companyId })
      .returning();

    return reply.code(201).send(vehicle);
  });
}
