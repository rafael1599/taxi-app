import { db, schema } from '@rockland-taxi/db';
import { eq, and, sql } from 'drizzle-orm';
import { haversineDistanceKm } from '@rockland-taxi/shared';
import { getRedis } from './redis';
import { createHash } from 'crypto';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PriceQuoteInput {
  companyId: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}

export interface PriceQuoteResult {
  price: number;
  distance: { km: number; miles: number };
  durationMin: number;
  etaRange: { minMin: number; maxMin: number; display: string };
  method: 'fixed_route' | 'zone_minimum' | 'base_rate';
  distanceSource: string;
  currency: string;
  fixedRouteId?: string;
  zoneId?: string;
}

const ETA_VARIANCE = 0.3; // ±30% for ETA range

function buildEtaRange(durationMin: number): PriceQuoteResult['etaRange'] {
  const minMin = Math.max(1, Math.floor(durationMin * (1 - ETA_VARIANCE)));
  const maxMin = Math.ceil(durationMin * (1 + ETA_VARIANCE));
  return { minMin, maxMin, display: `${minMin}-${maxMin} min` };
}

// ── Distance calculation ────────────────────────────────────────────────────

const KM_TO_MILES = 0.621371;
const AVG_SPEED_KMH = 30; // rough urban average
const ROUTE_CACHE_TTL = 86400; // 24 hours
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? '';
const OSRM_BASE_URL = process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org';

function routeCacheKey(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const hash = createHash('md5')
    .update(`${lat1.toFixed(5)},${lng1.toFixed(5)}:${lat2.toFixed(5)},${lng2.toFixed(5)}`)
    .digest('hex');
  return `route:${hash}`;
}

interface DistanceResult {
  km: number;
  miles: number;
  durationMin: number;
  source: string;
}

async function getRouteFromCache(key: string): Promise<DistanceResult | null> {
  try {
    const cached = await getRedis().get(key);
    if (cached) return JSON.parse(cached);
  } catch (_) {
    /* cache miss is non-fatal */
  }
  return null;
}

async function cacheRoute(key: string, result: DistanceResult): Promise<void> {
  try {
    await getRedis().setex(key, ROUTE_CACHE_TTL, JSON.stringify(result));
  } catch (_) {
    /* cache write failure is non-fatal */
  }
}

async function googleRoutesDistance(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<DistanceResult | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: pickupLat, longitude: pickupLng } } },
        destination: { location: { latLng: { latitude: dropoffLat, longitude: dropoffLng } } },
        travelMode: 'DRIVE',
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.distanceMeters) return null;

    const km = route.distanceMeters / 1000;
    const durationSec = parseInt(route.duration?.replace('s', '') ?? '0', 10);
    return {
      km,
      miles: km * KM_TO_MILES,
      durationMin: Math.ceil(durationSec / 60),
      source: 'google',
    };
  } catch {
    return null;
  }
}

async function osrmDistance(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<DistanceResult | null> {
  try {
    const coords = `${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`;
    const res = await fetch(`${OSRM_BASE_URL}/route/v1/driving/${coords}?overview=false`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.routes?.[0];
    if (!route?.distance) return null;

    const km = route.distance / 1000;
    return {
      km,
      miles: km * KM_TO_MILES,
      durationMin: Math.ceil(route.duration / 60),
      source: 'osrm',
    };
  } catch {
    return null;
  }
}

async function calculateDistance(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<DistanceResult> {
  const cacheKey = routeCacheKey(pickupLat, pickupLng, dropoffLat, dropoffLng);

  // Check cache first
  const cached = await getRouteFromCache(cacheKey);
  if (cached) return { ...cached, source: `${cached.source}_cached` };

  // Try Google Routes API
  const google = await googleRoutesDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
  if (google) {
    await cacheRoute(cacheKey, google);
    return google;
  }

  // Try OSRM fallback
  const osrm = await osrmDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
  if (osrm) {
    await cacheRoute(cacheKey, osrm);
    return osrm;
  }

  // Haversine fallback (always available)
  const km = haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const miles = km * KM_TO_MILES;
  const durationMin = Math.ceil((km / AVG_SPEED_KMH) * 60);
  return { km, miles, durationMin, source: 'haversine' };
}

// ── Fixed route matching ────────────────────────────────────────────────────

async function findFixedRouteMatch(
  companyId: string,
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<{ id: string; fixedPrice: number } | null> {
  const result = await db.execute(sql`
    SELECT id, fixed_price
    FROM fixed_routes
    WHERE company_id = ${companyId}
      AND ST_DWithin(
        origin_geog,
        ST_SetSRID(ST_MakePoint(${pickupLng}, ${pickupLat}), 4326)::geography,
        radius_meters
      )
      AND ST_DWithin(
        dest_geog,
        ST_SetSRID(ST_MakePoint(${dropoffLng}, ${dropoffLat}), 4326)::geography,
        radius_meters
      )
    ORDER BY fixed_price ASC
    LIMIT 1
  `);

  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { id: string; fixed_price: string };
  return { id: row.id, fixedPrice: parseFloat(row.fixed_price) };
}

// ── Zone minimum matching ───────────────────────────────────────────────────

async function findZoneMinimum(
  companyId: string,
  pickupLat: number,
  pickupLng: number,
): Promise<{ id: string; zoneName: string; minimumFare: number } | null> {
  const result = await db.execute(sql`
    SELECT id, zone_name, minimum_fare
    FROM zone_minimums
    WHERE company_id = ${companyId}
      AND boundary_polygon IS NOT NULL
      AND ST_Within(
        ST_SetSRID(ST_MakePoint(${pickupLng}, ${pickupLat}), 4326)::geometry,
        boundary_polygon::geometry
      )
    ORDER BY minimum_fare DESC
    LIMIT 1
  `);

  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { id: string; zone_name: string; minimum_fare: string };
  return { id: row.id, zoneName: row.zone_name, minimumFare: parseFloat(row.minimum_fare) };
}

// ── Pricing rules ───────────────────────────────────────────────────────────

async function getCompanyPricingRules(companyId: string) {
  const rules = await db.query.pricingRules.findFirst({
    where: eq(schema.pricingRules.companyId, companyId),
  });
  // Return defaults if no rules configured
  return {
    baseRatePerMile: rules ? parseFloat(rules.baseRatePerMile) : 3.0,
    minimumFare: rules ? parseFloat(rules.minimumFare) : 7.0,
    perMinuteRate: rules ? parseFloat(rules.perMinuteRate) : 0.2,
    currency: rules?.currency ?? 'USD',
  };
}

// ── Main quote function ─────────────────────────────────────────────────────

export async function calculatePriceQuote(input: PriceQuoteInput): Promise<PriceQuoteResult> {
  const { companyId, pickupLat, pickupLng, dropoffLat, dropoffLng } = input;

  // 1. Calculate distance
  const dist = await calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);

  // 2. Get company pricing rules
  const rules = await getCompanyPricingRules(companyId);

  // 3. Check fixed route match first (highest priority)
  const fixedMatch = await findFixedRouteMatch(
    companyId,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  );
  if (fixedMatch) {
    return {
      price: fixedMatch.fixedPrice,
      distance: { km: dist.km, miles: dist.miles },
      durationMin: dist.durationMin,
      etaRange: buildEtaRange(dist.durationMin),
      method: 'fixed_route',
      distanceSource: dist.source,
      currency: rules.currency,
      fixedRouteId: fixedMatch.id,
    };
  }

  // 4. Check zone minimum
  const zoneMatch = await findZoneMinimum(companyId, pickupLat, pickupLng);

  // 5. Calculate base rate price
  const basePrice = rules.baseRatePerMile * dist.miles + rules.perMinuteRate * dist.durationMin;

  // 6. Apply zone minimum if applicable
  let finalPrice = Math.max(basePrice, rules.minimumFare);
  let method: PriceQuoteResult['method'] = 'base_rate';
  let zoneId: string | undefined;

  if (zoneMatch && zoneMatch.minimumFare > finalPrice) {
    finalPrice = zoneMatch.minimumFare;
    method = 'zone_minimum';
    zoneId = zoneMatch.id;
  }

  // Round to 2 decimal places
  finalPrice = Math.round(finalPrice * 100) / 100;

  return {
    price: finalPrice,
    distance: { km: Math.round(dist.km * 100) / 100, miles: Math.round(dist.miles * 100) / 100 },
    durationMin: dist.durationMin,
    etaRange: buildEtaRange(dist.durationMin),
    method,
    distanceSource: dist.source,
    currency: rules.currency,
    zoneId,
  };
}

// ── CRUD for pricing_rules ──────────────────────────────────────────────────

export async function getPricingRules(companyId: string) {
  return db.query.pricingRules.findFirst({
    where: eq(schema.pricingRules.companyId, companyId),
  });
}

export async function upsertPricingRules(
  companyId: string,
  data: {
    baseRatePerMile?: string;
    minimumFare?: string;
    perMinuteRate?: string;
    currency?: string;
  },
) {
  const existing = await getPricingRules(companyId);
  if (existing) {
    const [updated] = await db
      .update(schema.pricingRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.pricingRules.companyId, companyId))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(schema.pricingRules)
    .values({ companyId, ...data })
    .returning();
  return created;
}

// ── CRUD for zone_minimums ──────────────────────────────────────────────────

export async function listZoneMinimums(companyId: string) {
  return db.query.zoneMinimums.findMany({
    where: eq(schema.zoneMinimums.companyId, companyId),
    orderBy: (z, { asc }) => [asc(z.zoneName)],
  });
}

export async function getZoneMinimum(id: string, companyId: string) {
  return db.query.zoneMinimums.findFirst({
    where: and(eq(schema.zoneMinimums.id, id), eq(schema.zoneMinimums.companyId, companyId)),
  });
}

export async function createZoneMinimum(data: {
  companyId: string;
  zoneName: string;
  minimumFare: string;
  boundaryPolygon?: string;
}) {
  const [created] = await db.insert(schema.zoneMinimums).values(data).returning();
  return created;
}

export async function updateZoneMinimum(
  id: string,
  companyId: string,
  data: Partial<{ zoneName: string; minimumFare: string; boundaryPolygon: string }>,
) {
  const [updated] = await db
    .update(schema.zoneMinimums)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.zoneMinimums.id, id), eq(schema.zoneMinimums.companyId, companyId)))
    .returning();
  return updated;
}

export async function deleteZoneMinimum(id: string, companyId: string) {
  const [deleted] = await db
    .delete(schema.zoneMinimums)
    .where(and(eq(schema.zoneMinimums.id, id), eq(schema.zoneMinimums.companyId, companyId)))
    .returning({ id: schema.zoneMinimums.id });
  return deleted;
}

// ── CRUD for fixed_routes ───────────────────────────────────────────────────

export async function listFixedRoutes(companyId: string) {
  return db.query.fixedRoutes.findMany({
    where: eq(schema.fixedRoutes.companyId, companyId),
    orderBy: (r, { asc }) => [asc(r.name)],
  });
}

export async function getFixedRoute(id: string, companyId: string) {
  return db.query.fixedRoutes.findFirst({
    where: and(eq(schema.fixedRoutes.id, id), eq(schema.fixedRoutes.companyId, companyId)),
  });
}

export async function createFixedRoute(data: {
  companyId: string;
  name?: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  radiusMeters?: number;
  fixedPrice: string;
}) {
  const [created] = await db.insert(schema.fixedRoutes).values(data).returning();
  return created;
}

export async function updateFixedRoute(
  id: string,
  companyId: string,
  data: Partial<{
    name: string;
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    radiusMeters: number;
    fixedPrice: string;
  }>,
) {
  const [updated] = await db
    .update(schema.fixedRoutes)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.fixedRoutes.id, id), eq(schema.fixedRoutes.companyId, companyId)))
    .returning();
  return updated;
}

export async function deleteFixedRoute(id: string, companyId: string) {
  const [deleted] = await db
    .delete(schema.fixedRoutes)
    .where(and(eq(schema.fixedRoutes.id, id), eq(schema.fixedRoutes.companyId, companyId)))
    .returning({ id: schema.fixedRoutes.id });
  return deleted;
}
