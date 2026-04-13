# Drivly — Taxi Dispatch Platform

## Project Structure

Monorepo with pnpm workspaces:

- `apps/api` — Fastify REST API (port 3000)
- `apps/admin` — React + Vite admin dashboard (port 3001, falls back to 3002+ if busy)
- `apps/driver` — React Native (Expo) driver app
- `apps/rider` — React Native (Expo) rider app
- `packages/db` — Drizzle ORM schema + migrations (PostgreSQL + PostGIS)
- `packages/shared` — Shared constants and types

## Quick Start

### 1. Infrastructure (Docker)

```bash
docker compose up -d
```

- **PostgreSQL + PostGIS**: `localhost:5432` (user: `postgres`, pass: `postgres`, db: `drivly`)
- **Redis**: `localhost:6380` (mapped from container 6379, to avoid conflicts with other projects)

### 2. Database Migration

```bash
pnpm db:migrate
```

Currently uses custom SQL migration script (`packages/db/scripts/migrate.ts`).
**DECISIÓN (2026-04-12): Migrar a Supabase CLI** (`supabase db push`) + Drizzle generate + CI diff check.

### 3. Create First Admin (only needed once, on empty DB)

```bash
curl -X POST http://localhost:3000/api/v1/auth/admin/setup \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Admin","email":"admin@admin.com","password":"admin1234"}'
```

This endpoint is guarded — it only works when zero admins exist.

### 4. Start Dev Servers

```bash
pnpm dev
```

Runs API + Admin concurrently.

## Common Issues

- **Port 5432 conflict**: Another PostgreSQL may be on 5432. Stop it first: `brew services stop postgresql@16` or stop conflicting Docker containers.
- **PostGIS not available**: The DB **must** run from the `postgis/postgis` Docker image. A plain `postgres` image will fail on `CREATE EXTENSION postgis`.
- **Port 3000 in use**: Kill stale processes: `kill $(lsof -ti :3000)`
- **Redis port 6380**: Redis is on 6380 (not default 6379) to avoid conflicts. Update `REDIS_URL` in `.env` accordingly.

## Auth / Login

**DECISIÓN (2026-04-12): Migrar a Supabase Auth completo.**

- Auth actual (legacy, pendiente de migración):
  - Password hashing: SHA-256 con migración on-login a bcrypt (código ya existe)
  - JWT expiry: 7 days
- Auth objetivo (Supabase Auth):
  - OAuth: Google, Apple (login con un tap)
  - Phone OTP: via Twilio (SMS/WhatsApp)
  - Biométrico: huella/Face ID via `expo-local-authentication`, reauth cada 7 días
  - PIN como fallback
  - Supabase maneja: bcrypt, JWT corto + refresh rotation, token storage
- Admin roles: `super_admin`, `dispatcher`, `viewer`, `platform_admin`, `company_admin`

## Environment Variables

Copy `.env.example` to `.env`. Key vars:

- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql://postgres:postgres@localhost:5432/drivly`)
- `REDIS_URL` — Redis connection (default: `redis://localhost:6380`)
- `JWT_SECRET` — Used for JWT signing and password hashing
- `PORT` — API port (default: 3000)

## Scripts

| Command            | Description                 |
| ------------------ | --------------------------- |
| `pnpm dev`         | Start API + Admin dashboard |
| `pnpm db:migrate`  | Run SQL migrations          |
| `pnpm db:generate` | Generate Drizzle schema     |
| `pnpm build`       | Build all workspaces        |
| `pnpm test`        | Run all tests               |
| `pnpm lint`        | ESLint across project       |
| `pnpm type-check`  | TypeScript check            |

## Decisiones arquitectónicas (2026-04-12)

Ver `docs/database-audit-and-plan.md` §11 para detalle completo. Resumen:

- **Auth**: Supabase Auth completo (OAuth + OTP + biométrico/PIN cada 7 días)
- **Real-time**: WebSocket custom + Redis (no Supabase Realtime)
- **Storage**: Híbrido — Supabase Storage (liviano) + Cloudflare R2 (pesado)
- **DB tier**: Supabase Free ahora, Pro antes de launch
- **Migraciones**: Supabase CLI + Drizzle generate + CI diff check
- **ORM**: Unificar en Drizzle (migrar control-de-horas de Prisma)
- **Tabla viajes**: Drivly extiende `Trip` existente (no crear `rides`)
- **Audit log**: Triggers + hash-chain desde el inicio
- **IA y base**: En paralelo

## Skills

Este proyecto usa skills de `.claude/skills/` (symlink a repo central). Para actualizar: `cd .claude/skills && git pull`

### Preferencias de conexion

- Siempre usar **symlink** para conectar skills (nunca git clone dentro del proyecto)
