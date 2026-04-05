import { db, schema } from '@rockland-taxi/db';
import { eq, and, sql } from 'drizzle-orm';
import { DISPATCH } from '@rockland-taxi/shared/constants';
import { findNearbyDrivers } from './dispatch.js';
import { sseManager } from './sseManager.js';
import { notifyRiderViaWhatsApp } from './whatsapp.js';
import {
  scheduleOfferTimeout,
  scheduleSearchTimeout,
  cancelOfferTimeout,
  cancelSearchTimeout,
  setTripJobProcessor,
} from './tripQueue.js';
import { getRedis, REDIS_KEYS } from './redis.js';
import { logRideTransition, logDriverTransition, logOfferEvent } from './auditLog.js';
import type { Job } from 'bullmq';
import type { TripJobData } from './tripQueue.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StartSearchResult {
  success: boolean;
  rideId: string;
  offeredDriverId?: string;
  error?: string;
}

// ── Register BullMQ Job Processor ────────────────────────────────────────────

setTripJobProcessor(async (job: Job<TripJobData>) => {
  const { data } = job;

  if (data.type === 'offer_timeout') {
    await expireOffer(
      data.offerId,
      data.rideId,
      data.driverId,
      data.companyId,
      data.pickupLat,
      data.pickupLng,
    );
  } else if (data.type === 'search_timeout') {
    await expireSearch(data.rideId);
  }
});

// ── Redis State Helpers ──────────────────────────────────────────────────────

async function setActiveTrip(driverId: string, rideId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(REDIS_KEYS.activeTrip(driverId), rideId, 'EX', 3600 * 4); // 4h TTL
}

async function clearActiveTrip(driverId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(REDIS_KEYS.activeTrip(driverId));
}

async function setTripSearch(rideId: string, companyId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(
    REDIS_KEYS.tripSearch(rideId),
    JSON.stringify({ companyId, startedAt: Date.now() }),
    'EX',
    DISPATCH.SEARCH_TIMEOUT_SEC + 30, // small buffer beyond timeout
  );
}

async function clearTripSearch(rideId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(REDIS_KEYS.tripSearch(rideId));
}

// ── Start Driver Search ───────────────────────────────────────────────────────

export async function startDriverSearch(
  rideId: string,
  companyId: string,
): Promise<StartSearchResult> {
  const searchExpiresAt = new Date(Date.now() + DISPATCH.SEARCH_TIMEOUT_SEC * 1000);

  // Transition ride to searching_driver
  const [ride] = await db
    .update(schema.rides)
    .set({
      status: 'searching_driver',
      searchExpiresAt,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.rides.id, rideId), eq(schema.rides.companyId, companyId)))
    .returning();

  if (!ride) return { success: false, rideId, error: 'Ride not found' };

  logRideTransition(rideId, companyId, 'requested', 'searching_driver').catch(console.error);

  // Track search state in Redis
  await setTripSearch(rideId, companyId);

  // Schedule search expiry via BullMQ (durable — survives restart)
  await scheduleSearchTimeout(rideId, DISPATCH.SEARCH_TIMEOUT_SEC);

  // Find and offer to closest driver
  const offered = await offerToNextDriver(rideId, companyId, ride.pickupLat, ride.pickupLng);

  return {
    success: true,
    rideId,
    offeredDriverId: offered ?? undefined,
  };
}

// ── Offer to Next Driver ──────────────────────────────────────────────────────

async function offerToNextDriver(
  rideId: string,
  companyId: string,
  pickupLat: number,
  pickupLng: number,
): Promise<string | null> {
  // Get ride to check rejected drivers
  const ride = await db.query.rides.findFirst({
    where: and(eq(schema.rides.id, rideId), eq(schema.rides.companyId, companyId)),
  });

  if (!ride || !['searching_driver', 'driver_assigned'].includes(ride.status)) {
    return null;
  }

  // Parse rejected driver IDs from the PostgreSQL array stored as text
  const rejectedIds = parseRejectedDriverIds(ride.rejectedDriverIds);

  // Find nearby IDLE drivers for this company, excluding rejected ones
  const nearbyDrivers = await findNearbyDrivers(
    pickupLat,
    pickupLng,
    undefined, // default radius
    companyId,
  );

  // Filter out rejected drivers
  const eligibleDrivers = nearbyDrivers.filter((d) => !rejectedIds.includes(d.id));

  if (eligibleDrivers.length === 0) {
    // No drivers available — expire the search
    await expireSearch(rideId);
    return null;
  }

  const closestDriver = eligibleDrivers[0];
  const expiresAt = new Date(Date.now() + DISPATCH.OFFER_TIMEOUT_SEC * 1000);

  // Create the offer
  const [offer] = await db
    .insert(schema.tripOffers)
    .values({
      rideId,
      driverId: closestDriver.id,
      companyId,
      status: 'pending',
      expiresAt,
    })
    .returning();

  // Update driver status to incoming
  await db
    .update(schema.drivers)
    .set({ status: 'incoming', isAvailable: false, updatedAt: new Date() })
    .where(eq(schema.drivers.id, closestDriver.id));

  logDriverTransition(closestDriver.id, companyId, 'idle', 'incoming').catch(console.error);

  // Update ride to driver_assigned
  await db
    .update(schema.rides)
    .set({
      status: 'driver_assigned',
      driverId: closestDriver.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.rides.id, rideId));

  // Track offer in Redis
  const redis = getRedis();
  await redis.set(
    REDIS_KEYS.tripOffer(offer.id),
    JSON.stringify({
      rideId,
      driverId: closestDriver.id,
      companyId,
      expiresAt: expiresAt.toISOString(),
    }),
    'EX',
    DISPATCH.OFFER_TIMEOUT_SEC + 30,
  );

  // Track active trip for driver
  await setActiveTrip(closestDriver.id, rideId);

  logOfferEvent(offer.id, companyId, 'created', { rideId, driverId: closestDriver.id }).catch(
    console.error,
  );

  // Push SSE event to the driver
  sseManager.sendToDriver(closestDriver.id, {
    type: 'trip_offer',
    data: {
      offerId: offer.id,
      rideId,
      pickupLat,
      pickupLng,
      pickupAddress: ride.pickupAddress,
      dropoffLat: ride.dropoffLat,
      dropoffLng: ride.dropoffLng,
      dropoffAddress: ride.dropoffAddress,
      fareEstimate: ride.fareEstimate,
      distanceKm: ride.distanceKm,
      expiresAt: expiresAt.toISOString(),
    },
  });

  // Schedule offer timeout via BullMQ (durable — survives restart)
  await scheduleOfferTimeout(
    offer.id,
    rideId,
    closestDriver.id,
    companyId,
    pickupLat,
    pickupLng,
    DISPATCH.OFFER_TIMEOUT_SEC,
  );

  return closestDriver.id;
}

// ── Driver Accepts Offer ──────────────────────────────────────────────────────

export async function acceptOffer(
  offerId: string,
  driverId: string,
  companyId: string,
): Promise<{ success: boolean; rideId?: string; error?: string }> {
  // Update offer status
  const [offer] = await db
    .update(schema.tripOffers)
    .set({ status: 'accepted', respondedAt: new Date() })
    .where(
      and(
        eq(schema.tripOffers.id, offerId),
        eq(schema.tripOffers.driverId, driverId),
        eq(schema.tripOffers.status, 'pending'),
      ),
    )
    .returning();

  if (!offer) {
    return { success: false, error: 'Offer not found or already responded' };
  }

  // Cancel BullMQ timers
  await cancelOfferTimeout(offerId);
  await cancelSearchTimeout(offer.rideId);

  // Clean up Redis state
  const redis = getRedis();
  await redis.del(REDIS_KEYS.tripOffer(offerId));
  await clearTripSearch(offer.rideId);

  logOfferEvent(offerId, companyId, 'accepted', { driverId }).catch(console.error);

  // Update ride
  const [ride] = await db
    .update(schema.rides)
    .set({
      status: 'accepted',
      driverId,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.rides.id, offer.rideId))
    .returning();

  logRideTransition(
    offer.rideId,
    companyId,
    'driver_assigned',
    'accepted',
    'driver',
    driverId,
  ).catch(console.error);

  // Update driver status
  await db
    .update(schema.drivers)
    .set({ status: 'accepted', isAvailable: false, updatedAt: new Date() })
    .where(eq(schema.drivers.id, driverId));

  logDriverTransition(driverId, companyId, 'incoming', 'accepted', 'driver', driverId).catch(
    console.error,
  );

  // Track active trip
  await setActiveTrip(driverId, offer.rideId);

  // Notify driver of confirmed assignment
  sseManager.sendToDriver(driverId, {
    type: 'trip_confirmed',
    data: { rideId: offer.rideId, status: 'accepted' },
  });

  // Notify rider via WhatsApp
  notifyRiderViaWhatsApp(offer.rideId, 'driver_assigned').catch(console.error);

  return { success: true, rideId: offer.rideId };
}

// ── Driver Rejects Offer ──────────────────────────────────────────────────────

export async function rejectOffer(
  offerId: string,
  driverId: string,
  companyId: string,
): Promise<{ success: boolean; error?: string }> {
  const [offer] = await db
    .update(schema.tripOffers)
    .set({ status: 'rejected', respondedAt: new Date() })
    .where(
      and(
        eq(schema.tripOffers.id, offerId),
        eq(schema.tripOffers.driverId, driverId),
        eq(schema.tripOffers.status, 'pending'),
      ),
    )
    .returning();

  if (!offer) {
    return { success: false, error: 'Offer not found or already responded' };
  }

  // Cancel BullMQ offer timer
  await cancelOfferTimeout(offerId);

  // Clean up Redis
  const redis = getRedis();
  await redis.del(REDIS_KEYS.tripOffer(offerId));
  await clearActiveTrip(driverId);

  logOfferEvent(offerId, companyId, 'rejected', { driverId }).catch(console.error);

  // Reset driver to idle
  await db
    .update(schema.drivers)
    .set({ status: 'idle', isAvailable: true, updatedAt: new Date() })
    .where(eq(schema.drivers.id, driverId));

  logDriverTransition(driverId, companyId, 'incoming', 'idle', 'driver', driverId).catch(
    console.error,
  );

  // Add driver to rejected list
  await db.execute(sql`
    UPDATE rides
    SET rejected_driver_ids = array_append(COALESCE(rejected_driver_ids, '{}'), ${driverId}::uuid),
        updated_at = now()
    WHERE id = ${offer.rideId}
  `);

  // Get ride to continue offering
  const ride = await db.query.rides.findFirst({
    where: eq(schema.rides.id, offer.rideId),
  });

  if (ride && ride.status !== 'cancelled') {
    // Update ride back to searching
    await db
      .update(schema.rides)
      .set({ status: 'searching_driver', driverId: null, updatedAt: new Date() })
      .where(eq(schema.rides.id, offer.rideId));

    // Offer to next driver
    await offerToNextDriver(offer.rideId, companyId, ride.pickupLat, ride.pickupLng);
  }

  return { success: true };
}

// ── Expire Offer (timeout) ────────────────────────────────────────────────────

async function expireOffer(
  offerId: string,
  rideId: string,
  driverId: string,
  companyId: string,
  pickupLat: number,
  pickupLng: number,
): Promise<void> {
  // Mark offer as expired
  await db
    .update(schema.tripOffers)
    .set({ status: 'expired', respondedAt: new Date() })
    .where(and(eq(schema.tripOffers.id, offerId), eq(schema.tripOffers.status, 'pending')));

  // Clean up Redis
  const redis = getRedis();
  await redis.del(REDIS_KEYS.tripOffer(offerId));
  await clearActiveTrip(driverId);

  logOfferEvent(offerId, companyId, 'expired', { driverId, rideId }).catch(console.error);

  // Reset driver to idle
  await db
    .update(schema.drivers)
    .set({ status: 'idle', isAvailable: true, updatedAt: new Date() })
    .where(eq(schema.drivers.id, driverId));

  logDriverTransition(driverId, companyId, 'incoming', 'idle').catch(console.error);

  // Notify driver that offer expired
  sseManager.sendToDriver(driverId, {
    type: 'offer_expired',
    data: { offerId, rideId },
  });

  // Add to rejected list
  await db.execute(sql`
    UPDATE rides
    SET rejected_driver_ids = array_append(COALESCE(rejected_driver_ids, '{}'), ${driverId}::uuid),
        updated_at = now()
    WHERE id = ${rideId}
  `);

  // Try next driver
  const ride = await db.query.rides.findFirst({
    where: eq(schema.rides.id, rideId),
  });

  if (ride && !['completed', 'cancelled'].includes(ride.status)) {
    await db
      .update(schema.rides)
      .set({ status: 'searching_driver', driverId: null, updatedAt: new Date() })
      .where(eq(schema.rides.id, rideId));

    await offerToNextDriver(rideId, companyId, pickupLat, pickupLng);
  }
}

// ── Expire Search (2-min timeout) ─────────────────────────────────────────────

async function expireSearch(rideId: string): Promise<void> {
  await clearTripSearch(rideId);

  // Cancel any pending offer jobs for this ride
  // (The offer will be stale once ride is cancelled)

  // Cancel any pending offers in DB
  await db
    .update(schema.tripOffers)
    .set({ status: 'expired', respondedAt: new Date() })
    .where(and(eq(schema.tripOffers.rideId, rideId), eq(schema.tripOffers.status, 'pending')));

  // Cancel the ride
  const [ride] = await db
    .update(schema.rides)
    .set({
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: 'No driver available',
      updatedAt: new Date(),
    })
    .where(and(eq(schema.rides.id, rideId), sql`status IN ('searching_driver', 'driver_assigned')`))
    .returning();

  if (ride) {
    logRideTransition(rideId, ride.companyId, ride.status, 'cancelled', 'system', undefined, {
      reason: 'No driver available',
    }).catch(console.error);
  }

  if (ride?.driverId) {
    // Reset the last offered driver
    await db
      .update(schema.drivers)
      .set({ status: 'idle', isAvailable: true, updatedAt: new Date() })
      .where(eq(schema.drivers.id, ride.driverId));

    await clearActiveTrip(ride.driverId);
    logDriverTransition(ride.driverId, ride.companyId, 'incoming', 'idle').catch(console.error);
  }

  // Notify rider via WhatsApp that no driver was found
  if (ride) {
    notifyRiderViaWhatsApp(rideId, 'cancelled').catch(console.error);
  }
}

// ── Trip Status Transitions ───────────────────────────────────────────────────

export async function updateTripStatus(
  rideId: string,
  driverId: string,
  companyId: string,
  newStatus: 'en_route' | 'arrived' | 'picked_up' | 'completed',
): Promise<{ success: boolean; ride?: typeof schema.rides.$inferSelect; error?: string }> {
  const validTransitions: Record<string, string[]> = {
    accepted: ['en_route'],
    en_route: ['arrived'],
    arrived: ['picked_up'],
    picked_up: ['completed'],
  };

  const ride = await db.query.rides.findFirst({
    where: and(
      eq(schema.rides.id, rideId),
      eq(schema.rides.driverId, driverId),
      eq(schema.rides.companyId, companyId),
    ),
  });

  if (!ride) return { success: false, error: 'Ride not found' };

  const allowed = validTransitions[ride.status];
  if (!allowed || !allowed.includes(newStatus)) {
    return { success: false, error: `Cannot transition from ${ride.status} to ${newStatus}` };
  }

  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  // Set timestamps for specific transitions
  if (newStatus === 'picked_up') updates.pickedUpAt = new Date();
  if (newStatus === 'completed') updates.droppedOffAt = new Date();

  const [updated] = await db
    .update(schema.rides)
    .set(updates)
    .where(eq(schema.rides.id, rideId))
    .returning();

  logRideTransition(rideId, companyId, ride.status, newStatus, 'driver', driverId).catch(
    console.error,
  );

  // Update driver status to match
  const driverStatusMap: Record<string, string> = {
    en_route: 'en_route',
    arrived: 'arrived',
    picked_up: 'picked_up',
    completed: 'completed',
  };

  await db
    .update(schema.drivers)
    .set({
      status: driverStatusMap[newStatus] as typeof schema.drivers.$inferSelect.status,
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));

  logDriverTransition(
    driverId,
    companyId,
    ride.status,
    driverStatusMap[newStatus],
    'driver',
    driverId,
  ).catch(console.error);

  // On completion, mark driver available again
  if (newStatus === 'completed') {
    await db
      .update(schema.drivers)
      .set({ status: 'idle', isAvailable: true, updatedAt: new Date() })
      .where(eq(schema.drivers.id, driverId));

    await clearActiveTrip(driverId);
    logDriverTransition(driverId, companyId, 'completed', 'idle').catch(console.error);

    // Create payment record
    await db.insert(schema.payments).values({
      companyId,
      rideId,
      riderId: ride.riderId,
      amount: ride.fareEstimate ?? '0.00',
      currency: 'USD',
      status: 'pending',
    });
  }

  // Notify driver
  sseManager.sendToDriver(driverId, {
    type: 'trip_status_changed',
    data: { rideId, status: newStatus },
  });

  // Notify rider via WhatsApp for key status changes
  if (['arrived', 'picked_up', 'completed'].includes(newStatus)) {
    const waEvent = newStatus as 'arrived' | 'picked_up' | 'completed';
    notifyRiderViaWhatsApp(rideId, waEvent).catch(console.error);
  }

  return { success: true, ride: updated };
}

// ── Auto-Arrival Detection ────────────────────────────────────────────────────

export async function checkAutoArrival(driverId: string, lat: number, lng: number): Promise<void> {
  // Find active ride for this driver in en_route status
  const ride = await db.query.rides.findFirst({
    where: and(eq(schema.rides.driverId, driverId), eq(schema.rides.status, 'en_route')),
  });

  if (!ride) return;

  // Calculate haversine distance to pickup
  const distanceMeters = haversineDistance(lat, lng, ride.pickupLat, ride.pickupLng);

  if (distanceMeters <= DISPATCH.AUTO_ARRIVAL_DISTANCE_METERS) {
    await updateTripStatus(ride.id, driverId, ride.companyId, 'arrived');
  }
}

// ── Driver Go Online/Offline ──────────────────────────────────────────────────

export async function setDriverOnline(driverId: string, companyId: string): Promise<void> {
  await db
    .update(schema.drivers)
    .set({ status: 'idle', isAvailable: true, updatedAt: new Date() })
    .where(and(eq(schema.drivers.id, driverId), eq(schema.drivers.companyId, companyId)));

  // Track in Redis for fast lookups
  const redis = getRedis();
  await redis.sadd(REDIS_KEYS.driverOnlineSet(companyId), driverId);
  await redis.set(REDIS_KEYS.driverOnline(companyId, driverId), '1', 'EX', 300); // 5min TTL, refreshed by location pings

  logDriverTransition(driverId, companyId, 'offline', 'idle', 'driver', driverId).catch(
    console.error,
  );
}

export async function setDriverOffline(driverId: string, companyId: string): Promise<void> {
  await db
    .update(schema.drivers)
    .set({ status: 'offline', isAvailable: false, updatedAt: new Date() })
    .where(and(eq(schema.drivers.id, driverId), eq(schema.drivers.companyId, companyId)));

  // Remove from Redis
  const redis = getRedis();
  await redis.srem(REDIS_KEYS.driverOnlineSet(companyId), driverId);
  await redis.del(REDIS_KEYS.driverOnline(companyId, driverId));

  logDriverTransition(driverId, companyId, 'idle', 'offline', 'driver', driverId).catch(
    console.error,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseRejectedDriverIds(raw: string | null): string[] {
  if (!raw) return [];
  // PostgreSQL UUID[] comes as {uuid1,uuid2,...} or text representation
  const cleaned = raw.replace(/[{}]/g, '');
  if (!cleaned) return [];
  return cleaned
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
