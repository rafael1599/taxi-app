-- 0003_add_pricing_tables.sql
-- Pricing engine tables: pricing_rules, zone_minimums, fixed_routes

-- ── pricing_rules (one per company) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  base_rate_per_mile  NUMERIC(8,2) NOT NULL DEFAULT 3.00,
  minimum_fare        NUMERIC(8,2) NOT NULL DEFAULT 7.00,
  per_minute_rate     NUMERIC(8,2) NOT NULL DEFAULT 0.20,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(company_id)
);

CREATE INDEX IF NOT EXISTS pricing_rules_company_id_idx ON pricing_rules(company_id);

-- ── zone_minimums (per-zone minimum fares per company) ───────────────────────
CREATE TABLE IF NOT EXISTS zone_minimums (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  zone_name     TEXT NOT NULL,
  minimum_fare  NUMERIC(8,2) NOT NULL,
  boundary_polygon GEOGRAPHY(POLYGON, 4326),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zone_minimums_company_id_idx ON zone_minimums(company_id);
CREATE INDEX IF NOT EXISTS zone_minimums_boundary_idx ON zone_minimums USING GIST(boundary_polygon);

-- ── fixed_routes (admin-defined origin→destination price overrides) ──────────
CREATE TABLE IF NOT EXISTS fixed_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT,
  origin_lat      DOUBLE PRECISION NOT NULL,
  origin_lng      DOUBLE PRECISION NOT NULL,
  dest_lat        DOUBLE PRECISION NOT NULL,
  dest_lng        DOUBLE PRECISION NOT NULL,
  origin_geog     GEOGRAPHY(POINT, 4326),
  dest_geog       GEOGRAPHY(POINT, 4326),
  radius_meters   INTEGER NOT NULL DEFAULT 500,
  fixed_price     NUMERIC(8,2) NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fixed_routes_company_id_idx ON fixed_routes(company_id);
CREATE INDEX IF NOT EXISTS fixed_routes_origin_geog_idx ON fixed_routes USING GIST(origin_geog);
CREATE INDEX IF NOT EXISTS fixed_routes_dest_geog_idx ON fixed_routes USING GIST(dest_geog);

-- Auto-populate geography columns from lat/lng via trigger
CREATE OR REPLACE FUNCTION set_fixed_route_geog() RETURNS TRIGGER AS $$
BEGIN
  NEW.origin_geog := ST_SetSRID(ST_MakePoint(NEW.origin_lng, NEW.origin_lat), 4326)::geography;
  NEW.dest_geog := ST_SetSRID(ST_MakePoint(NEW.dest_lng, NEW.dest_lat), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fixed_route_geog ON fixed_routes;
CREATE TRIGGER trg_fixed_route_geog
  BEFORE INSERT OR UPDATE ON fixed_routes
  FOR EACH ROW EXECUTE FUNCTION set_fixed_route_geog();
