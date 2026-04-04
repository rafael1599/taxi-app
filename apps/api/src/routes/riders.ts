import { FastifyInstance } from 'fastify';
import { db, schema } from '@rockland-taxi/db';
import { eq } from 'drizzle-orm';
import { requireRider } from '../middleware/auth.js';
import { findNearbyDrivers } from '../services/dispatch.js';
import { z } from 'zod';

export async function riderRoutes(app: FastifyInstance) {
  // GET /riders/me — get own profile
  app.get('/riders/me', { preHandler: requireRider }, async (request) => {
    const user = request.user as { sub: string };
    return db.query.riders.findFirst({
      where: eq(schema.riders.id, user.sub),
    });
  });

  // GET /riders/me/nearby-drivers — nearby available drivers
  app.get('/riders/me/nearby-drivers', { preHandler: requireRider }, async (request) => {
    const { lat, lng, radius } = request.query as {
      lat?: string;
      lng?: string;
      radius?: string;
    };
    if (!lat || !lng) {
      return { error: 'lat and lng query params required' };
    }
    return findNearbyDrivers(
      parseFloat(lat),
      parseFloat(lng),
      radius ? parseFloat(radius) : undefined,
    );
  });
}
