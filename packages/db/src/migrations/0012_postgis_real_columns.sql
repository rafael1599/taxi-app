-- 0012_postgis_real_columns.sql
-- Add stored generated geography column to drivers for efficient spatial queries.
--
-- Previously (0001), we had an expression-based GiST index on
-- ST_MakePoint(current_lng, current_lat)::geography.  This migration adds a
-- proper GENERATED ALWAYS … STORED column (current_geog) and a partial GiST
-- index tailored for the hottest query in the system: find nearby available
-- idle drivers.
--
-- Existing GiST indexes (rides, zone_minimums, fixed_routes) already cover
-- all other PostGIS columns — nothing else to add.

-- ── 1. drivers.current_geog — stored generated column ──────────────────────
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS current_geog geography(Point,4326)
  GENERATED ALWAYS AS (
    CASE WHEN current_lng IS NOT NULL AND current_lat IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint(current_lng, current_lat),4326)::geography
         ELSE NULL END
  ) STORED;

-- ── 2. Partial GiST index for "find nearby available drivers" ──────────────
CREATE INDEX IF NOT EXISTS drivers_current_geog_gix
  ON drivers USING gist (current_geog)
  WHERE is_available = true AND is_active = true AND status = 'idle';
