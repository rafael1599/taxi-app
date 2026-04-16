# ADR-003: Target Monorepo Architecture

**Date:** 2026-04-15
**Status:** Proposed
**Deciders:** Lead Engineer
**Supersedes:** N/A
**Related:** ADR-001 (tech stack), ADR-002 (pricing engine strategy), ADR-005 (backend architecture pattern — modular monolith), `ARCHITECTURE.md`, `ARCHITECTURE-FINDINGS.md` (full audit), `schema-unification-plan.md`, `database-audit-and-plan.md`

---

## 1. Context

### 1.1 Current state

The Drivly workspace (`drivly/`) contains three sub-projects that evolved independently and were unified under a single pnpm workspace on 2026-04-14:

```
drivly/                          <-- pnpm workspace root
  taxi-app/                      <-- Drivly core (in development)
    apps/api/                    <-- Fastify REST API
    apps/admin/                  <-- React + Vite dashboard
    apps/driver/                 <-- React Native (Expo)
    apps/rider/                  <-- React Native (Expo)
    packages/db/                 <-- @drivly/db (Drizzle)
    packages/shared/             <-- @drivly/shared
  control-de-horas/              <-- Hours/scheduling system (production)
    packages/backend/            <-- Express 5 + Prisma
    packages/frontend/           <-- React 18 + Vite
  excellent-app-fe/              <-- Nuxt owner dashboard (production, NOT in workspace)
```

`pnpm-workspace.yaml` declares:
- `taxi-app/apps/*`
- `taxi-app/packages/*`
- `control-de-horas/packages/*`

`excellent-app-fe/` is **not** in the workspace. It consumes the control-de-horas API (`/api/v1/trips`, `/api/v1/dashboard`, `/api/v1/auth/*`) but has no shared types -- types are duplicated manually.

### 1.2 Problems with the current structure

1. **Naming confusion.** `taxi-app/apps/api` vs `control-de-horas/packages/backend` -- neither name communicates what it is in the context of the unified platform. Package names (`@drivly/api`, `@control-de-horas/backend`) belong to different scopes.

2. **Nested monorepo paths.** Workspace globs are `taxi-app/apps/*` and `control-de-horas/packages/*` -- two levels deep. The `.bak`-renamed sub-workspace files are a footgun; reactivating one breaks all `workspace:*` resolution (documented in `ARCHITECTURE.md` gotchas).

3. **No shared contracts.** `excellent-app-fe` duplicates types from the backend. `control-de-horas/packages/frontend` consumes types via Prisma-generated types. Neither shares a contract layer with Drivly.

4. **Deploy fragmentation.** control-de-horas deploys via PM2 on a DigitalOcean droplet. Drivly has no production pipeline yet. `excellent-app-fe` has its own pipeline. Three different deploy strategies for one platform.

5. **No CI for the workspace.** Scripts exist (`pnpm build`, `pnpm test`) but there is no GitHub Actions workflow. Changes to `@drivly/db` can break `@control-de-horas/backend` without detection.

6. **WhatsApp bot coupled to backend.** `whatsapp-bot.ts` (~77KB) runs as a separate PM2 process but shares `node_modules` and services with `@control-de-horas/backend`. Extracting it requires a workspace-level decision.

7. **Symlinks don't survive deploy.** `@control-de-horas/backend` depends on `@drivly/db` via `workspace:*`. When the backend is deployed to the droplet via tarball/rsync, the symlink breaks. `pnpm deploy --filter` is not yet in the pipeline (see `ARCHITECTURE-FINDINGS.md` finding #4).

### 1.3 Why now

- Drivly is entering Phase 2 (financial layer, Stripe, audit log) and needs a stable CI/CD foundation.
- The Prisma-to-Drizzle migration in control-de-horas (Phase 2) requires `@drivly/db` in runtime -- the symlink problem becomes a blocker.
- ADR-001 chose Railway + Vercel for infrastructure; ADR-002 chose pricing port. Both assume a consolidated monorepo layout. The target architecture must be formalized before either lands.
- The rebranding from ConfiTech to Drivly (completed 2026-04-15) is the natural moment to rename packages.

---

## 2. Decision

### 2.1 Target monorepo layout

```
drivly/                              <-- pnpm workspace root
  apps/
    drivly-api/                      <-- Fastify core REST API (ex taxi-app/apps/api)
    drivly-admin/                    <-- React + Vite dashboard (ex taxi-app/apps/admin)
    drivly-driver/                   <-- Expo driver app (ex taxi-app/apps/driver)
    drivly-rider/                    <-- Expo rider app (ex taxi-app/apps/rider)
    drivly-hours-api/                <-- Express 5 backend (ex control-de-horas/packages/backend) — transitional, domain logic migrates to @drivly/core
    drivly-bot/                      <-- WhatsApp worker (ex whatsapp-bot.ts in backend)
  packages/
    core/                            <-- @drivly/core (domain logic: entities, use cases, ports, events) — see ADR-005
    db/                              <-- @drivly/db (Drizzle schema + client factory + repository implementations)
    contracts/                       <-- @drivly/contracts (Zod schemas, API types)
    infra/                           <-- @drivly/infra (adapters: Stripe, WhatsApp, Redis, BullMQ) — see ADR-005
    shared/                          <-- @drivly/shared (utils: phone, geo, logger)
  infra/
    docker/                          <-- Dockerfiles per app
    .do/app.yaml                     <-- DigitalOcean App Platform component specs
  docs/
    adr/                             <-- ADRs (moved from taxi-app/docs/adr)
  package.json                       <-- workspace orchestrator
  pnpm-workspace.yaml
  pnpm-lock.yaml
```

### 2.2 pnpm-workspace.yaml (target)

```yaml
packages:
  - apps/*
  - packages/*

catalog:
  typescript: "~5.8.0"
  zod: "^3.25.0"
  react: "^18.3.0"
  react-dom: "^18.3.0"
  axios: "^1.15.0"
  drizzle-orm: "^0.45.2"
  drizzle-kit: "^0.20.0"
  vitest: "^3.2.0"
```

Catalogs (pnpm 9+) replace manual version pinning for cross-package deps. Each `package.json` uses `catalog:` instead of a version string for these deps.

### 2.3 Package naming

All packages use `@drivly/*` scope:

| Package | name in package.json |
|---------|---------------------|
| `apps/drivly-api` | `@drivly/api` |
| `apps/drivly-admin` | `@drivly/admin` |
| `apps/drivly-driver` | `@drivly/driver` |
| `apps/drivly-rider` | `@drivly/rider` |
| `apps/drivly-hours-api` | `@drivly/hours-api` |
| `apps/drivly-bot` | `@drivly/bot` |
| `packages/core` | `@drivly/core` |
| `packages/db` | `@drivly/db` |
| `packages/contracts` | `@drivly/contracts` |
| `packages/infra` | `@drivly/infra` |
| `packages/shared` | `@drivly/shared` |

### 2.4 @drivly/db entrypoints

Restructured per `ARCHITECTURE-FINDINGS.md` best-practice recommendation:

```
@drivly/db/schema      --> pgTable(...), types, relations. Zero side-effects.
@drivly/db/client      --> factory createDb(connectionString). Each backend instantiates once.
@drivly/db/migrations  --> drizzle-kit artifacts (SQL files)
```

Each backend creates a singleton:

```ts
// apps/drivly-hours-api/src/lib/db.ts
import { createDb } from '@drivly/db/client';
export const db = createDb(process.env.DATABASE_URL!);
```

This eliminates the current shared-singleton pattern that causes pool conflicts during Prisma/Drizzle coexistence.

### 2.5 @drivly/contracts

New package -- single source of truth for API types:

- Zod schemas for every request/response shape.
- Inferred TypeScript types (`z.infer<typeof ...>`).
- Consumed by all apps (frontend and backend). Replaces the duplicated types in `excellent-app-fe/app/types/index.ts` and `control-de-horas/packages/frontend`.
- No runtime dependencies beyond `zod`.

### 2.6 DigitalOcean App Platform (.do/app.yaml)

Target deploy configuration (App Platform replaces the current raw droplet + PM2 setup):

```yaml
# infra/.do/app.yaml
name: drivly
region: nyc
features:
  - buildpack-stack=ubuntu-22

services:
  - name: drivly-api
    source_dir: /apps/drivly-api
    build_command: pnpm deploy --filter=@drivly/api --prod /workspace && cd /workspace && node dist/server.js
    run_command: node dist/server.js
    environment_slug: node-js
    instance_count: 1
    instance_size_slug: professional-xs
    http_port: 3000
    health_check:
      http_path: /health
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        type: SECRET
      - key: REDIS_URL
        scope: RUN_TIME
        type: SECRET
      - key: JWT_SECRET
        scope: RUN_TIME
        type: SECRET

  - name: drivly-hours-api
    source_dir: /apps/drivly-hours-api
    build_command: pnpm deploy --filter=@drivly/hours-api --prod /workspace
    run_command: cd /workspace && node dist/server.js
    environment_slug: node-js
    instance_count: 1
    instance_size_slug: professional-xs
    http_port: 3000
    health_check:
      http_path: /health
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        type: SECRET

  - name: drivly-bot
    source_dir: /apps/drivly-bot
    build_command: pnpm deploy --filter=@drivly/bot --prod /workspace
    run_command: cd /workspace && node dist/whatsapp-bot.js
    environment_slug: node-js
    instance_count: 1
    instance_size_slug: professional-xs
    envs:
      - key: DATABASE_URL
        scope: RUN_TIME
        type: SECRET
      - key: INTERNAL_API_SECRET
        scope: RUN_TIME
        type: SECRET

static_sites:
  - name: drivly-admin
    source_dir: /apps/drivly-admin
    build_command: pnpm --filter=@drivly/admin build
    output_dir: dist
    environment_slug: node-js

databases:
  - name: drivly-db
    engine: PG
    version: "16"
    size: db-s-1vcpu-1gb
    num_nodes: 1
```

Key design choices:
- `pnpm deploy --filter` materializes workspace deps into a self-contained directory, solving the symlink-doesn't-survive-deploy problem.
- Static sites (admin, hours-admin, owner) are served from App Platform CDN -- no more `express.static` in the backend process.
- WhatsApp bot runs as its own service, decoupled from the hours API.
- Supabase remains the managed PostgreSQL provider for the Drivly DB; the `databases` section above is for the hours-api legacy DB. Once Drizzle migration completes, it can be retired.

### 2.7 GitHub Actions CI

Monorepo-aware CI using pnpm filtering and path-based triggers:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.filter.outputs.changes }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            drivly-api:
              - 'apps/drivly-api/**'
              - 'packages/core/**'
              - 'packages/db/**'
              - 'packages/infra/**'
              - 'packages/shared/**'
              - 'packages/contracts/**'
            drivly-admin:
              - 'apps/drivly-admin/**'
              - 'packages/shared/**'
              - 'packages/contracts/**'
            drivly-hours-api:
              - 'apps/drivly-hours-api/**'
              - 'packages/core/**'
              - 'packages/db/**'
              - 'packages/infra/**'
              - 'packages/shared/**'
            drivly-bot:
              - 'apps/drivly-bot/**'
              - 'packages/core/**'
              - 'packages/infra/**'
              - 'packages/db/**'
            drivly-driver:
              - 'apps/drivly-driver/**'
              - 'packages/shared/**'
              - 'packages/contracts/**'
            drivly-rider:
              - 'apps/drivly-rider/**'
              - 'packages/shared/**'
              - 'packages/contracts/**'
            packages-core:
              - 'packages/core/**'
            packages-db:
              - 'packages/db/**'
            packages-contracts:
              - 'packages/contracts/**'
            packages-infra:
              - 'packages/infra/**'

  build-and-test:
    needs: detect-changes
    runs-on: ubuntu-latest
    strategy:
      matrix:
        # Run for every changed package group
        package: ${{ fromJson(needs.detect-changes.outputs.packages) }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter "...@drivly/${{ matrix.package }}" run type-check --if-present
      - run: pnpm --filter "...@drivly/${{ matrix.package }}" run lint --if-present
      - run: pnpm --filter "...@drivly/${{ matrix.package }}" run build --if-present
      - run: pnpm --filter "...@drivly/${{ matrix.package }}" run test --if-present

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --prod --audit-level high

  schema-drift:
    needs: detect-changes
    if: contains(needs.detect-changes.outputs.packages, 'packages-db')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @drivly/db run generate
      - name: Check for uncommitted schema changes
        run: git diff --exit-code packages/db/
```

Design notes:
- `dorny/paths-filter` detects which package groups changed. Each app lists its own source dir plus the packages it depends on.
- The `...@drivly/xxx` filter syntax (pnpm) builds the package **and** all its workspace dependencies, ensuring transitive changes are caught.
- `schema-drift` job runs `drizzle-kit generate` and fails if the output differs from what is committed -- enforces the "no `drizzle-kit push`" rule from `taxi-app/CLAUDE.md`.
- `pnpm audit --prod --audit-level high` blocks PRs with known high/critical vulnerabilities (supply-chain hardening per `ARCHITECTURE-FINDINGS.md` #10).

---

## 3. Migration Phases

### Phase 0 -- Foundation (no production impact)

**Goal:** Create the target directory structure and move files without changing any runtime behavior. Production deploys continue from the old paths until Phase 1.

Steps:

1. Create `apps/` and `packages/` at the workspace root.
2. Move `taxi-app/apps/api/` to `apps/drivly-api/`. Update `package.json` name to `@drivly/api`.
3. Move `taxi-app/apps/admin/` to `apps/drivly-admin/`. Update name to `@drivly/admin`.
4. Move `taxi-app/apps/driver/` to `apps/drivly-driver/`. Update name to `@drivly/driver`.
5. Move `taxi-app/apps/rider/` to `apps/drivly-rider/`. Update name to `@drivly/rider`.
6. Move `taxi-app/packages/db/` to `packages/db/`. Name stays `@drivly/db`.
7. Move `taxi-app/packages/shared/` to `packages/shared/`. Name stays `@drivly/shared`.
8. Create `packages/contracts/` with `package.json` (`@drivly/contracts`), empty initial exports.
9. Create `packages/core/` with `package.json` (`@drivly/core`), empty initial exports. See ADR-005 for internal module structure.
10. Create `packages/infra/` with `package.json` (`@drivly/infra`), empty initial exports. See ADR-005 for adapter structure.
11. Move `taxi-app/docs/` to `docs/` at workspace root.
12. Update `pnpm-workspace.yaml` to `apps/*` + `packages/*` (remove `taxi-app/` and `control-de-horas/` globs).
13. Update all `workspace:*` imports across moved packages.
14. Run `pnpm install --force` from root to regenerate symlinks.
15. Verify `pnpm drivly:dev`, `pnpm drivly:build`, `pnpm drivly:test` all pass.
16. Delete empty `taxi-app/` shell (keep git history via the move).

**Risk:** LOW. Drivly is not in production. No runtime consumers break.

**Precondition:** None. Can start immediately.

### Phase 1 -- Port control-de-horas backend + extract bot (production-critical)

**Goal:** Move `control-de-horas/packages/backend` into the `apps/` layout as a transitional app. Port domain logic to `@drivly/core` incrementally. Extract WhatsApp bot. **Legacy frontends are NOT moved — they are replaced by `drivly-admin` (see Phase 2).**

Steps:

1. Move `control-de-horas/packages/backend/` to `apps/drivly-hours-api/`. Rename package to `@drivly/hours-api`.
2. Extract `whatsapp-bot.ts` and its direct dependencies into `apps/drivly-bot/` (`@drivly/bot`). The bot imports use cases from `@drivly/core` — not from the hours API directly. See ADR-005 §2.8 for dual adapter pattern.
3. Update `pnpm-workspace.yaml` (already done in Phase 0 -- `apps/*` covers the new paths).
4. Update root `package.json` scripts: `cdh:dev` filter changes from `control-de-horas-monorepo` to `@drivly/hours-api`.
5. Update `ecosystem.config.cjs` (PM2) paths to point to `apps/drivly-hours-api/dist/` and `apps/drivly-bot/dist/`.
6. **Add `pnpm deploy --filter=@drivly/hours-api --prod <out>` to the droplet deploy script.** This materializes `@drivly/db` as a real directory in `node_modules/`, solving the symlink problem.
7. Begin porting domain logic from `drivly-hours-api` services to `@drivly/core` modules (pricing → trips → dispatch). See ADR-005 §3 for Mikado order.
8. Test full deploy to staging droplet.
9. Cut over production deploy to the new paths.

**Risk:** MEDIUM. This changes the production deploy pipeline. Mitigated by:
- Staging deploy before production.
- PM2 graceful reload (`pm2 reload`) -- zero-downtime.
- Rollback: revert the deploy script to use old paths + `git revert` the directory moves.

**Precondition:** Phase 0 complete. Staging droplet available for testing.

### Phase 2 -- Replace legacy frontends with drivly-admin

**Goal:** Expand `drivly-admin` to cover all views currently served by `control-de-horas/packages/frontend/` (hours, trips, drivers) and `excellent-app-fe/` (owner dashboard). Legacy frontends stay in production until each view is replaced — feature-by-feature, not big bang.

**Key decision (2026-04-15):** Legacy frontends are **replaced**, not absorbed. Rationale:
- They are UI shells consuming REST APIs — no domain logic worth porting.
- Rebranding (ConfiTech/Excellent Taxi → Drivly white-label) requires new UI anyway.
- Stack divergence (React 18 + Nuxt) means absorbing both drags two frameworks into the monorepo. One `drivly-admin` in React + Vite covers everything.
- The owner dashboard becomes a role-based view within `drivly-admin`, not a separate app.

Steps:

1. Inventory all views in CdH frontend and excellent-app-fe. Map each to a `drivly-admin` route.
2. Build replacement views in `drivly-admin`, consuming `@drivly/contracts` for types and `drivly-api` (or `drivly-hours-api` transitionally) for data.
3. As each view is covered, redirect traffic from legacy frontend to `drivly-admin`.
4. When all views are replaced, decommission `control-de-horas/packages/frontend/` and `excellent-app-fe/`.
5. `drivly-hours-api` continues serving the REST API until its domain logic is fully ported to `@drivly/core` + `drivly-api`. Then it is also decommissioned.

**Risk:** LOW per feature (additive). Total risk is spread across multiple small releases.

**Precondition:** Phase 0 complete. `@drivly/contracts` populated with API types. `drivly-admin` has auth + routing scaffold.

### Phase 3 -- CI/CD and infra

**Goal:** GitHub Actions CI + DigitalOcean App Platform spec.

Steps:

1. Add `.github/workflows/ci.yml` (as specified in section 2.7).
2. Add `infra/.do/app.yaml` (as specified in section 2.6).
3. Add `infra/docker/` with Dockerfiles per service (for local dev and App Platform builds).
4. Migrate `drivly-hours-admin` from `express.static` to App Platform static site.
5. Remove `express.static` serving from `drivly-hours-api`.
6. Enable `strictDepBuilds: true` and `blockExoticSubdeps: true` in `pnpm-workspace.yaml` (supply-chain hardening).

**Risk:** LOW for CI (additive). MEDIUM for App Platform migration (changes where frontend is served). Mitigated by running old droplet in parallel during cutover.

**Precondition:** Phases 0-2 complete (all apps in `apps/` layout).

---

## 4. Consequences

### What gets better

- **Single workspace glob** (`apps/*` + `packages/*`) -- no more nested sub-workspace `.bak` files or two-level-deep paths.
- **Unified `@drivly/*` scope** -- every package has a consistent name. No more `@control-de-horas/backend`.
- **Shared contracts** -- `@drivly/contracts` eliminates type duplication across frontends and backends.
- **Symlinks survive deploy** -- `pnpm deploy --filter` materializes workspace dependencies. The current blocker for Drizzle migration Phase 2 is resolved.
- **CI catches cross-package breakage** -- a change to `@drivly/db` triggers build+test for all consumers.
- **Frontend on CDN** -- `drivly-hours-admin` and `drivly-admin` served from App Platform static hosting instead of `express.static`. Faster loads, independent scaling, edge caching.
- **Bot decoupled** -- `drivly-bot` has its own process with explicit dependencies. Crashes don't take down the hours API.
- **Path-based CI triggers** -- only affected packages build/test on each PR. No full-monorepo rebuilds.
- **pnpm Catalogs** -- shared dependency versions declared once, consumed everywhere.
- **Deploy from one repo** -- App Platform reads one `app.yaml` and deploys all services/static sites atomically.

### What changes

- **All import paths change** for moved packages. Every `workspace:*` reference must be updated. This is mechanical but touches many files.
- **PM2 config paths change** (Phase 1). The droplet deploy script needs updating.
- **CI is new** -- currently there is none. The GitHub Actions workflow is additive.
- **Nuxt deploy pipeline changes** (Phase 2). The `excellent-app-fe` pipeline must build from `apps/drivly-owner/`.
- **`express.static` removed from hours API** (Phase 3). Frontend requests must hit the CDN URL, not the backend.
- **Root scripts change** -- `cdh:dev`, `cdh:build` filter names update to `@drivly/hours-api`.
- **ADR and docs paths change** -- moved from `taxi-app/docs/` to `docs/` at workspace root.

### What could break

- **Production deploy during Phase 1** if `pnpm deploy --filter` output does not match the expected directory structure on the droplet. Mitigated by staging test.
- **WhatsApp bot extraction (Phase 1)** if the 77KB monolithic file has implicit dependencies on the backend's module scope (shared `node_modules`, `require` of relative paths). Mitigated by explicit `workspace:*` dependency + build verification.
- **Git history** -- `git log --follow` tracks renames, but tools that don't support `--follow` will show files as deleted + created. Mitigated by performing moves as `git mv`.

### What is NOT changed by this ADR

- **ORM choice** -- Drizzle stays. Prisma-to-Drizzle migration plan is unchanged.
- **Auth strategy** -- Supabase Auth (per decisions 2026-04-12) is unchanged.
- **Database** -- Supabase PostgreSQL + PostGIS for Drivly; legacy Postgres on droplet for hours-api during transition.
- **Pricing engine** -- ADR-002 (port + refactor) is unchanged. The ported logic lands in `@drivly/core` (see ADR-005).
- **Backend architecture** -- ADR-005 (modular monolith) defines how domain logic, adapters, and repositories are structured inside the packages this ADR creates.
- **Mobile apps** -- Expo managed workflow, EAS builds. Directory moves only.
- **Security layers** -- All 8 security layers documented in `control-de-horas/CLAUDE.md` carry forward into `drivly-hours-api` during transition, then into `@drivly/core` + `drivly-api`.

---

## 5. Review Trigger

Re-evaluate this ADR when any of the following hold:

- A second product line (not taxi dispatch) joins the workspace and the `@drivly/*` naming becomes ambiguous.
- DigitalOcean App Platform limitations force a move to another platform (e.g., Kubernetes, Railway, Fly.io).
- The monorepo exceeds ~30 packages and `dorny/paths-filter` becomes unwieldy -- consider Turborepo or Nx at that point.
- `pnpm deploy --filter` does not handle a new package type (e.g., Expo EAS) and a custom bundling step is needed.
