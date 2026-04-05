-- 0006_production_hardening.sql
-- Add FK delete policies (RESTRICT) and CHECK constraints for data integrity

-- ── FK Delete Policies ────────────────────────────────────────────────────────
-- rides.rider_id → RESTRICT (cannot delete rider with rides)
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_rider_id_riders_id_fk;
ALTER TABLE rides ADD CONSTRAINT rides_rider_id_riders_id_fk
  FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE RESTRICT;

-- rides.driver_id → RESTRICT (cannot delete driver with rides)
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_driver_id_drivers_id_fk;
ALTER TABLE rides ADD CONSTRAINT rides_driver_id_drivers_id_fk
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE RESTRICT;

-- payments.ride_id → RESTRICT (cannot delete ride with payments)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_ride_id_rides_id_fk;
ALTER TABLE payments ADD CONSTRAINT payments_ride_id_rides_id_fk
  FOREIGN KEY (ride_id) REFERENCES rides(id) ON DELETE RESTRICT;

-- payments.rider_id → RESTRICT (cannot delete rider with payments)
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_rider_id_riders_id_fk;
ALTER TABLE payments ADD CONSTRAINT payments_rider_id_riders_id_fk
  FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE RESTRICT;

-- ── CHECK Constraints ─────────────────────────────────────────────────────────
-- Fare amounts must be non-negative
ALTER TABLE rides ADD CONSTRAINT rides_fare_estimate_positive
  CHECK (fare_estimate IS NULL OR fare_estimate >= 0);
ALTER TABLE rides ADD CONSTRAINT rides_fare_final_positive
  CHECK (fare_final IS NULL OR fare_final >= 0);

-- Distance and duration must be non-negative
ALTER TABLE rides ADD CONSTRAINT rides_distance_positive
  CHECK (distance_km IS NULL OR distance_km >= 0);
ALTER TABLE rides ADD CONSTRAINT rides_duration_positive
  CHECK (duration_min IS NULL OR duration_min >= 0);

-- Payment amounts must be non-negative
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive
  CHECK (amount >= 0);
ALTER TABLE payments ADD CONSTRAINT payments_commission_positive
  CHECK (commission_amount IS NULL OR commission_amount >= 0);

-- Commission amounts must be non-negative
ALTER TABLE commissions ADD CONSTRAINT commissions_fare_positive
  CHECK (fare_amount >= 0);
ALTER TABLE commissions ADD CONSTRAINT commissions_commission_positive
  CHECK (commission_amount >= 0);
ALTER TABLE commissions ADD CONSTRAINT commissions_earnings_positive
  CHECK (driver_earnings >= 0);

-- Pricing rules must be non-negative
ALTER TABLE pricing_rules ADD CONSTRAINT pricing_base_rate_positive
  CHECK (base_rate_per_mile >= 0);
ALTER TABLE pricing_rules ADD CONSTRAINT pricing_minimum_fare_positive
  CHECK (minimum_fare >= 0);
ALTER TABLE pricing_rules ADD CONSTRAINT pricing_per_minute_positive
  CHECK (per_minute_rate >= 0);

-- Fixed routes price must be positive
ALTER TABLE fixed_routes ADD CONSTRAINT fixed_routes_price_positive
  CHECK (fixed_price > 0);
ALTER TABLE fixed_routes ADD CONSTRAINT fixed_routes_radius_positive
  CHECK (radius_meters > 0);
