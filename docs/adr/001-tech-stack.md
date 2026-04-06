# ADR-001: Tech Stack Choices

**Date:** 2026-04-03
**Status:** Accepted
**Deciders:** Lead Engineer

---

## Context

We are building a custom ride-hailing platform for taxi operators. The platform requires:

- Real-time driver location tracking and dispatch
- Ride lifecycle management (request → match → pickup → dropoff → payment)
- Driver and rider mobile apps (iOS + Android)
- Operator admin dashboard
- Geospatial queries for nearby driver lookup and routing

The team is small; we need high developer velocity, strong ecosystem support, and minimal operational overhead.

---

## Decisions

### Backend: Node.js 22 + TypeScript + Fastify

**Chosen:** Node.js 22 LTS with TypeScript 5, Fastify 4 as the HTTP framework, with native WebSocket support via `@fastify/websocket`.

**Rationale:**

- TypeScript gives full-stack type sharing between API and clients (no type drift)
- Fastify is 2–3× faster than Express in benchmarks; low overhead matters for concurrent WebSocket connections (driver location pings)
- Node.js 22 ships native `fetch`, `WebSocket`, and `crypto` — fewer polyfills
- Large npm ecosystem covers all required integrations (Stripe, Google Maps, etc.)

**Rejected alternatives:**

- _Go_: Faster, but no mobile code sharing; smaller team familiarity
- _Python/FastAPI_: Good for ML workloads, not the best fit for real-time WebSocket-heavy traffic
- _Bun_: Not production-hardened enough yet for 2026 targets

---

### Database: PostgreSQL 16 + PostGIS 3.4

**Chosen:** PostgreSQL with the PostGIS extension for all persistent data.

**Rationale:**

- PostGIS `GEOGRAPHY` type enables efficient `ST_DWithin` queries for "find drivers within X km of rider" with GiST index — critical for dispatch
- ACID transactions ensure payment + ride status updates are atomic
- `pg` + `drizzle-orm` provide type-safe query building with migration support
- PostGIS is battle-tested for geospatial taxi/logistics workloads

**Rejected alternatives:**

- _MongoDB_: No native geospatial joins; schema flexibility not needed here
- _MySQL_: PostGIS ecosystem is stronger on Postgres; no material advantage

---

### Cache / Pub-Sub: Redis 7

**Chosen:** Redis 7 for ephemeral driver location cache and Pub/Sub for ride events.

**Rationale:**

- Driver GPS pings (~5 s interval) must be read fast without hitting Postgres; Redis stores `driverId → {lat, lng, updatedAt}` in-memory
- Redis Pub/Sub powers real-time push to rider WebSocket connections ("driver moved") without polling
- `BullMQ` runs on Redis for background jobs (payment capture, receipt emails)

---

### Mobile: React Native 0.74 + Expo SDK 51

**Chosen:** React Native via Expo managed workflow for both driver and rider apps.

**Rationale:**

- Single codebase for iOS + Android; Expo EAS handles OTA updates and store builds
- `expo-location` provides foreground + background GPS tracking (required for driver)
- `react-native-maps` integrates Google Maps on Android and Apple Maps on iOS
- Expo Push handles cross-platform push notifications without managing APNs/FCM certificates directly
- TypeScript types are shared from `packages/shared` — no API contract drift

**Rejected alternatives:**

- _Flutter_: Dart is not shared with backend; smaller library ecosystem for maps/payments
- _Native iOS + Android_: 2× codebase, too expensive for initial build

---

### Admin Dashboard: React + Vite + shadcn/ui

**Chosen:** React 18, Vite, TailwindCSS, shadcn/ui components. Deployed to Vercel.

**Rationale:**

- Shared TypeScript types from `packages/shared`
- shadcn/ui gives accessible, composable components without runtime overhead
- Vercel zero-config deploys on every push

---

### Infrastructure

**Chosen:**

- **API + DB**: Railway — managed PostgreSQL (PostGIS enabled) + Node.js service; scales horizontally; no K8s overhead for initial launch
- **Redis**: Railway managed Redis
- **Mobile builds**: Expo EAS Build + Submit
- **Admin**: Vercel

**Rejected alternatives:**

- _AWS ECS/RDS_: More control, but too much ops overhead for v1
- _Heroku_: More expensive than Railway for the same resources

---

## Consequences

- All packages use TypeScript — enforced via root `tsconfig.json`
- Monorepo managed with `npm workspaces` (no Turborepo for now — overkill at this scale)
- PostGIS must be enabled on the Railway Postgres instance at provision time
- Background GPS tracking requires `expo-location` background mode entitlement in app store submissions
