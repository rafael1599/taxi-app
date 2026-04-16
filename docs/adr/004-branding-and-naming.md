# ADR-004: Branding & Naming Conventions

**Date:** 2026-04-15
**Status:** Proposed
**Deciders:** Lead Engineer
**Related:** ADR-001 (tech stack), `drivly/CLAUDE.md` (workspace conventions), `ARCHITECTURE.md`

---

## 1. Context

The platform was originally developed under the name **ConfiTech** (workspace folder `confi-tec/`). On 2026-04-15 the workspace was renamed to `drivly/`. The firm decision is:

> **Drivly is the single brand. ConfiTech must not appear in code, docs, commits, or domains.**

"Excellent Taxi" is the name of the **first tenant company** on the Drivly platform. It is a legitimate business entity and customer name — references to "Excellent Taxi" in tenant-specific data (company rows, customer-facing copy for that tenant, seed scripts) are **not** branding violations. However, "Excellent Taxi" must not appear in platform-level naming (package names, service identifiers, env var prefixes, infrastructure labels, internal docs that describe the platform itself).

This ADR codifies the naming rules so that every contributor applies them consistently across all three repos.

---

## 2. Decision

### 2.1 Package scope

All workspace packages use the `@drivly/*` scope:

| Package | Name |
|---------|------|
| taxi-app root | `drivly` |
| API | `@drivly/api` |
| Admin dashboard | `@drivly/admin` |
| Driver app | `@drivly/driver` |
| Rider app | `@drivly/rider` |
| DB/ORM | `@drivly/db` |
| Shared utils | `@drivly/shared` |
| Workspace root | `drivly-workspace` |

Legacy packages (`@control-de-horas/*`) keep their current names until they are absorbed into `apps/drivly-hours-*` per `CLAUDE.md`. No new packages may use `@control-de-horas/*`.

### 2.2 Service and app naming

Pattern: `drivly-<function>` (lowercase, hyphenated).

| Service | Identifier |
|---------|-----------|
| Core REST API | `drivly-api` |
| Admin dashboard | `drivly-admin` |
| Driver mobile app | `drivly-driver` |
| Rider mobile app | `drivly-rider` |
| Hours API (ex CdH backend) | `drivly-hours-api` |
| Hours admin (ex CdH frontend) | `drivly-hours-admin` |
| Owner portal (ex excellent-app-fe) | `drivly-owner` |
| WhatsApp bot worker | `drivly-bot` |

PM2 process names, Docker container names, and DigitalOcean App Platform component names must follow this pattern.

### 2.3 Domain and subdomain conventions

| Purpose | Convention | Example |
|---------|-----------|---------|
| Platform API | `api.drivly.com` | `api.drivly.com/v1/trips` |
| Admin dashboard | `admin.drivly.com` | |
| Hours admin | `hours.drivly.com` | |
| Tenant-facing sites | Tenant's own domain | `excellentcarservice.com` (Excellent Taxi's domain, not a Drivly platform name) |

Tenant domains like `excellentcarservice.com` are customer property and stay as-is. They are not platform branding.

### 2.4 Environment variable naming

- Platform env vars: `DRIVLY_*` prefix (e.g., `DRIVLY_JWT_SECRET`, `DRIVLY_DATABASE_URL`).
- No `CONFITECH_*` prefix. No `EXCELLENT_*` prefix for platform-level config.
- Generic vars without a prefix (`DATABASE_URL`, `PORT`, `JWT_SECRET`) are acceptable for single-service deploys but should migrate to `DRIVLY_*` when ambiguity arises in multi-service environments.

### 2.5 Git conventions

- Commit messages: never reference "ConfiTech" or "confi-tec" except in the context of this rename ADR itself.
- Branch names: `drivly/*` prefix for platform work (optional but recommended).
- Repository description / GitHub About: must say "Drivly" not "ConfiTech".

---

## 3. Audit: Remaining "ConfiTech / confi-tec" References

The codebase was searched for all case-insensitive occurrences of `ConfiTech`, `confi-tec`, `confitec`, and `confi_tec`, excluding `node_modules/`, `.git/`, lock files, and procedural rename docs (`RENAME-CHECKLIST.md`, `RESUME-PROMPT.md`).

### 3.1 References found (all in docs, zero in source code)

| # | File | Line(s) | Content | Action |
|---|------|---------|---------|--------|
| 1 | `drivly/ARCHITECTURE.md` | 5 | Historical note: "hasta 2026-04-15 se llamaba `confi-tec/`" | **Keep** — historical context, already qualified as past tense |
| 2 | `drivly/CLAUDE.md` | 42 | "no mencionar ConfiTech en codigo/docs/deploys" | **Keep** — this is the rule itself |
| 3 | `drivly/CLAUDE.md` | 52 | Historical note about rename | **Keep** — historical context |
| 4 | `control-de-horas/packages/backend/docs/drizzle-migration-plan.md` | 61, 66, 70 | Refers to `confi-tec/` as the workspace root in code blocks and prose | **Rename** to `drivly/` — doc is still active reference material |

**Summary: 1 file requires content updates.** No source code, config, or env file contains ConfiTech references.

---

## 4. Audit: "Excellent Taxi" References in Platform-Level Positions

"Excellent Taxi" is the first tenant's business name. References in tenant-specific UI copy, WhatsApp bot messages, and seed data are correct. The following are references where "Excellent Taxi" appears in **platform-level** naming (package names, infrastructure labels, internal tooling, env templates):

### 4.1 excellent-app-fe (repo to be absorbed into `drivly-owner`)

| # | File | Line | Content | Action |
|---|------|------|---------|--------|
| 1 | `package.json` | 2 | `"name": "excellent-taxi-fe"` | **Rename** to `drivly-owner` when absorbed |
| 2 | `CLAUDE.md` | 1 | Title: "Excellent Taxi - Frontend" | **Rename** when absorbed |
| 3 | `.github/workflows/deploy.yml` | 16, 23, 28, 35, 46 | Deploy path: `/var/www/excellent-app-fe` | **Rename** path on droplet when absorbed |

Tenant-facing content (`nuxt.config.ts` SEO meta, Vue components with "Excellent Taxi" branding, app store links) is correct per-tenant copy and must NOT be renamed to Drivly. These stay as customer branding.

### 4.2 control-de-horas

| # | File | Line | Content | Action |
|---|------|------|---------|--------|
| 1 | `docker-compose.yml` | 4 | `container_name: excellent-taxi-db` | **Rename** to `drivly-hours-db` or `cdh-db` |
| 2 | `packages/backend/.env.example` | 2 | Comment: "Backend - Excellent Taxi" | **Rename** to "Backend - Drivly Hours (control-de-horas)" |
| 3 | `packages/backend/.env.example` | 12 | `DATABASE_URL=...excellent_taxi` | **Rename** DB name to `control_horas` or `drivly_hours` |
| 4 | `packages/backend/.env` | 2 | Comment: "Backend - Excellent Taxi" | **Rename** (same as .env.example) |
| 5 | `BACKLOG.md` | 1 | Title: "Backlog — Control de Horas / Excellent Taxi" | **Rename** to "Backlog — Control de Horas (Drivly Hours)" |
| 6 | `README.md` | 3, 36, 45 | "Excellent Taxi Service" as platform name | **Rename** platform references to Drivly |
| 7 | `docs/architecture.md` | 1, 11 | "Excellent Taxi System" | **Rename** to "Control de Horas System" or "Drivly Hours" |
| 8 | `docs/README.md` | 1 | Title with "Excellent Taxi" | **Rename** |
| 9 | `packages/backend/README.md` | 3, 47 | "Excellent Taxi Service" | **Rename** platform refs |
| 10 | `packages/backend/dev-dashboard.mjs` | 17, 66, 214, 259 | Refs to `excellent-app-fe` path and "Excellent Taxi" title | **Rename** |
| 11 | `packages/frontend/index.html` | 7, 8, 11, 14, 17 | `<title>Excellent Taxi - Employee Control</title>` and meta tags | **Rename** to "Drivly Hours" or make tenant-configurable |
| 12 | `packages/frontend/README.md` | 3, 25 | "Excellent Taxi Service" | **Rename** |
| 13 | `packages/frontend/PRICING_LOGIC_REFERENCE.md` | 3 | "Excellent Taxi" | **Rename** to neutral or "Drivly" |
| 14 | `packages/frontend/DEPLOYMENT_GUIDE.md` | 94, 160, 168, 175 | Domain refs and deploy paths | Leave domain refs (tenant); **rename** deploy path refs |
| 15 | `packages/frontend/DECISION_LOG.md` | 92, 94 | Domain `excellentcarservice.com` in CORS context | **Keep** — refers to tenant domain config |
| 16 | `seed-timeentries.js` | 104 | `docker exec -i excellent-taxi-db` | **Rename** after docker-compose container rename |
| 17 | `packages/backend/src/services/price-calculator.service.ts` | 465 | User-Agent: `ExcellentTaxiApp/Unified` | **Rename** to `DrivlyApp/1.0` or similar |

Note: WhatsApp bot messages (`whatsapp-bot.ts`, `whatsapp.service.ts`, `trip.service.ts`, `driver-auth.routes.ts`, `email.service.ts`) that say "Excellent Taxi" to customers are tenant-specific copy. These become multi-tenant configurable in Phase 2 (company name from DB), but are NOT branding violations today.

### 4.3 taxi-app

| # | File | Line | Content | Action |
|---|------|------|---------|--------|
| 1 | `docs/droplet-capacity-analysis.md` | 1, 20, 27, 44, 64, 84, 105 | "Excellent Taxi" as infrastructure label | **Keep** — describes current production state; will become obsolete when Drivly takes over |
| 2 | `docs/droplet-setup-drivly.sh` | 12, 50, 118, 120, 221, 269, 527 | References to Excellent Taxi processes coexisting | **Keep** — operational script for coexistence period |
| 3 | `docs/database-audit-and-plan.md` | 406, 416 | Old path `Projects/excellent-taxi/control-de-horas` | **Rename** path to `Projects/drivly/control-de-horas` |
| 4 | `docs/schema-unification-plan.md` | 14, 334, 462 | "Excellent Taxi" as first tenant | **Keep** — refers to tenant, not platform |
| 5 | `scripts/migrate-supabase-admins.ts` | 6, 78, 90 | Company slug: `excellent-car-service` | **Keep** — tenant data, correct |
| 6 | `packages/db/scripts/migrate-supabase-admins.ts` | 6, 78, 90 | Same as above (duplicate script location) | **Keep** — tenant data |
| 7 | `packages/db/scripts/migrate-supabase-price-overrides.ts` | 6, 56, 59 | Company slug: `excellent-car-service` | **Keep** — tenant data |
| 8 | `packages/db/scripts/migrate-supabase-drivers.ts` | 6, 54, 57 | Company slug: `excellent-car-service` | **Keep** — tenant data |
| 9 | `packages/db/src/migrations/0010_schema_unification_prep.sql` | 4 | Comment: "Safe to run while Excellent Taxi (Supabase)..." | **Keep** — migration comment, historical |
| 10 | `apps/rider/src/screens/RateRideScreen.tsx` | 21 | Star label: `'Excellent'` | **Keep** — English adjective, not brand name |
| 11 | `apps/driver/src/screens/RateRiderScreen.tsx` | 13 | Star label: `'Excellent'` | **Keep** — English adjective, not brand name |

---

## 5. Consolidated Rename Checklist

### Priority 1 — Immediate (no production impact)

These are doc/config updates that can be done in a single commit:

- [ ] `control-de-horas/packages/backend/docs/drizzle-migration-plan.md` — replace `confi-tec/` with `drivly/` (lines 61, 66, 70)
- [ ] `control-de-horas/packages/backend/.env.example` — update comment and DATABASE_URL placeholder
- [ ] `control-de-horas/BACKLOG.md` — update title
- [ ] `control-de-horas/README.md` — replace platform-level "Excellent Taxi" with "Drivly"
- [ ] `control-de-horas/docs/architecture.md` — rename "Excellent Taxi System"
- [ ] `control-de-horas/docs/README.md` — rename title
- [ ] `control-de-horas/packages/backend/README.md` — rename platform refs
- [ ] `control-de-horas/packages/frontend/README.md` — rename platform refs
- [ ] `control-de-horas/packages/frontend/index.html` — rename `<title>` and meta tags
- [ ] `control-de-horas/packages/frontend/PRICING_LOGIC_REFERENCE.md` — rename
- [ ] `taxi-app/docs/database-audit-and-plan.md` — fix old path `excellent-taxi/` to `drivly/`

### Priority 2 — Requires coordination (affects local dev or CI)

- [ ] `control-de-horas/docker-compose.yml` — rename `container_name` from `excellent-taxi-db` (requires all devs to recreate container)
- [ ] `control-de-horas/seed-timeentries.js` — update `docker exec` target name (depends on docker-compose rename)
- [ ] `control-de-horas/packages/backend/.env` — update comment (each dev's local `.env` must also be updated)
- [ ] `control-de-horas/packages/backend/dev-dashboard.mjs` — update paths and titles
- [ ] `control-de-horas/packages/backend/src/services/price-calculator.service.ts` line 465 — rename User-Agent from `ExcellentTaxiApp/Unified` to `DrivlyApp/1.0`

### Priority 3 — Deferred (part of repo absorption)

These happen when `excellent-app-fe` is absorbed into `apps/drivly-owner`:

- [ ] `excellent-app-fe/package.json` — rename from `excellent-taxi-fe` to `@drivly/owner` or `drivly-owner`
- [ ] `excellent-app-fe/CLAUDE.md` — rewrite for Drivly context
- [ ] `excellent-app-fe/.github/workflows/deploy.yml` — update deploy paths

### Not renamed (correct as-is)

- Tenant-facing copy in Vue/Nuxt components ("Excellent Taxi" visible to customers)
- WhatsApp bot customer messages (becomes multi-tenant configurable in Phase 2)
- Migration scripts with company slug `excellent-car-service` (tenant data)
- Star rating labels ("Excellent" as English adjective)
- Historical/operational docs that describe the current production coexistence
- `excellentcarservice.com` domain references (tenant property)

---

## 6. Consequences

### Enables

- Consistent identity across all repos, packages, and infrastructure.
- New contributors immediately understand the platform is "Drivly" without encountering legacy names.
- Multi-tenancy: "Excellent Taxi" is just the first `companies` row, not baked into platform naming.
- Clean `@drivly/*` package namespace for future packages.

### Risks / trade-offs

- Priority 2 renames (docker-compose, local `.env`) require coordinated developer action. A PR description must include migration steps.
- The User-Agent rename in `price-calculator.service.ts` could theoretically affect API rate-limit whitelists at Google or Nominatim if they had been set up with the old string. Verify before deploying.
- `excellent-app-fe` renames are deferred intentionally — renaming a production Nuxt app mid-flight risks deploy breakage. The absorption into `drivly-owner` is the natural cutover point.

### Review trigger

Re-evaluate this ADR when:

- `excellent-app-fe` absorption into `apps/drivly-owner` begins.
- A second tenant company is onboarded and tenant-specific copy needs to come from DB rather than hardcoded strings.
- Domain `drivly.com` (or equivalent) is acquired and subdomains are provisioned.
