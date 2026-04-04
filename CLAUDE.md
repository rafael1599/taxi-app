# Taxi App (Rockland Taxi)

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

- **PostgreSQL + PostGIS**: `localhost:5432` (user: `postgres`, pass: `postgres`, db: `rockland_taxi`)
- **Redis**: `localhost:6380` (mapped from container 6379, to avoid conflicts with other projects)

### 2. Database Migration

```bash
pnpm db:migrate
```

Uses custom SQL migration script (`packages/db/scripts/migrate.ts`), NOT drizzle-kit.

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

- Admin login: `POST /api/v1/auth/admin/login` — email + password (min 8 chars)
- Driver login: `POST /api/v1/auth/driver/login`
- Rider login: `POST /api/v1/auth/rider/login`
- Password hashing: SHA-256 with JWT_SECRET as salt
- JWT expiry: 7 days
- Admin roles: `super_admin`, `dispatcher`, `viewer`

## Environment Variables

Copy `.env.example` to `.env`. Key vars:

- `DATABASE_URL` — PostgreSQL connection string (default: `postgresql://postgres:postgres@localhost:5432/rockland_taxi`)
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

## Skills

Este proyecto usa skills de `.claude/skills/` (symlink a repo central). Para actualizar: `cd .claude/skills && git pull`

### Preferencias de conexion

- Siempre usar **symlink** para conectar skills (nunca git clone dentro del proyecto)
