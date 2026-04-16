# ADR-002: Pricing Engine Strategy for Drivly (Port vs Rewrite)

**Date:** 2026-04-15
**Status:** Accepted
**Deciders:** Lead Engineer (spike time-boxed 4-6h)
**Supersedes:** N/A
**Related:** ADR-001 (tech stack), `schema-unification-plan.md` §3.1 + §4 D8, `database-audit-and-plan.md` §11, `ARCHITECTURE-FINDINGS.md` §3.0a/b/c, §8.2D, §8.3b, §8.5

---

## 1. Context

### 1.1 The current pricing engine (control-de-horas)

`control-de-horas/packages/backend/src/services/price-calculator.service.ts` is **864 LoC** of single-file pricing logic, complemented by `price-override.service.ts` (146 LoC, Prisma-backed `PriceOverride` table). Total surface: **~1,010 LoC**.

Functional surface (what actually decides a price):

- `detectTown(locationString)` — string-based town extraction with two priority bands (Rockland, then East-side / NYC) plus disambiguation for Palisades, Newark/EWR, JFK/LGA, "West New York, NJ" vs "New York", and a `hasWord()` helper that escapes regex and uses word boundaries.
- `expandGmapsLink(url)` — resolves shortened maps URLs with SSRF allowlist (`*.google.com`, `*.goo.gl`), strips `dirflg`/`avoid`, parses `!1d`/`!3d`/`@lat,lng`/`saddr`/`daddr` patterns, and detects single-pin links.
- `geocode(q, near?)` — POI-first (local + `dest_keywords`), then Google Place ID + cache, then a 5-stage Nominatim fallback (Local viewbox → NJ → NY → CT → USA).
- `findMatchingOverride(...)` — DB scan over active `PriceOverride` rows, bidirectional radius match, sealed `distanceMiles` and `duration` at creation time.
- `matchFixed(...)` — geo-match (radius 0.5 mi) preferred over string-match against `fixed_routes[].dest_coords`; supports `is_minimum`, `town_override`.
- Routing: Google Routes API v2 (with cache) → OSRM fallback → Haversine × 1.25 last resort.
- Pricing rules engine (in this exact order): override → fixed match (flat or minimum) → SV ↔ Haverstraw DMV (10.1 mi cutoff: $25/$30) → SV local <2 mi ($7) → mileage × `town_mile_rates` with `closestFavorite()` rounding → minimum floor (`sv_town_minimums` if SV involved, else `generic_town_minimums`) → unfriendly-number nudges ($11→$10, $21→$20) → East-side toll surcharge (+$10) → Manhattan flat ($150) → Bronx floor ($120) → round-to-5 above $120.

### 1.2 Configuration sources

- `src/config/fixed_prices.json`: 10 `fixed_routes`, `town_mile_rates` (1 entry: Pearl River $2.50/mi), `sv_town_minimums` (25 towns), `generic_town_minimums` (25 towns), Haverstraw DMV constants.
- `src/config/local_pois.json`: 10 POIs with keywords + lat/lng (Food Fair, Key Food, CVS, Walgreens, Stop & Shop, Target Nanuet, Costco Nanuet, DMV, Palisades Center, Palisades hamlet).
- `PriceOverride` table in Supabase (279 rows, ~173 active per `ARCHITECTURE-FINDINGS.md` §1.2 / §3.3).

### 1.3 Consumers (what would break if pricing changes)

- `whatsapp-bot.ts` and `whatsapp.service.ts` — main revenue pipeline. WhatsApp messages → `calculatePriceService(input)` → quote returned to customer.
- `controllers/public.controller.ts` — public quote endpoint consumed by `excellent-app-fe` (`useDriverApi`/`useOwnerApi`).
- `routes/booking.routes.ts` — booking creation re-prices server-side.
- `services/trip.service.ts` — trip pricing on creation.
- `excellent-app-fe` — UI flows for share-a-price and admin overrides.

### 1.4 Known bugs and test coverage

Verified in `ARCHITECTURE-FINDINGS.md` §3.0a/b/c:

- **B1 — `detectTown` and `matchFixed` use `.includes()` without word boundaries** at lines `268-270`, `284-287`, **and `691`**. "450 White Plains Rd, Bronx" returns `White Plains`. Helper `hasWord()` exists at `211-214` but is not applied to those loops. Equipo D mapped **7 ambiguous pairs** (not 2). Fix must also cover hyphens / apostrophes (`hasWord` regex needs `[\s,\-']`).
- **B2 — Nanuet missing from minimums.** `Nanuet` is in the `towns[]` detection list but absent from `sv_town_minimums` and `generic_town_minimums`. Drops to `MIN_PRICE = $8`. Mount Ivy is fine ($25 in SV). Kaser/Hillcrest are not formal NY municipalities — do not auto-add.
- **Tests: zero.** `price-calculator.service.test.ts` does not exist. `geo.utils.test.ts`, `trip.service.test.ts`, `whatsapp.service.test.ts`, `driver-location.service.test.ts` all exist. The single highest-revenue code path has no regression net.

### 1.5 What Drivly Decision D8 already approved

From `schema-unification-plan.md` §3.1 / §4 D8:

```sql
ALTER TABLE fixed_routes ADD COLUMN is_dynamic_enabled BOOLEAN DEFAULT false;
ALTER TABLE fixed_routes ADD COLUMN base_price NUMERIC(8,2);
ALTER TABLE fixed_routes ADD COLUMN rules_config JSONB DEFAULT '{}';
ALTER TABLE fixed_routes ADD COLUMN note TEXT;
ALTER TABLE fixed_routes ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE fixed_routes ADD COLUMN legacy_supabase_id TEXT UNIQUE;
```

Today: every row has `is_dynamic_enabled = false` and behaves like a flat price. The "future engine" is undefined.

### 1.6 The open question

When Drivly builds the new pricing engine on `rules_config`, does it **port** the logic from `price-calculator.service.ts` (refactor to DB-driven) or **rewrite** from scratch?

`ARCHITECTURE-FINDINGS.md` §8.5 #4 explicitly flags this as a contradiction to resolve before Phase 2 of Drivly.

---

## 2. Decision Drivers

1. **Multi-tenancy.** Drivly is multi-company. Town floors, POI overrides, and surcharges must be scoped by `company_id`. The current engine assumes one tenant (Excellent Taxi, Spring Valley-centric).
2. **Zero tests on revenue path.** Any rewrite or port that lands without ≥10 regression cases against captured production fixtures has unbounded risk.
3. **`rules_config` JSONB is the new source of truth** for per-route overrides; `town_minimums` must be a real table (per §8.3b), not JSON in the repo.
4. **Cutover constraint.** WhatsApp bot can only point to one pricing backend at a time. Two sources of truth running simultaneously leak revenue.
5. **Domain knowledge cost.** The semantic surface (Rockland geography, SV-centric rules, NYC tolls, Manhattan flat, Bronx floor, Haverstraw DMV split, "psychological" rounding) is product knowledge accumulated over years. It is **not** in any spec other than the code itself plus `PRICING_LOGIC_REFERENCE.md`.
6. **Time pressure on Drivly Phase 2.** A rewrite from blank slate competes against shipping dispatch, audit log, Stripe ledger, and Supabase Auth.

---

## 3. Options Analyzed

### 3.1 Option A — Port + refactor

Take the existing 1,010 LoC, restructure it into a Drivly package (`packages/pricing` or `apps/api/src/services/pricing/*`), and replace the data sources:

- `fixed_prices.json` → `town_minimums` table + `fixed_routes.rules_config`.
- Hardcoded `EAST_SIDE_TOWNS`, `town_mile_rates`, Haverstraw constants → `pricing_zones` and `company_pricing_config` tables (or scoped JSONB).
- `PriceOverride` (Supabase) → already migrated to `fixed_routes` per `schema-unification-plan.md` §3.3.
- Drizzle, not Prisma.
- Multi-tenancy: every read takes a `company_id` parameter.
- Bugs B1/B2 are fixed **inside the port** as part of the refactor (by definition the port has tests).

**Estimate: 8-12 days of engineering work**

Breakdown (assuming one engineer, no parallelization):

- Day 1-2: Capture production fixtures from CdH (≥30 cases covering the matrix in §3.3 below). Snapshot inputs + outputs from `calculatePriceService()` against today's prod DB. This is also the regression net for **B1/B2 fixes in CdH** (§5).
- Day 2-3: Design tables — `town_minimums(town, company_id, sv_min, generic_min)`, `pricing_zones(company_id, name, members[])`, `company_pricing_config(company_id, hub_town, ppm_default, min_price, ...)`. Migrate JSON to seed SQL.
- Day 4-7: Port functions one-by-one with parity tests. `detectTown` (with `hasWord` everywhere — fix B1 by construction), `matchFixed`, `findMatchingOverride`, `geocode`, `expandGmapsLink`, main `calculatePriceService`. Drizzle queries replace Prisma.
- Day 8-9: Multi-tenancy: thread `company_id` through every signature; add unit tests for two-company isolation.
- Day 10-11: Integration with `apps/api` Fastify routes; wire `rules_config` consumer for `is_dynamic_enabled = true` rows (still no-op until rules schema defined).
- Day 12: Cutover playbook (env flag, WhatsApp bot DNS swap, rollback procedure).

**Range: 8 (best case, fixtures clean) to 12 (worst case, multi-tenancy refactor cascades).**

### 3.2 Option B — Rewrite from zero

Design a new engine: `rules_config` JSONB schema (composable predicates: `if zone in X and distance > Y then price = max(base, mileage * ppm)`); a clean evaluator that walks rule chains; per-tenant configuration tables. Discard the 1,010 LoC.

**Estimate: 18-30 days of engineering work**

Breakdown:

- Day 1-3: Design `rules_config` DSL. Need to express: flat price, mileage-based, minimum, town-floor, zone surcharge, unfriendly-rounding, hub-local cutoff, override priority. Iterate with operations.
- Day 4-5: Same fixture capture as Option A (still required — without it the rewrite has no oracle).
- Day 6-10: Implement evaluator + storage layer + multi-tenancy (greenfield).
- Day 11-15: Re-derive every domain rule from CdH code by reading it (and from operations conversations): SV-Haverstraw 10.1 mi cutoff, SV local <2 mi, Manhattan flat, Bronx floor, East-side toll, `closestFavorite`, $11→$10, etc. Each rule needs a `rules_config` representation and a test.
- Day 16-22: Re-derive `detectTown`'s 7+ disambiguation rules (Newark/EWR + airport, "West New York" exclusion, Palisades Center vs hamlet, JFK/LGA aliases, Rockland-before-East-side priority). This is product knowledge that lives **only** in the current code. Misremembering one rule = wrong quotes against the WhatsApp bot.
- Day 23-26: Geocoding + POI + Google Routes integration + caching (parity with current 5-stage Nominatim fallback).
- Day 27-30: Cutover, divergence dashboard ("CdH said $X, Drivly said $Y"), rollback.

**Range: 18 (with strong design discipline) to 30 (realistic, given the disambiguation rules are hidden in code).**

### 3.3 Test surface both options must cover

This list is the **minimum oracle** for either option. It must be captured as fixtures from production CdH **before** any rewrite or port begins.

| # | Case | Why it matters |
|---|---|---|
| 1 | Spring Valley → Monsey | Hot path, generic minimum, SV-local |
| 2 | Spring Valley → Airmont (with Walmart POI) | `town_override`, `is_minimum`, POI matching |
| 3 | Spring Valley → Haverstraw, dist 9.5 mi | Haverstraw DMV general ($25) |
| 4 | Spring Valley → Stony Point, dist 13 mi | Haverstraw DMV north ($30) |
| 5 | Spring Valley → Nanuet | **B2 bug** — must hit $10/$8 floor, not $8 MIN_PRICE |
| 6 | "450 White Plains Rd, Bronx" → SV | **B1 bug** — must detect Bronx, not White Plains |
| 7 | "West New York, NJ" → Manhattan | `detectTown` NJ exclusion, must not match "New York" |
| 8 | Hyphenated "Hastings-on-Hudson" → SV | Hyphen handling in `hasWord` (East-side toll +$10) |
| 9 | Apostrophe "O'Brien St" address | Apostrophe regex escape |
| 10 | Palisades Center mall → SV | POI override → "West Nyack" town |
| 11 | Palisades hamlet (10964) → SV | Disambiguation from Palisades Center |
| 12 | Newark Liberty Airport → SV | EWR + airport disambiguation |
| 13 | JFK → SV | Airport keyword + East-side toll |
| 14 | Manhattan → SV | Flat $150 rule |
| 15 | Bronx → SV (calculated $80) | Bronx floor $120 |
| 16 | SV → "Palisades, Orangetown" | POI hamlet vs mall |
| 17 | Nyack → Sloatsburg | Cap rule ($50) |
| 18 | Pearl River → SV (mileage) | `town_mile_rates` $2.50 (lowest of two) |
| 19 | SV → SV, dist 1.2 mi | SV local short distance ($7) |
| 20 | SV → unknown small town, dist 6 mi | Mileage × default PPM, MIN_PRICE floor |
| 21 | Quote with admin override active | `findMatchingOverride` short-circuits |
| 22 | Bidirectional override match | Reverse direction radius match |
| 23 | URL with `dirflg=` and `avoid=` | `expandGmapsLink` cleaning |
| 24 | maps.app.goo.gl shortened link | URL expansion + SSRF |
| 25 | Single-pin maps link (place, no dir) | `SingleLocationError` |
| 26 | Coords-only input (no labels) | Reverse-geocode address resolution |
| 27 | Cross-river Yonkers → SV | East-side toll +$10 |
| 28 | Round-to-5 above $120 (e.g., $137 → $135) | `roundToNearest5` only above threshold |
| 29 | Unfriendly $11 → $10 (mileage path only) | `wasLowered` guard prevents double-adjust |
| 30 | NJ cross-border (excluding Newark) | Tested and doesn't accidentally match NY town |

---

## 4. Comparison

| Dimension | Option A — Port | Option B — Rewrite |
|---|---|---|
| Engineering days | 8-12 | 18-30 |
| Bugs B1/B2 fate | Fixed during port (by construction with tests) | Fixed by not reproducing them |
| Domain knowledge risk | Low — code is the spec, port preserves it | **High** — disambiguation rules live in code; rewriting from `PRICING_LOGIC_REFERENCE.md` alone loses ~7 ambiguous pairs and POI nuances |
| Multi-tenancy | Threaded in during port (Day 8-9) | Greenfield (cleaner abstraction, but no faster) |
| Regression risk on revenue | Bounded by fixture parity (≥30 cases) | Bounded by fixture parity (≥30 cases) — same oracle either way |
| `rules_config` DSL design | Deferred — `is_dynamic_enabled = false` for everyone at cutover; DSL designed in Phase 3 | Required upfront; blocks the rewrite |
| Code review surface | Diff against known-good behavior | Whole new system, no diffable baseline |
| Future-flexibility (surge pricing, time-of-day) | Same — both end up consuming `rules_config` for dynamic rows | Same |
| Cutover playbook | Run side-by-side, divergence < 1% on N captured WhatsApp messages, switch | Same — but with bigger divergence to hunt down |

---

## 5. Decision

**Option A — Port + refactor, with bug fixes baked into the port.**

Justification:

1. **The 1,010 LoC is the spec.** `PRICING_LOGIC_REFERENCE.md` covers ~70% of the rules; the remaining ~30% (disambiguation, ordering, edge cases like `wasLowered` guard, Palisades Center vs hamlet, EWR + airport requirement, "West New York, NJ" exclusion) is in the code only. A rewrite re-reads the code anyway, then re-implements it with new bugs. Save the round-trip.
2. **Test fixtures dominate the schedule.** Both options need the same ≥30 captured-production fixtures (§3.3). Once you have them, the port is a parity exercise (8-12 days). The rewrite is a parity exercise **plus** a DSL design exercise (18-30 days). The DSL is not load-bearing for cutover — Drivly can ship with `is_dynamic_enabled = false` everywhere and design the DSL after revenue is stable.
3. **Multi-tenancy is a refactor, not a rewrite.** Threading `company_id` through ~12 functions costs 1-2 days. The hub-centric assumption (Spring Valley) becomes `company_pricing_config.hub_town`. No need to rewrite pricing math to multi-tenant it.
4. **Bugs die in the port.** B1 (`hasWord` everywhere) and B2 (Nanuet floors) get fixed as part of the port with the same fixtures protecting against regression. CdH still gets the in-situ fixes for the pre-cutover window per `ARCHITECTURE-FINDINGS.md` §8.6 Week 1, but they don't need to be ported — they're already in the spec when Drivly's port lands.
5. **Risk asymmetry.** Worst case for Option A is 12 days and a known-shaped system. Worst case for Option B is 30 days and undiscovered rules cause silent revenue leaks for weeks until a customer complains. Given zero tests on the revenue path, the rewrite's tail risk is unbounded.

**Rejection of Option B:** the rewrite has no compensating benefit. It does not enable a faster cutover, does not unlock a feature the port can't deliver, and does not reduce long-term maintenance (both end up with the same `rules_config` consumer in Phase 3). It only buys an aesthetic clean slate at a cost of 10-18 extra days and elevated revenue risk.

---

## 6. Schema Impact

`fixed_routes` (already approved per D8) — **no further changes**:

```sql
-- already in plan
ALTER TABLE fixed_routes ADD COLUMN is_dynamic_enabled BOOLEAN DEFAULT false;
ALTER TABLE fixed_routes ADD COLUMN base_price NUMERIC(8,2);
ALTER TABLE fixed_routes ADD COLUMN rules_config JSONB DEFAULT '{}';
ALTER TABLE fixed_routes ADD COLUMN note TEXT;
ALTER TABLE fixed_routes ADD COLUMN is_active BOOLEAN DEFAULT true;
ALTER TABLE fixed_routes ADD COLUMN legacy_supabase_id TEXT UNIQUE;
```

`rules_config` semantic at cutover: `{}` for all rows. Engine ignores the field. Reserved for Phase 3 dynamic rules (surge, time-of-day). DSL design deferred.

**New tables required by the port** (scope additions to Phase 2):

```sql
CREATE TABLE town_minimums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  town TEXT NOT NULL,
  hub_min NUMERIC(8,2),       -- replaces sv_town_minimums
  generic_min NUMERIC(8,2),   -- replaces generic_town_minimums
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (company_id, town)
);

CREATE INDEX town_minimums_company_idx ON town_minimums(company_id);

CREATE TABLE company_pricing_config (
  company_id UUID PRIMARY KEY REFERENCES companies(id),
  hub_town TEXT NOT NULL,                     -- 'Spring Valley' for Excellent
  hub_local_threshold_miles NUMERIC(5,2) DEFAULT 2.0,
  hub_local_price NUMERIC(8,2) DEFAULT 7.0,
  default_price_per_mile NUMERIC(8,2) DEFAULT 3.0,
  min_price NUMERIC(8,2) DEFAULT 8.0,
  long_distance_threshold_miles NUMERIC(5,2) DEFAULT 8.0,
  manhattan_flat_price NUMERIC(8,2) DEFAULT 150,
  bronx_floor_price NUMERIC(8,2) DEFAULT 120,
  east_side_toll_surcharge NUMERIC(8,2) DEFAULT 10,
  round_to_5_threshold NUMERIC(8,2) DEFAULT 120,
  haverstraw_dmv_limit_miles NUMERIC(5,2) DEFAULT 10.1,
  haverstraw_price_general NUMERIC(8,2) DEFAULT 25,
  haverstraw_price_north NUMERIC(8,2) DEFAULT 30
);

CREATE TABLE pricing_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,                         -- 'east_side', 'rockland', 'nj'
  members TEXT[] NOT NULL,                    -- ['Manhattan', 'Bronx', ...]
  UNIQUE (company_id, name)
);

CREATE TABLE town_mile_rates (
  company_id UUID NOT NULL REFERENCES companies(id),
  town TEXT NOT NULL,
  ppm NUMERIC(8,2) NOT NULL,
  PRIMARY KEY (company_id, town)
);

CREATE TABLE pricing_pois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  keywords TEXT[] NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  town_override TEXT
);
```

Migration of `fixed_prices.json` → these tables runs as part of Phase 2 seed (idempotent SQL), with Excellent Taxi as the first (and only, at cutover) `company_id`.

This satisfies `ARCHITECTURE-FINDINGS.md` §8.3b (single source of truth, no JSON-vs-DB drift during cutover).

---

## 7. Consequences

### Enables

- Drivly Phase 2 has a closed scope: ~8-12 days of pricing port + 1-2 days of multi-tenancy threading + cutover playbook.
- `rules_config` reserved for Phase 3 (dynamic pricing). No upfront DSL design tax.
- B1/B2 bug fixes in CdH (per `ARCHITECTURE-FINDINGS.md` §8.6 Week 1) compose with the port — same fixtures protect both.
- Single source of truth post-cutover (`town_minimums` table). The `fixed_prices.json` file is retired the day Drivly takes over WhatsApp routing.
- Multi-company expansion: a second taxi operator can be onboarded by inserting rows into `company_pricing_config`, `town_minimums`, `pricing_zones`, `pricing_pois` — no code changes.

### Blocks / sequencing

- **Pre-cutover bloqueador (P0):** `packages/backend/test/price-calculator.service.test.ts` must exist with the ≥30 cases from §3.3, captured against current production CdH. **Must land before** the port begins. Without it, neither option is safe. This is the single highest-leverage 2-day investment in the spike's recommendation.
- The port should **not** begin until `schema-unification-plan.md` §3.3 PriceOverride → `fixed_routes` migration is complete. Otherwise the port targets a moving schema.
- Drivly Phase 2 cutover requires: (a) port complete, (b) ≥30 fixtures pass on Drivly with parity to CdH, (c) divergence dashboard runs side-by-side for ≥1 week with <1% diff on real WhatsApp traffic, (d) rollback procedure (env flag flip + DNS).

### Minimum tests required before cutover

- 30 cases from §3.3, captured as fixtures in `apps/api/test/pricing/fixtures/*.json`, with one parity test asserting `Drivly.calculate(input) === CdH.calculate(input)` for each.
- 2-company isolation tests: same input under company A vs company B yields different prices when their `company_pricing_config` differs.
- Migration idempotency test: re-running the `fixed_prices.json` → DB seed produces no row drift.
- SSRF test for `expandGmapsLink` (port the existing allowlist tests if any; otherwise create from scratch as part of the port).
- Integration test: WhatsApp message → quote endpoint → `town_minimums` lookup → response, end-to-end on a test DB.

### Risks accepted

- The port carries forward the imperative shape of the current engine (large `if/else` ladder in `calculatePriceService`). It will not be cleaner architecturally — only better-tested, multi-tenant, and DB-driven. Phase 3 (dynamic rules via `rules_config`) is the opportunity to refactor, once the system is in production and the test net is dense.
- POI keyword matching remains a substring loop; not a trigram or vector match. Acceptable at current POI count (10) and per-tenant scale.
- Google Routes API + Nominatim 5-stage fallback is preserved as-is. ADR-001 already commits to Google Maps as primary.

---

## 8. Review trigger

Re-evaluate this ADR when **any** of the following hold:

- A second company is onboarded and the per-tenant config schema starts feeling cramped (likely Phase 4).
- `rules_config` design lands in Phase 3 and reveals that the ported imperative engine cannot host dynamic rules cleanly.
- The fixture suite catches a regression that requires changing more than 3 functions to fix (signal that the refactor was insufficient).
- Bot WhatsApp throughput exceeds 100 quotes/min sustained and the per-quote DB roundtrips become a bottleneck (then: cache `town_minimums` and `pricing_zones` per company at process start).
