-- Multi-tenancy: companies table + companyId on all tenant-scoped tables
-- Also adds platform_admin role to admin_role enum

-- 1. Add platform_admin to admin_role enum
ALTER TYPE admin_role ADD VALUE IF NOT EXISTS 'platform_admin';

-- 2. Create companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo TEXT,
  whatsapp_jid TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS companies_slug_idx ON companies (slug);
CREATE INDEX IF NOT EXISTS companies_active_idx ON companies (is_active) WHERE is_active = true;

-- 3. Create a default company for existing data
INSERT INTO companies (id, name, slug, settings)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default Company',
  'default',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- 4. Add companyId to drivers
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE drivers SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
ALTER TABLE drivers ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS drivers_company_id_idx ON drivers (company_id);

-- 5. Add companyId to riders
ALTER TABLE riders ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE riders SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
ALTER TABLE riders ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS riders_company_id_idx ON riders (company_id);

-- 6. Add companyId to rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE rides SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
ALTER TABLE rides ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS rides_company_id_idx ON rides (company_id);

-- 7. Add companyId to vehicles
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE vehicles SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
ALTER TABLE vehicles ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_company_id_idx ON vehicles (company_id);

-- 8. Add companyId to payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE payments SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
ALTER TABLE payments ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS payments_company_id_idx ON payments (company_id);

-- 9. Add companyId to admins (company_admin scope)
ALTER TABLE admins ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
UPDATE admins SET company_id = '00000000-0000-0000-0000-000000000001' WHERE company_id IS NULL;
-- admins.company_id is nullable: platform_admin has no company scope
CREATE INDEX IF NOT EXISTS admins_company_id_idx ON admins (company_id);

-- 10. Add companyId to riders_auth (inherits from riders, but useful for direct lookups)
-- riders_auth already has riderId FK, so companyId is derivable. Skip adding it here.
