-- 0010_schema_unification_prep.sql
-- Schema Unification Phase 0: Add new tables and columns without touching existing functionality.
-- This migration is 100% additive — no data is modified, no columns are dropped.
-- Safe to run while Excellent Taxi (Supabase) continues operating independently.

-- ── New enum for OTP channel ──────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE otp_channel AS ENUM ('whatsapp', 'sms');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── New enum for migration source tracking ────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE migration_source AS ENUM ('legacy', 'local', 'migration_script');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add 'company_admin' to admin_role enum (used for Supabase COMPANY_ADMIN mapping)
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'company_admin';

-- ══════════════════════════════════════════════════════════════════════════════
-- ADMINS — add audit/migration tracking columns
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE admins ADD COLUMN IF NOT EXISTS legacy_supabase_id TEXT UNIQUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS migration_source migration_source;

-- ══════════════════════════════════════════════════════════════════════════════
-- DRIVERS — prepare for OTP auth + persistent sessions + employee link
-- ══════════════════════════════════════════════════════════════════════════════

-- Make password_hash nullable (OTP is now the primary auth method for drivers)
ALTER TABLE drivers ALTER COLUMN password_hash DROP NOT NULL;

-- OTP authentication fields
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS otp_code TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS otp_channel otp_channel;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Persistent session (refresh tokens — Uber-style "login once, stay logged in")
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS refresh_token TEXT UNIQUE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ;

-- Optional link to employee (future-proof: when a driver is also on payroll)
-- Not used today (drivers are self-employed), but avoids schema migration later
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS employee_id UUID;

-- Soft delete with timestamp (complements existing is_active boolean)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

-- Migration tracking
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS legacy_supabase_id TEXT UNIQUE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS updated_by UUID;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS drivers_refresh_token_idx ON drivers(refresh_token) WHERE refresh_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS drivers_employee_id_idx ON drivers(employee_id) WHERE employee_id IS NOT NULL;

-- ══════════════════════════════════════════════════════════════════════════════
-- FIXED_ROUTES — add metadata for pricing flexibility + migration tracking
-- ══════════════════════════════════════════════════════════════════════════════

-- Dynamic pricing preparation (all default to static/off for now)
ALTER TABLE fixed_routes ADD COLUMN IF NOT EXISTS is_dynamic_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE fixed_routes ADD COLUMN IF NOT EXISTS base_price NUMERIC(8, 2);
ALTER TABLE fixed_routes ADD COLUMN IF NOT EXISTS rules_config JSONB NOT NULL DEFAULT '{}';

-- Operational metadata
ALTER TABLE fixed_routes ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE fixed_routes ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Migration tracking
ALTER TABLE fixed_routes ADD COLUMN IF NOT EXISTS legacy_supabase_id TEXT UNIQUE;

-- ══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEES — new table for HR/office staff (dispatchers, admin personnel)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  -- Optional link to admin (if the employee has dashboard access)
  admin_id UUID REFERENCES admins(id),
  employee_code TEXT,
  full_name TEXT NOT NULL,
  hourly_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- Soft delete with timestamp for audit trail (complements is_active)
  deactivated_at TIMESTAMPTZ,
  -- Migration tracking
  legacy_supabase_id TEXT UNIQUE,
  updated_by UUID,
  migration_source migration_source,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employees_company_id_idx ON employees(company_id);
CREATE INDEX IF NOT EXISTS employees_admin_id_idx ON employees(admin_id) WHERE admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS employees_active_idx ON employees(company_id, is_active) WHERE is_active = true;

-- ══════════════════════════════════════════════════════════════════════════════
-- TIME_ENTRIES — new table for hour tracking (payroll, immutable history)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  -- ON DELETE RESTRICT: Never cascade-delete time entries when an employee is removed.
  -- HR/payroll data must be immutable for audits and labor compliance.
  -- Use soft deletes (employees.deactivated_at) instead of DELETE.
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  notes TEXT,
  -- Migration tracking
  legacy_supabase_id TEXT UNIQUE,
  updated_by UUID,
  migration_source migration_source,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_company_id_idx ON time_entries(company_id);
CREATE INDEX IF NOT EXISTS time_entries_employee_id_idx ON time_entries(employee_id);
CREATE INDEX IF NOT EXISTS time_entries_date_range_idx ON time_entries(employee_id, start_time DESC);
CREATE INDEX IF NOT EXISTS time_entries_company_period_idx ON time_entries(company_id, start_time DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- DEFERRED FK: drivers.employee_id → employees(id)
-- Added after employees table exists to avoid ordering issues
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  ALTER TABLE drivers
    ADD CONSTRAINT drivers_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
