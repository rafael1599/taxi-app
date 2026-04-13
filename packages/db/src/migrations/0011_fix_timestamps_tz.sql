-- 0011_fix_timestamps_tz.sql
-- ============================================================================
-- Fix timestamp columns to TIMESTAMPTZ across all tables.
--
-- The Drizzle schema defines ~49 timestamp columns as timestamp() without
-- { withTimezone: true }, which maps to TIMESTAMP WITHOUT TIME ZONE.
-- However, all prior migrations (0000–0010) already created these columns as
-- TIMESTAMPTZ. This migration ensures every timestamp column is definitively
-- TIMESTAMPTZ, making the database authoritative regardless of ORM config.
--
-- This migration is idempotent: PostgreSQL silently accepts ALTER COLUMN TYPE
-- to the same type it already has, so it is safe to re-run.
-- ============================================================================

BEGIN;

-- ── companies ───────────────────────────────────────────────────────────────
ALTER TABLE companies ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE companies ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── riders ──────────────────────────────────────────────────────────────────
ALTER TABLE riders ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE riders ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── drivers ─────────────────────────────────────────────────────────────────
ALTER TABLE drivers ALTER COLUMN location_at       TYPE TIMESTAMPTZ USING location_at       AT TIME ZONE 'UTC';
ALTER TABLE drivers ALTER COLUMN otp_expires_at    TYPE TIMESTAMPTZ USING otp_expires_at    AT TIME ZONE 'UTC';
ALTER TABLE drivers ALTER COLUMN last_login_at     TYPE TIMESTAMPTZ USING last_login_at     AT TIME ZONE 'UTC';
ALTER TABLE drivers ALTER COLUMN refresh_token_expires_at TYPE TIMESTAMPTZ USING refresh_token_expires_at AT TIME ZONE 'UTC';
ALTER TABLE drivers ALTER COLUMN deactivated_at    TYPE TIMESTAMPTZ USING deactivated_at    AT TIME ZONE 'UTC';
ALTER TABLE drivers ALTER COLUMN created_at        TYPE TIMESTAMPTZ USING created_at        AT TIME ZONE 'UTC';
ALTER TABLE drivers ALTER COLUMN updated_at        TYPE TIMESTAMPTZ USING updated_at        AT TIME ZONE 'UTC';

-- ── riders_auth ─────────────────────────────────────────────────────────────
ALTER TABLE riders_auth ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE riders_auth ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── vehicles ────────────────────────────────────────────────────────────────
ALTER TABLE vehicles ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- ── rides ───────────────────────────────────────────────────────────────────
ALTER TABLE rides ALTER COLUMN requested_at     TYPE TIMESTAMPTZ USING requested_at     AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN accepted_at      TYPE TIMESTAMPTZ USING accepted_at      AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN picked_up_at     TYPE TIMESTAMPTZ USING picked_up_at     AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN dropped_off_at   TYPE TIMESTAMPTZ USING dropped_off_at   AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN cancelled_at     TYPE TIMESTAMPTZ USING cancelled_at     AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN search_expires_at TYPE TIMESTAMPTZ USING search_expires_at AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN created_at       TYPE TIMESTAMPTZ USING created_at       AT TIME ZONE 'UTC';
ALTER TABLE rides ALTER COLUMN updated_at       TYPE TIMESTAMPTZ USING updated_at       AT TIME ZONE 'UTC';

-- ── payments ────────────────────────────────────────────────────────────────
ALTER TABLE payments ALTER COLUMN captured_at TYPE TIMESTAMPTZ USING captured_at AT TIME ZONE 'UTC';
ALTER TABLE payments ALTER COLUMN refunded_at TYPE TIMESTAMPTZ USING refunded_at AT TIME ZONE 'UTC';
ALTER TABLE payments ALTER COLUMN failed_at   TYPE TIMESTAMPTZ USING failed_at   AT TIME ZONE 'UTC';
ALTER TABLE payments ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at  AT TIME ZONE 'UTC';

-- ── trip_offers ─────────────────────────────────────────────────────────────
ALTER TABLE trip_offers ALTER COLUMN offered_at   TYPE TIMESTAMPTZ USING offered_at   AT TIME ZONE 'UTC';
ALTER TABLE trip_offers ALTER COLUMN expires_at   TYPE TIMESTAMPTZ USING expires_at   AT TIME ZONE 'UTC';
ALTER TABLE trip_offers ALTER COLUMN responded_at TYPE TIMESTAMPTZ USING responded_at AT TIME ZONE 'UTC';
ALTER TABLE trip_offers ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at   AT TIME ZONE 'UTC';

-- ── pricing_rules ───────────────────────────────────────────────────────────
ALTER TABLE pricing_rules ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE pricing_rules ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── zone_minimums ───────────────────────────────────────────────────────────
ALTER TABLE zone_minimums ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE zone_minimums ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── fixed_routes ────────────────────────────────────────────────────────────
ALTER TABLE fixed_routes ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE fixed_routes ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── commissions ─────────────────────────────────────────────────────────────
ALTER TABLE commissions ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- ── stripe_webhook_events ───────────────────────────────────────────────────
ALTER TABLE stripe_webhook_events ALTER COLUMN processed_at TYPE TIMESTAMPTZ USING processed_at AT TIME ZONE 'UTC';

-- ── ratings ─────────────────────────────────────────────────────────────────
ALTER TABLE ratings ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- ── driver_metrics ──────────────────────────────────────────────────────────
ALTER TABLE driver_metrics ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- ── admins ──────────────────────────────────────────────────────────────────
ALTER TABLE admins ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';
ALTER TABLE admins ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- ── employees ───────────────────────────────────────────────────────────────
ALTER TABLE employees ALTER COLUMN deactivated_at TYPE TIMESTAMPTZ USING deactivated_at AT TIME ZONE 'UTC';
ALTER TABLE employees ALTER COLUMN created_at     TYPE TIMESTAMPTZ USING created_at     AT TIME ZONE 'UTC';
ALTER TABLE employees ALTER COLUMN updated_at     TYPE TIMESTAMPTZ USING updated_at     AT TIME ZONE 'UTC';

-- ── time_entries ────────────────────────────────────────────────────────────
ALTER TABLE time_entries ALTER COLUMN start_time  TYPE TIMESTAMPTZ USING start_time  AT TIME ZONE 'UTC';
ALTER TABLE time_entries ALTER COLUMN end_time    TYPE TIMESTAMPTZ USING end_time    AT TIME ZONE 'UTC';
ALTER TABLE time_entries ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE time_entries ALTER COLUMN updated_at  TYPE TIMESTAMPTZ USING updated_at  AT TIME ZONE 'UTC';

COMMIT;
