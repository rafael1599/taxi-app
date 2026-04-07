import { db, schema } from '@drivly/db';
import { eq, and, sql, desc } from 'drizzle-orm';

// ── Submit Rating ────────────────────────────────────────────────────────────

interface SubmitRatingParams {
  companyId: string;
  rideId: string;
  fromRiderId?: string | undefined;
  fromDriverId?: string | undefined;
  toDriverId?: string | undefined;
  toRiderId?: string | undefined;
  score: number;
  comment?: string | undefined;
}

export async function submitRating(params: SubmitRatingParams) {
  const { companyId, rideId, fromRiderId, fromDriverId, toDriverId, toRiderId, score, comment } =
    params;

  // Validate the ride exists and is completed
  const ride = await db.query.rides.findFirst({
    where: and(eq(schema.rides.id, rideId), eq(schema.rides.companyId, companyId)),
  });

  if (!ride) throw new Error('Ride not found');
  if (ride.status !== 'completed') throw new Error('Can only rate completed rides');

  // Validate caller was part of the ride and resolve target
  let resolvedToDriverId = toDriverId ?? null;
  let resolvedToRiderId = toRiderId ?? null;

  if (fromRiderId) {
    if (ride.riderId !== fromRiderId) throw new Error('Not your ride');
    resolvedToDriverId = ride.driverId; // rider rates the driver
  }
  if (fromDriverId) {
    if (ride.driverId !== fromDriverId) throw new Error('Not your ride');
    resolvedToRiderId = ride.riderId; // driver rates the rider
  }

  const [rating] = await db
    .insert(schema.ratings)
    .values({
      companyId,
      rideId,
      fromRiderId: fromRiderId ?? null,
      fromDriverId: fromDriverId ?? null,
      toDriverId: resolvedToDriverId,
      toRiderId: resolvedToRiderId,
      score,
      comment: comment ?? null,
    })
    .onConflictDoNothing() // unique constraint prevents duplicate ratings
    .returning();

  if (!rating) {
    throw new Error('Rating already submitted for this ride');
  }

  // Update the target's average rating
  if (toDriverId) {
    await updateDriverAvgRating(toDriverId);
  }
  if (toRiderId) {
    await updateRiderAvgRating(toRiderId);
  }

  return rating;
}

// ── Update Average Ratings ───────────────────────────────────────────────────

async function updateDriverAvgRating(driverId: string) {
  const result = await db
    .select({
      avg: sql<string>`ROUND(AVG(score), 2)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.ratings)
    .where(eq(schema.ratings.toDriverId, driverId));

  const row = result[0]!;
  await db
    .update(schema.drivers)
    .set({
      avgRating: row.avg,
      totalRatings: row.count,
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));
}

async function updateRiderAvgRating(riderId: string) {
  const result = await db
    .select({
      avg: sql<string>`ROUND(AVG(score), 2)`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(schema.ratings)
    .where(eq(schema.ratings.toRiderId, riderId));

  const row = result[0]!;
  await db
    .update(schema.riders)
    .set({
      avgRating: row.avg,
      totalRatings: row.count,
      updatedAt: new Date(),
    })
    .where(eq(schema.riders.id, riderId));
}

// ── Fetch Ratings ────────────────────────────────────────────────────────────

export async function getDriverRatings(
  driverId: string,
  companyId: string,
  opts: { limit?: number; offset?: number } = {},
) {
  const { limit = 20, offset = 0 } = opts;
  return db.query.ratings.findMany({
    where: and(eq(schema.ratings.toDriverId, driverId), eq(schema.ratings.companyId, companyId)),
    orderBy: [desc(schema.ratings.createdAt)],
    limit,
    offset,
  });
}

export async function getRiderRatings(
  riderId: string,
  companyId: string,
  opts: { limit?: number; offset?: number } = {},
) {
  const { limit = 20, offset = 0 } = opts;
  return db.query.ratings.findMany({
    where: and(eq(schema.ratings.toRiderId, riderId), eq(schema.ratings.companyId, companyId)),
    orderBy: [desc(schema.ratings.createdAt)],
    limit,
    offset,
  });
}

/** Check if a rating has been submitted for a ride by a specific user */
export async function hasRated(rideId: string, userId: string, role: 'rider' | 'driver') {
  const condition =
    role === 'rider'
      ? eq(schema.ratings.fromRiderId, userId)
      : eq(schema.ratings.fromDriverId, userId);

  const existing = await db.query.ratings.findFirst({
    where: and(eq(schema.ratings.rideId, rideId), condition),
  });

  return !!existing;
}

/** Get ride rating summary (for post-ride screen) */
export async function getRideRatings(rideId: string) {
  return db.query.ratings.findMany({
    where: eq(schema.ratings.rideId, rideId),
  });
}
