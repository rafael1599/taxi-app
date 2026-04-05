import { db, schema } from '@rockland-taxi/db';
import { eq, and, sql } from 'drizzle-orm';

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

export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
): Promise<void> {
  await db
    .update(schema.drivers)
    .set({
      currentLat: lat,
      currentLng: lng,
      locationAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));
}
