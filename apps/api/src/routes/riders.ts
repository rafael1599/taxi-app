import { FastifyInstance } from 'fastify';
import { db, schema } from '@rockland-taxi/db';
import { eq, and } from 'drizzle-orm';
import { requireRider } from '../middleware/auth.js';
import { findNearbyDrivers } from '../services/dispatch.js';
import { saveRiderPushToken } from '../services/pushNotifications.js';
import { z } from 'zod';

export async function riderRoutes(app: FastifyInstance) {
  // GET /riders/me — get own profile
  app.get('/riders/me', { preHandler: requireRider }, async (request) => {
    const user = request.user as { sub: string; companyId: string };
    return db.query.riders.findFirst({
      where: and(eq(schema.riders.id, user.sub), eq(schema.riders.companyId, user.companyId)),
    });
  });

  // PUT /riders/me/push-token — register push notification token
  app.put('/riders/me/push-token', { preHandler: requireRider }, async (request) => {
    const user = request.user as { sub: string };
    const { pushToken } = z.object({ pushToken: z.string().min(1) }).parse(request.body);
    await saveRiderPushToken(user.sub, pushToken);
    return { ok: true };
  });

  // GET /riders/me/nearby-drivers — nearby available drivers (same company only)
  app.get('/riders/me/nearby-drivers', { preHandler: requireRider }, async (request) => {
    const user = request.user as { sub: string; companyId: string };
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
      user.companyId,
    );
  });
}
