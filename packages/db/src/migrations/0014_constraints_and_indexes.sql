-- 0014_constraints_and_indexes.sql
-- Additional CHECK constraints, FK indexes, BRIN indexes, and partial unique constraints.
-- Complements 0006_production_hardening.sql (which already covers fare/distance/pricing CHECKs)
-- and 0008_ratings (which already has score CHECK 1-5).

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. CHECK CONSTRAINTS (only those NOT already in 0006 or 0008)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── commissions.commission_percent BETWEEN 0 AND 100 ────────────────────────
DO $$ BEGIN
  ALTER TABLE commissions ADD CONSTRAINT commissions_percent_range
    CHECK (commission_percent BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── zone_minimums.minimum_fare > 0 ──────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE zone_minimums ADD CONSTRAINT zone_minimums_fare_positive
    CHECK (minimum_fare > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Lat/lng range constraints — rides ───────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_pickup_lat_range
    CHECK (pickup_lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_pickup_lng_range
    CHECK (pickup_lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_dropoff_lat_range
    CHECK (dropoff_lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_dropoff_lng_range
    CHECK (dropoff_lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Lat/lng range constraints — drivers ─────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE drivers ADD CONSTRAINT drivers_lat_range
    CHECK (current_lat IS NULL OR current_lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE drivers ADD CONSTRAINT drivers_lng_range
    CHECK (current_lng IS NULL OR current_lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Lat/lng range constraints — fixed_routes ────────────────────────────────
DO $$ BEGIN
  ALTER TABLE fixed_routes ADD CONSTRAINT fixed_routes_origin_lat_range
    CHECK (origin_lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE fixed_routes ADD CONSTRAINT fixed_routes_origin_lng_range
    CHECK (origin_lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE fixed_routes ADD CONSTRAINT fixed_routes_dest_lat_range
    CHECK (dest_lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE fixed_routes ADD CONSTRAINT fixed_routes_dest_lng_range
    CHECK (dest_lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Ride timeline coherence ─────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_accepted_after_requested
    CHECK (accepted_at IS NULL OR accepted_at >= requested_at);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_picked_up_after_accepted
    CHECK (picked_up_at IS NULL OR accepted_at IS NULL OR picked_up_at >= accepted_at);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_dropped_off_after_picked_up
    CHECK (dropped_off_at IS NULL OR picked_up_at IS NULL OR dropped_off_at >= picked_up_at);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE rides ADD CONSTRAINT rides_cancelled_after_requested
    CHECK (cancelled_at IS NULL OR cancelled_at >= requested_at);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. FK INDEXES (covering foreign keys that lack indexes)
-- ══════════════════════════════════════════════════════════════════════════════

-- vehicles(driver_id) — no existing index
CREATE INDEX IF NOT EXISTS vehicles_driver_id_idx ON vehicles(driver_id);

-- vehicles(company_id) — already exists from 0002 (vehicles_company_id_idx)
-- skipped

-- ratings(from_driver_id) — partial, only non-null
CREATE INDEX IF NOT EXISTS ratings_from_driver_id_idx ON ratings(from_driver_id)
  WHERE from_driver_id IS NOT NULL;

-- ratings(from_rider_id) — partial, only non-null
CREATE INDEX IF NOT EXISTS ratings_from_rider_id_idx ON ratings(from_rider_id)
  WHERE from_rider_id IS NOT NULL;

-- riders_auth(rider_id) — no existing index
CREATE INDEX IF NOT EXISTS riders_auth_rider_id_idx ON riders_auth(rider_id);

-- stripe_webhook_events(company_id) — partial, only non-null
CREATE INDEX IF NOT EXISTS stripe_webhook_events_company_id_idx ON stripe_webhook_events(company_id)
  WHERE company_id IS NOT NULL;

-- driver_metrics(ride_id) — partial, only non-null
CREATE INDEX IF NOT EXISTS driver_metrics_ride_id_idx ON driver_metrics(ride_id)
  WHERE ride_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. FLOAT → NUMERIC CONVERSIONS (monetary columns)
-- ══════════════════════════════════════════════════════════════════════════════
-- Reviewed all tables:
--   rides.fare_estimate, rides.fare_final → already NUMERIC(8,2) from 0000
--   payments.amount, payments.commission_amount → already NUMERIC(10,2)
--   commissions.fare_amount, commission_amount, driver_earnings → already NUMERIC(10,2)
--   pricing_rules.base_rate_per_mile, minimum_fare, per_minute_rate → already NUMERIC(8,2)
--   zone_minimums.minimum_fare → already NUMERIC(8,2)
--   fixed_routes.fixed_price, base_price → already NUMERIC(8,2)
--   companies.commission_percent → already NUMERIC(5,2)
--   employees.hourly_rate → already NUMERIC(8,2)
--
-- rides.distance_km (doublePrecision) — NOT money, stays as-is.
-- rides.pickup_lat/lng, dropoff_lat/lng — coordinates, stay as doublePrecision.
-- drivers.current_lat/lng — coordinates, stay as doublePrecision.
-- fixed_routes.origin_lat/lng, dest_lat/lng — coordinates, stay as doublePrecision.
--
-- No float-to-numeric conversions needed.

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. BRIN INDEXES on append-only tables
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS driver_metrics_created_brin
  ON driver_metrics USING brin(created_at);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_processed_brin
  ON stripe_webhook_events USING brin(processed_at);

CREATE INDEX IF NOT EXISTS commissions_created_brin
  ON commissions USING brin(created_at);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. PARTIAL UNIQUE for soft-delete (active drivers only)
-- ══════════════════════════════════════════════════════════════════════════════

-- Allow re-registration of an email after a driver is deactivated.
-- The existing UNIQUE(email) on drivers prevents this, so we replace it
-- with a partial unique index scoped to active (non-deactivated) drivers.

-- Drop the old unconditional unique constraint first
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_email_unique;
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_email_key;

-- Drop any plain unique index on email
DROP INDEX IF EXISTS drivers_email_unique;
DROP INDEX IF EXISTS drivers_email_key;

-- Create partial unique index: email must be unique only among active drivers
CREATE UNIQUE INDEX IF NOT EXISTS drivers_email_active_unique
  ON drivers (lower(email))
  WHERE deactivated_at IS NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. rejected_driver_ids TYPE CHECK
-- ══════════════════════════════════════════════════════════════════════════════
-- rides.rejected_driver_ids was created as UUID[] in 0004_trip_lifecycle.sql:
--   ALTER TABLE rides ADD COLUMN rejected_driver_ids UUID[] DEFAULT '{}';
--
-- The Drizzle schema shows it as text() for ORM compatibility, but the actual
-- database column is already uuid[]. No type conversion needed.
--
-- NOTE: If the column were somehow text in a given environment, uncomment:
-- ALTER TABLE rides ALTER COLUMN rejected_driver_ids
--   TYPE uuid[] USING string_to_array(rejected_driver_ids, ',')::uuid[];

COMMIT;
