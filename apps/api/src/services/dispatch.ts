import { db, schema } from '@drivly/db';
import { eq, and, sql, lt } from 'drizzle-orm';

export interface NearbyDriver {
  id: string;
  fullName: string;
  currentLat: number;
  currentLng: number;
  distanceKm: number;
}

/**
 * Find available drivers within radiusKm of a pickup point using PostGIS ST_DWithin.
 * Scoped to a specific company.
 */
export async function findNearbyDrivers(
  pickupLat: number,
  pickupLng: number,
  radiusKm = 10,
  companyId?: string,
): Promise<NearbyDriver[]> {
  const companyFilter = companyId ? sql`AND d.company_id = ${companyId}` : sql``;

  const rows = await db.execute(sql`
    SELECT
      d.id,
      d.full_name,
      d.current_lat,
      d.current_lng,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(d.current_lng, d.current_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${pickupLng}, ${pickupLat}), 4326)::geography
      ) / 1000.0 AS distance_km
    FROM drivers d
    WHERE
      d.is_available = TRUE
      AND d.is_active = TRUE
      AND d.current_lat IS NOT NULL
      AND d.current_lng IS NOT NULL
      AND d.location_at > NOW() - INTERVAL '60 seconds'
      ${companyFilter}
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(d.current_lng, d.current_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${pickupLng}, ${pickupLat}), 4326)::geography,
        ${radiusKm * 1000}
      )
    ORDER BY distance_km ASC
    LIMIT 10
  `);

  return (
    rows.rows as Array<{
      id: string;
      full_name: string;
      current_lat: number;
      current_lng: number;
      distance_km: number;
    }>
  ).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    currentLat: r.current_lat,
    currentLng: r.current_lng,
    distanceKm: r.distance_km,
  }));
}

const MIN_DISTANCE_METERS = 10; // Ignore updates closer than this (GPS noise)

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  accuracy?: number,
): Promise<{ updated: boolean }> {
  // Client-side accuracy filter: discard low-quality readings
  if (accuracy !== undefined && accuracy > 100) {
    return { updated: false };
  }

  // Server-side jitter filter: skip if driver barely moved
  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, driverId),
    columns: { currentLat: true, currentLng: true },
  });

  if (driver?.currentLat != null && driver?.currentLng != null) {
    const dist = haversineMeters(driver.currentLat, driver.currentLng, lat, lng);
    if (dist < MIN_DISTANCE_METERS) {
      // Still update locationAt to keep the driver "alive" for stale detection
      await db
        .update(schema.drivers)
        .set({ locationAt: new Date() })
        .where(eq(schema.drivers.id, driverId));
      return { updated: false };
    }
  }

  await db
    .update(schema.drivers)
    .set({
      currentLat: lat,
      currentLng: lng,
      locationAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));

  return { updated: true };
}

// ── Stale Location Detection ────────────────────────────────────────────────

const STALE_THRESHOLD_SEC = 180; // 3 minutes no GPS update → set offline

/**
 * Find online drivers whose location hasn't been updated in STALE_THRESHOLD_SEC
 * and set them offline. Run this periodically via BullMQ repeating job.
 */
export async function markStaleDriversOffline(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_SEC * 1000);

  const staleDrivers = await db
    .update(schema.drivers)
    .set({
      status: 'offline',
      isAvailable: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.drivers.isAvailable, true),
        sql`${schema.drivers.locationAt} IS NOT NULL`,
        lt(schema.drivers.locationAt, cutoff),
      ),
    )
    .returning({ id: schema.drivers.id });

  if (staleDrivers.length > 0) {
    console.log(
      `[Dispatch] Marked ${staleDrivers.length} stale driver(s) offline:`,
      staleDrivers.map((d) => d.id),
    );
  }

  return staleDrivers.length;
}
