-- Migration 0004: Trip lifecycle service + automatic driver matching
-- Adds driver_status enum, trip_offers table, and updates ride_status enum

-- ── Driver status enum ──────────────────────────────────────────────────────
CREATE TYPE driver_status AS ENUM (
  'offline',
  'idle',
  'incoming',
  'accepted',
  'en_route',
  'arrived',
  'picked_up',
  'completed'
);

ALTER TABLE drivers ADD COLUMN status driver_status NOT NULL DEFAULT 'offline';

-- Backfill: available drivers → idle, unavailable → offline
UPDATE drivers SET status = 'idle' WHERE is_available = TRUE AND is_active = TRUE;
UPDATE drivers SET status = 'offline' WHERE is_available = FALSE OR is_active = FALSE;

-- ── Expand ride_status enum ─────────────────────────────────────────────────
-- Add new statuses: searching_driver, driver_assigned, en_route, picked_up
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'searching_driver' BEFORE 'accepted';
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'driver_assigned' AFTER 'searching_driver';
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'en_route' AFTER 'arrived';
ALTER TYPE ride_status ADD VALUE IF NOT EXISTS 'picked_up' AFTER 'en_route';

-- ── Trip offer status enum ──────────────────────────────────────────────────
CREATE TYPE trip_offer_status AS ENUM (
  'pending',
  'accepted',
  'rejected',
  'expired'
);

-- ── Trip offers table ───────────────────────────────────────────────────────
CREATE TABLE trip_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  status trip_offer_status NOT NULL DEFAULT 'pending',
  offered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX trip_offers_ride_id_idx ON trip_offers(ride_id);
CREATE INDEX trip_offers_driver_id_idx ON trip_offers(driver_id);
CREATE INDEX trip_offers_company_id_idx ON trip_offers(company_id);
CREATE INDEX trip_offers_pending_idx ON trip_offers(status, expires_at)
  WHERE status = 'pending';

-- ── Add searching-related columns to rides ──────────────────────────────────
ALTER TABLE rides ADD COLUMN search_expires_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN rejected_driver_ids UUID[] DEFAULT '{}';

-- Update rides status index to include new statuses
DROP INDEX IF EXISTS rides_status_idx;
CREATE INDEX rides_status_idx ON rides(status)
  WHERE status IN ('requested', 'searching_driver', 'driver_assigned', 'accepted', 'en_route', 'in_progress');

-- ── Driver status index ─────────────────────────────────────────────────────
CREATE INDEX drivers_status_idx ON drivers(status) WHERE status = 'idle';
