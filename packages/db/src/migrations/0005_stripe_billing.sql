-- 0005_stripe_billing.sql
-- Stripe Connect, driver subscriptions, company billing, commission tracking

-- ── Subscription status enum ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Add Stripe fields to companies ────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status subscription_status DEFAULT 'trialing',
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00;

CREATE INDEX IF NOT EXISTS companies_stripe_account_id_idx ON companies (stripe_account_id) WHERE stripe_account_id IS NOT NULL;

-- ── Add Stripe subscription fields to drivers ─────────────────────────────────
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status subscription_status DEFAULT NULL;

CREATE INDEX IF NOT EXISTS drivers_stripe_subscription_idx ON drivers (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- ── Commissions table — tracks per-ride commission ────────────────────────────
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id),
  fare_amount NUMERIC(10,2) NOT NULL,
  commission_percent NUMERIC(5,2) NOT NULL,
  commission_amount NUMERIC(10,2) NOT NULL,
  driver_earnings NUMERIC(10,2) NOT NULL,
  stripe_transfer_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'transferred', 'failed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS commissions_company_id_idx ON commissions (company_id);
CREATE INDEX IF NOT EXISTS commissions_driver_id_idx ON commissions (driver_id);
CREATE INDEX IF NOT EXISTS commissions_ride_id_idx ON commissions (ride_id);
CREATE INDEX IF NOT EXISTS commissions_status_idx ON commissions (status) WHERE status = 'pending';

-- ── Stripe webhook events — idempotency tracking ─────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,  -- Stripe event ID (evt_xxx)
  type TEXT NOT NULL,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  company_id UUID REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_type_idx ON stripe_webhook_events (type);

-- ── Add commission_amount to payments ─────────────────────────────────────────
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10,2);
