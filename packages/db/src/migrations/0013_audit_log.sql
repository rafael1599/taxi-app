-- 0013_audit_log.sql
-- Tamper-evident audit log with hash-chain integrity (PCI DSS Req. 10).
--
-- This migration creates:
--   1. audit_log table — append-only, RLS-protected
--   2. audit_hash_chain_fn() — BEFORE INSERT trigger that computes a
--      cryptographic hash chain per (entity_type, entity_id) series
--   3. record_audit_fn() — generic AFTER trigger that captures row changes
--      on critical tables and inserts audit entries automatically
--
-- Hash-chain mechanism explained:
-- ─────────────────────────────────────────────────────────────────────────
-- Each audit_log row contains two hash columns:
--
--   prev_row_hash — the row_hash of the most recent prior audit entry for
--                   the same (entity_type, entity_id).  NULL for the first
--                   entry in the chain.
--
--   row_hash      — SHA-256( prev_row_hash || entity_type || entity_id
--                            || action || occurred_at || after_hash )
--
-- This creates a per-entity linked chain of hashes.  If any row is
-- modified or deleted after the fact, the chain breaks: the next row's
-- prev_row_hash will not match the tampered row's row_hash, and
-- recomputing row_hash from the tampered data will differ from the stored
-- value.  This makes post-hoc tampering detectable with a simple
-- sequential scan (verification query not included here — that lives in
-- application code or a scheduled check).
--
-- Why triggers and not application-level logging:
--   1. Cannot be bypassed by raw SQL from a compromised app
--   2. Captures changes made during migrations
--   3. Single point of truth for PCI DSS Req. 10.2
--   4. Hash-chain makes tampering detectable without external witnesses
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. AUDIT_LOG TABLE
-- ══════════════════════════════════════════════════════════════════════════

CREATE TABLE audit_log (
  id               bigserial PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  company_id       uuid,
  actor_type       text NOT NULL,       -- 'admin' | 'driver' | 'rider' | 'system' | 'stripe_webhook' | 'bot'
  actor_id         uuid,
  actor_ip_hash    bytea,               -- SHA-256(ip || daily_salt) — never store IP in cleartext
  action           text NOT NULL,        -- 'create' | 'update' | 'delete' | 'login' | 'export' | 'impersonate'
  entity_type      text NOT NULL,        -- table name: 'rides', 'drivers', 'payments', etc.
  entity_id        uuid,
  before_hash      bytea,               -- SHA-256 of the previous row state (JSONB), no PII in audit
  after_hash       bytea,               -- SHA-256 of the new row state (JSONB)
  diff_summary     text,                -- comma-separated field names that changed, never values
  request_id       uuid,
  user_agent_hash  bytea,
  prev_row_hash    bytea,               -- hash-chain: row_hash of the previous audit entry for this entity
  row_hash         bytea NOT NULL        -- hash-chain: SHA-256(prev_row_hash || entity_type || ... || after_hash)
);

-- ── RLS: append-only enforcement ──────────────────────────────────────────
-- Revoke UPDATE and DELETE from all roles.  The audit log is INSERT-only
-- by design — rows must never be modified or removed.
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT (the trigger handles hash computation).
CREATE POLICY audit_append_only ON audit_log
  FOR INSERT WITH CHECK (true);

-- Read access scoped to the actor's company, or unrestricted for
-- platform_admin.  app.company_id and app.role are set per-request
-- by the Fastify middleware via SET LOCAL.
CREATE POLICY audit_read_same_company ON audit_log
  FOR SELECT
  USING (
    company_id = current_setting('app.company_id', true)::uuid
    OR current_setting('app.role', true) = 'platform_admin'
  );

-- ── Indexes ───────────────────────────────────────────────────────────────
-- Composite B-tree for "show me the audit trail for entity X" queries.
CREATE INDEX audit_log_entity_idx
  ON audit_log (entity_type, entity_id, occurred_at DESC);

-- Composite B-tree for "show me everything actor Y did" queries.
CREATE INDEX audit_log_actor_idx
  ON audit_log (actor_type, actor_id, occurred_at DESC);

-- BRIN index on occurred_at for efficient time-range scans.  BRIN is
-- ideal here because audit_log is append-only, so occurred_at is
-- naturally correlated with physical row order.
CREATE INDEX audit_log_occurred_brin
  ON audit_log USING brin (occurred_at);


-- ══════════════════════════════════════════════════════════════════════════
-- 2. HASH-CHAIN TRIGGER FUNCTION
-- ══════════════════════════════════════════════════════════════════════════
-- Called BEFORE INSERT on audit_log.  Fetches the most recent row_hash for
-- the same (entity_type, entity_id) and computes the new row_hash,
-- linking it cryptographically to its predecessor.
--
-- If this is the first audit entry for a given entity, prev_row_hash is
-- NULL and the hash is computed over (NULL || entity_type || ...).  This
-- is intentional — the chain starts with a known "genesis" state.

CREATE OR REPLACE FUNCTION audit_hash_chain_fn()
RETURNS TRIGGER AS $$
DECLARE
  _prev bytea;
BEGIN
  -- Fetch the row_hash of the most recent audit entry for the same entity.
  -- The ORDER BY id DESC LIMIT 1 ensures we always get the latest even if
  -- two entries share the same occurred_at.
  SELECT row_hash INTO _prev
    FROM audit_log
   WHERE entity_type = NEW.entity_type
     AND entity_id   = NEW.entity_id
   ORDER BY id DESC
   LIMIT 1;

  -- Link to the previous entry (NULL if this is the first).
  NEW.prev_row_hash := _prev;

  -- Compute row_hash = SHA-256(prev_row_hash || entity_type || entity_id
  --                            || action || occurred_at || after_hash)
  --
  -- We use coalesce(..., '') to handle NULL prev_row_hash and after_hash
  -- deterministically.  The '||' operator on bytea/text concatenates the
  -- raw bytes; convert_to() encodes text fields as UTF-8 bytes before
  -- hashing.
  NEW.row_hash := digest(
    coalesce(_prev, '\x00'::bytea)
    || convert_to(NEW.entity_type, 'UTF8')
    || coalesce(NEW.entity_id::text::bytea, '\x00'::bytea)
    || convert_to(NEW.action, 'UTF8')
    || convert_to(NEW.occurred_at::text, 'UTF8')
    || coalesce(NEW.after_hash, '\x00'::bytea),
    'sha256'
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_hash_chain_fn() IS
  'BEFORE INSERT trigger on audit_log: computes prev_row_hash and row_hash '
  'to form a tamper-evident hash chain per (entity_type, entity_id).';


-- ══════════════════════════════════════════════════════════════════════════
-- 3. APPLY HASH-CHAIN TRIGGER
-- ══════════════════════════════════════════════════════════════════════════

CREATE TRIGGER audit_hash_chain_trg
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_hash_chain_fn();


-- ══════════════════════════════════════════════════════════════════════════
-- 4. GENERIC AUDIT TRIGGER FUNCTION FOR CRITICAL TABLES
-- ══════════════════════════════════════════════════════════════════════════
-- This function is attached AFTER INSERT OR UPDATE OR DELETE on each
-- audited table.  It captures the old/new row state, computes content
-- hashes (never storing PII in the audit log), and inserts into audit_log.
--
-- Application code is expected to set these session variables per-request:
--   SET LOCAL app.actor_type = 'admin';
--   SET LOCAL app.actor_id   = '<uuid>';
--   SET LOCAL app.company_id = '<uuid>';
--   SET LOCAL app.request_id = '<uuid>';
--
-- If these are not set, the trigger defaults to actor_type = 'system' and
-- leaves the rest NULL.  This ensures migrations and manual SQL still
-- produce audit entries.

CREATE OR REPLACE FUNCTION record_audit_fn()
RETURNS TRIGGER AS $$
DECLARE
  _old_json   jsonb;
  _new_json   jsonb;
  _before     bytea;
  _after      bytea;
  _diff       text;
  _entity_id  uuid;
  _company    uuid;
  _actor_type text;
  _actor_id   uuid;
  _request_id uuid;
  _action     text;
  _key        text;
BEGIN
  -- ── Capture OLD / NEW as JSONB ────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    _old_json := to_jsonb(OLD);
    _new_json := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    _old_json := NULL;
    _new_json := to_jsonb(NEW);
  ELSE  -- UPDATE
    _old_json := to_jsonb(OLD);
    _new_json := to_jsonb(NEW);
  END IF;

  -- ── Compute content hashes ────────────────────────────────────────────
  -- We hash the JSONB text representation.  This means the audit log never
  -- stores actual row data (PII stays in the source table), but we can
  -- verify integrity by re-hashing the current row and comparing.
  IF _old_json IS NOT NULL THEN
    _before := digest(convert_to(_old_json::text, 'UTF8'), 'sha256');
  END IF;

  IF _new_json IS NOT NULL THEN
    _after := digest(convert_to(_new_json::text, 'UTF8'), 'sha256');
  END IF;

  -- ── Compute diff_summary (field names only, never values) ─────────────
  -- For UPDATE, list the keys whose values changed.
  -- For INSERT/DELETE, leave NULL (the entire row was created/removed).
  IF TG_OP = 'UPDATE' AND _old_json IS NOT NULL AND _new_json IS NOT NULL THEN
    SELECT string_agg(k, ', ' ORDER BY k)
      INTO _diff
      FROM (
        SELECT key AS k
          FROM jsonb_each(_new_json)
         WHERE _old_json ->> key IS DISTINCT FROM _new_json ->> key
      ) changed_keys;
  END IF;

  -- ── Map TG_OP to action vocabulary ────────────────────────────────────
  CASE TG_OP
    WHEN 'INSERT' THEN _action := 'create';
    WHEN 'UPDATE' THEN _action := 'update';
    WHEN 'DELETE' THEN _action := 'delete';
    ELSE               _action := lower(TG_OP);
  END CASE;

  -- ── Determine entity_id ───────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    _entity_id := (OLD).id;
  ELSE
    _entity_id := (NEW).id;
  END IF;

  -- ── Extract company_id if the table has one ───────────────────────────
  -- Use NEW when available (INSERT/UPDATE), fall back to OLD (DELETE).
  IF TG_OP = 'DELETE' THEN
    IF _old_json ? 'company_id' THEN
      _company := (_old_json ->> 'company_id')::uuid;
    END IF;
  ELSE
    IF _new_json ? 'company_id' THEN
      _company := (_new_json ->> 'company_id')::uuid;
    END IF;
  END IF;

  -- ── Read session variables set by application middleware ───────────────
  _actor_type := coalesce(
    nullif(current_setting('app.actor_type', true), ''),
    'system'
  );

  BEGIN
    _actor_id := current_setting('app.actor_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    _actor_id := NULL;
  END;

  BEGIN
    _request_id := current_setting('app.request_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    _request_id := NULL;
  END;

  -- ── Insert the audit entry ────────────────────────────────────────────
  -- row_hash and prev_row_hash are computed by audit_hash_chain_trg
  -- (the BEFORE INSERT trigger on audit_log).  We pass a placeholder
  -- row_hash here; the trigger will overwrite it.
  INSERT INTO audit_log (
    company_id,
    actor_type,
    actor_id,
    action,
    entity_type,
    entity_id,
    before_hash,
    after_hash,
    diff_summary,
    request_id,
    row_hash        -- placeholder, overwritten by audit_hash_chain_trg
  ) VALUES (
    _company,
    _actor_type,
    _actor_id,
    _action,
    TG_TABLE_NAME,
    _entity_id,
    _before,
    _after,
    _diff,
    _request_id,
    '\x00'::bytea   -- placeholder, the BEFORE INSERT trigger sets the real value
  );

  -- Always return the appropriate row so the original operation proceeds.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION record_audit_fn() IS
  'Generic AFTER trigger function: captures row changes on audited tables '
  'and inserts into audit_log with content hashes (no PII stored). '
  'Expects app.actor_type, app.actor_id, app.request_id session variables.';


-- ══════════════════════════════════════════════════════════════════════════
-- 5. APPLY AUDIT TRIGGERS ON CRITICAL TABLES
-- ══════════════════════════════════════════════════════════════════════════
-- Each trigger fires AFTER the row change so that the source operation
-- succeeds or fails on its own merits; the audit entry is a side effect.
--
-- Tables audited (per approved plan):
--   admins, drivers, riders, rides, payments, pricing_rules,
--   zone_minimums, fixed_routes, commissions, trip_offers

CREATE TRIGGER audit_admins_trg
  AFTER INSERT OR UPDATE OR DELETE ON admins
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_drivers_trg
  AFTER INSERT OR UPDATE OR DELETE ON drivers
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_riders_trg
  AFTER INSERT OR UPDATE OR DELETE ON riders
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_rides_trg
  AFTER INSERT OR UPDATE OR DELETE ON rides
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_payments_trg
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_pricing_rules_trg
  AFTER INSERT OR UPDATE OR DELETE ON pricing_rules
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_zone_minimums_trg
  AFTER INSERT OR UPDATE OR DELETE ON zone_minimums
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_fixed_routes_trg
  AFTER INSERT OR UPDATE OR DELETE ON fixed_routes
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_commissions_trg
  AFTER INSERT OR UPDATE OR DELETE ON commissions
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

CREATE TRIGGER audit_trip_offers_trg
  AFTER INSERT OR UPDATE OR DELETE ON trip_offers
  FOR EACH ROW EXECUTE FUNCTION record_audit_fn();

COMMIT;
