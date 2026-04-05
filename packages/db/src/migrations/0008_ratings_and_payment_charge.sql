-- 0008_ratings_and_payment_charge.sql
-- Add ratings table and enhance payments for charge-at-completion

-- ── Ratings table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  from_driver_id UUID REFERENCES drivers(id),
  from_rider_id UUID REFERENCES riders(id),
  to_driver_id UUID REFERENCES drivers(id),
  to_rider_id UUID REFERENCES riders(id),
  score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ratings_ride_id_idx ON ratings(ride_id);
CREATE INDEX IF NOT EXISTS ratings_to_driver_id_idx ON ratings(to_driver_id);
CREATE INDEX IF NOT EXISTS ratings_to_rider_id_idx ON ratings(to_rider_id);
CREATE INDEX IF NOT EXISTS ratings_company_id_idx ON ratings(company_id);

-- Unique constraint: one rating per ride per direction
CREATE UNIQUE INDEX IF NOT EXISTS ratings_ride_from_rider_idx ON ratings(ride_id, from_rider_id) WHERE from_rider_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ratings_ride_from_driver_idx ON ratings(ride_id, from_driver_id) WHERE from_driver_id IS NOT NULL;

-- ── Add average rating columns to drivers and riders ─────────────────────────

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS total_ratings INTEGER NOT NULL DEFAULT 0;

ALTER TABLE riders ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT NULL;
ALTER TABLE riders ADD COLUMN IF NOT EXISTS total_ratings INTEGER NOT NULL DEFAULT 0;

-- ── Enhance payments for Stripe charge flow ──────────────────────────────────

ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
