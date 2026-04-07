import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRider, requireDriver } from '../middleware/auth.js';
import {
  submitRating,
  getDriverRatings,
  getRiderRatings,
  hasRated,
  getRideRatings,
} from '../services/rating.js';

const submitRatingSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});

export async function ratingRoutes(app: FastifyInstance) {
  // POST /rides/:id/rate — rider rates the driver
  app.post('/rides/:id/rate', { preHandler: requireRider }, async (request, reply) => {
    const { id: rideId } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };
    const body = submitRatingSchema.parse(request.body);

    try {
      const rating = await submitRating({
        companyId: user.companyId,
        rideId,
        fromRiderId: user.sub,
        score: body.score,
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      });
      return reply.code(201).send(rating);
    } catch (err: any) {
      if (err.message === 'Rating already submitted for this ride') {
        return reply.code(409).send({ error: err.message });
      }
      if (err.message === 'Ride not found' || err.message === 'Not your ride') {
        return reply.code(404).send({ error: err.message });
      }
      if (err.message === 'Can only rate completed rides') {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // POST /rides/:id/rate-rider — driver rates the rider
  app.post('/rides/:id/rate-rider', { preHandler: requireDriver }, async (request, reply) => {
    const { id: rideId } = request.params as { id: string };
    const user = request.user as { sub: string; companyId: string };
    const body = submitRatingSchema.parse(request.body);

    try {
      const rating = await submitRating({
        companyId: user.companyId,
        rideId,
        fromDriverId: user.sub,
        score: body.score,
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      });
      return reply.code(201).send(rating);
    } catch (err: any) {
      if (err.message === 'Rating already submitted for this ride') {
        return reply.code(409).send({ error: err.message });
      }
      if (err.message === 'Ride not found' || err.message === 'Not your ride') {
        return reply.code(404).send({ error: err.message });
      }
      if (err.message === 'Can only rate completed rides') {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // GET /rides/:id/ratings — get ratings for a ride
  app.get('/rides/:id/ratings', { preHandler: requireAuth }, async (request) => {
    const { id: rideId } = request.params as { id: string };
    return getRideRatings(rideId);
  });

  // GET /rides/:id/rated — check if current user already rated
  app.get('/rides/:id/rated', { preHandler: requireAuth }, async (request) => {
    const { id: rideId } = request.params as { id: string };
    const user = request.user as { sub: string; role: string };
    const role = user.role === 'rider' ? 'rider' : 'driver';
    const rated = await hasRated(rideId, user.sub, role as 'rider' | 'driver');
    return { rated };
  });

  // GET /drivers/:id/ratings — get a driver's ratings (public)
  app.get('/drivers/:id/ratings', { preHandler: requireAuth }, async (request) => {
    const { id: driverId } = request.params as { id: string };
    const user = request.user as { companyId?: string };
    const companyId = user.companyId;
    if (!companyId) return [];
    return getDriverRatings(driverId, companyId);
  });

  // GET /riders/:id/ratings — get a rider's ratings (admin/driver)
  app.get('/riders/:id/ratings', { preHandler: requireAuth }, async (request) => {
    const { id: riderId } = request.params as { id: string };
    const user = request.user as { companyId?: string };
    const companyId = user.companyId;
    if (!companyId) return [];
    return getRiderRatings(riderId, companyId);
  });
}
