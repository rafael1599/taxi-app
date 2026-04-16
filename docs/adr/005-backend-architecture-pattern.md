# ADR-005: Backend Architecture Pattern — Modular Monolith

**Date:** 2026-04-15
**Status:** Accepted
**Deciders:** Lead Engineer
**Supersedes:** N/A
**Related:** ADR-001 (tech stack), ADR-002 (pricing engine port+refactor), ADR-003 (target monorepo layout), ADR-004 (branding & naming), `ARCHITECTURE-FINDINGS.md`

---

## 1. Context

### 1.1 Product vision

Drivly is a **multi-tenant SaaS platform for transportation dispatch with AI at its core**. Any company can onboard, set their name and logo, and get a full suite of modern dispatch services: real-time dispatch, intelligent pricing, driver management, rider experience, payments, WhatsApp bot, and analytics — all white-label.

This means multi-tenancy is not a feature — it is the **backbone** of the system. Every query, service, and adapter must operate within an explicit tenant context.

### 1.2 Current state ("Big Ball of Mud")

Two backends exist in production and development:

| Backend | Stack | Lines of service code | Problem |
|---------|-------|-----------------------|---------|
| control-de-horas | Express 5 + Prisma | ~5,244 (24 services) | Monolithic services (trip: 1,033 LoC, pricing: 862 LoC), single-tenant, WhatsApp bot 77KB single file |
| taxi-app/apps/api | Fastify + Drizzle | ~4,019 (15 services) | Business logic coupled to framework, no domain boundaries, inline DB queries in services |

Both follow a **layered architecture** (routes → services → ORM) that is showing strain:

1. **Services too large** — `tripLifecycle.ts` (749 LoC), `price-calculator.service.ts` (862 LoC), `whatsapp-bot.ts` (~77KB). Business rules, DB access, notifications, and framework concerns are interleaved.
2. **No domain boundaries** — pricing logic imports WhatsApp helpers, trip lifecycle sends notifications directly, auth checks are scattered across route handlers.
3. **Framework coupling** — services receive `FastifyRequest`/`Express.Request`, making them untestable without spinning up the full server.
4. **No tenant isolation layer** — `companyId` filtering is ad-hoc per query, not enforced structurally.
5. **Type duplication** — `excellent-app-fe` (Nuxt) manually duplicates `Trip`, `DashboardDriver`, and other types from the backend.

### 1.3 Alternatives considered

| Pattern | Verdict | Reason |
|---------|---------|--------|
| **Microservices** | Rejected | Team of 1-2 engineers. Network tax, operational overhead (service discovery, distributed tracing, deployment coordination) with no scaling benefit at current volume. |
| **Layered monolith (status quo)** | Rejected | Already breaking down. Services will only grow as SaaS features are added (tenant config, billing, onboarding). |
| **Clean / Hexagonal Architecture (full)** | Rejected | Too many ports, adapters, interfaces, and indirection for a small team. Boilerplate overhead without proportional benefit. |
| **CQRS + Event Sourcing** | Rejected | No need to reconstruct state from events or separate read/write models at this scale. |
| **Modular Monolith** | **Accepted** | Right balance: domain isolation without network boundaries. Services are testable without framework. Tenant context is enforced at the domain layer. If a module needs to scale independently later, it can be extracted to a service in hours, not weeks. |

---

## 2. Decision

### 2.1 Architecture pattern: Modular Monolith

The backend is organized as **domain modules** inside workspace packages. The Fastify app (`drivly-api`) is a thin host that wires modules together — it handles HTTP routing, auth middleware, and dependency injection. All business logic lives in `@drivly/core`.

### 2.2 Package structure

```
packages/
  core/            @drivly/core       Domain logic: entities, use cases, ports, events
                                      ZERO framework or ORM dependencies
  db/              @drivly/db         Drizzle schema + repository implementations (ports → Postgres)
  contracts/       @drivly/contracts  Zod schemas shared between frontend and backend
  infra/           @drivly/infra      Adapters: Stripe, WhatsApp, Redis, BullMQ, push notifications
  shared/          @drivly/shared     Pure utilities: phone formatting, geo helpers, constants

apps/
  drivly-api/      Host: Fastify routing + middleware + wiring (consumes core, db, infra)
  drivly-admin/    React + Vite dashboard (replaces CdH frontend + excellent-app-fe)
  drivly-driver/   Expo/RN driver app
  drivly-rider/    Expo/RN rider app
  drivly-bot/      WhatsApp worker (consumes core, infra)
```

### 2.3 Dependency rules

```
contracts ← shared           (contracts may use shared utils)
core      ← contracts, shared (core uses contracts for types, shared for utils)
db        ← core, contracts   (db implements core's repository ports)
infra     ← core, contracts   (infra implements core's adapter ports)
apps/*    ← everything        (apps wire it all together)
```

**Critical rule:** `@drivly/core` must NEVER import from `db`, `infra`, or any `apps/*` package. It defines ports (interfaces); implementations are injected at startup by the host app.

### 2.4 Domain modules inside @drivly/core

```
packages/core/src/
  tenant/
    tenant.context.ts         TenantContext — injected into every use case
    tenant.port.ts            Interface for tenant config resolution
  trips/
    trip.entity.ts            Aggregate root with explicit state machine
    trip.service.ts           Use case orchestration (requestRide, assignDriver, complete)
    trip.repository.ts        Port (interface) for persistence
    trip.events.ts            Domain events (TripRequested, DriverAssigned, TripCompleted)
    trip.errors.ts            Typed domain errors
  dispatch/
    dispatch.service.ts       Geospatial driver search, offer strategies
    dispatch.strategy.ts      Strategy interface (nearest, round-robin, AI-ranked)
  pricing/
    pricing.service.ts        Fare calculation engine, rule evaluation
    pricing.types.ts          FareBreakdown, PricingRule, ZoneMinimum
  billing/
    billing.service.ts        Stripe Connect orchestration, commissions
    billing.port.ts           Payment provider port
    payout.service.ts         Driver payouts
  fleet/
    driver.entity.ts          Driver + Vehicle + availability status
    company.entity.ts         Tenant/company configuration
    company.repository.ts     Port
  riders/
    rider.entity.ts           Rider profile, payment methods
    rider.repository.ts       Port
  auth/
    auth.service.ts           Login, OTP, token rotation
    roles.ts                  RBAC rules per tenant
  notifications/
    notification.port.ts      Interface: send(channel, recipient, template, data)
    templates.ts              Typed notification templates
  hours/
    time-entry.entity.ts      Employee hours tracking (ex control-de-horas)
    time-entry.service.ts     Clock in/out, overtime calculation
  cache/
    cache.port.ts             Interface for caching (replaces geocoding_cache.json)
```

### 2.5 Tenant context — the backbone

Every use case receives a `TenantContext` as its first argument or via constructor injection. This is not optional.

```typescript
// packages/core/src/tenant/tenant.context.ts
export interface TenantContext {
  tenantId: string;       // company UUID
  tenantName: string;     // for logging/audit
  config: TenantConfig;   // pricing rules, features, branding
}

// Usage in any service:
export class TripService {
  constructor(
    private trips: TripRepository,
    private dispatch: DispatchService,
    private pricing: PricingService,
    private notify: NotificationPort,
  ) {}

  async requestRide(ctx: TenantContext, cmd: RequestRideCommand): Promise<Trip> {
    const fare = this.pricing.calculate(ctx, cmd.pickup, cmd.dropoff);
    const trip = Trip.create({ ...cmd, fare, tenantId: ctx.tenantId });
    await this.trips.save(trip);
    await this.dispatch.findDriver(ctx, trip);
    return trip;
  }
}
```

In the Fastify host, `TenantContext` is extracted from the JWT (`companyId`) and injected via a preHandler. Platform admins can override via `X-Company-Id` header (already exists in taxi-app).

### 2.6 Trip as explicit state machine

The Trip entity protects its own state transitions. Invalid transitions throw domain errors instead of silently corrupting data.

```typescript
// packages/core/src/trips/trip.entity.ts
export type TripStatus =
  | 'requested' | 'searching' | 'offered' | 'accepted'
  | 'driver_arriving' | 'in_progress' | 'completed'
  | 'cancelled' | 'no_driver';

const VALID_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  requested:       ['searching', 'cancelled'],
  searching:       ['offered', 'no_driver', 'cancelled'],
  offered:         ['accepted', 'searching', 'cancelled'],
  accepted:        ['driver_arriving', 'cancelled'],
  driver_arriving: ['in_progress', 'cancelled'],
  in_progress:     ['completed', 'cancelled'],
  completed:       [],
  cancelled:       [],
  no_driver:       ['searching', 'cancelled'],
};

export class Trip {
  // State only changes through explicit methods
  accept(driverId: string): void {
    this.transition('accepted');
    this.driverId = driverId;
    this.addEvent(new DriverAssignedEvent(this.id, driverId, this.tenantId));
  }

  private transition(to: TripStatus): void {
    if (!VALID_TRANSITIONS[this.status].includes(to)) {
      throw new InvalidTransitionError(this.id, this.status, to);
    }
    this.status = to;
  }
}
```

### 2.7 Domain events for side effects

Side effects (notifications, audit log, metrics, billing) are decoupled from the main flow via domain events. Events are dispatched in-process (not via a message broker — that's premature).

| Action | Event emitted | Side effects |
|--------|--------------|--------------|
| `requestRide()` | `TripRequested` | Notify nearby drivers (geo-dispatch) |
| `assignDriver()` | `DriverAssigned` | WhatsApp to rider + audit log |
| `completeTrip()` | `TripCompleted` | Process payment in Stripe + calculate commission + metrics |
| `cancelTrip()` | `TripCancelled` | Notify affected party + release driver availability |

Event subscribers live in `@drivly/infra` (they need access to adapters). The host app registers them at startup.

### 2.8 WhatsApp: dual adapter pattern

The 77KB WhatsApp monolith is split into two roles:

- **Primary adapter (input):** `drivly-bot` app receives messages, parses intent, and calls use cases in `@drivly/core` (e.g., `TripService.requestFromChat`).
- **Secondary adapter (output):** A subscriber in `@drivly/infra` listens for domain events and uses `whatsapp.adapter.ts` to send responses.

The bot never contains business logic. It translates chat ↔ domain commands.

### 2.9 Legacy frontend replacement

Legacy frontends are **not absorbed** into the monorepo. They are replaced.

| Legacy | Replacement | Strategy |
|--------|-------------|----------|
| `control-de-horas/packages/frontend/` (React) | `drivly-admin` | Feature-by-feature. Legacy stays in prod until each view is covered. |
| `excellent-app-fe/` (Nuxt) | `drivly-admin` (owner view) | Same. Owner dashboard becomes a role-based view in drivly-admin. |
| `whatsapp-bot.ts` (77KB monolith) | `drivly-bot` (separate app) | Port domain logic to core, rewrite adapter layer. |

Backend domain logic (pricing, trips, dispatch, auth, hours) **is ported** to `@drivly/core`. The services are valuable; the frontends are not.

### 2.10 Caching strategy

Replace file-based caches (`geocoding_cache.json`, `route_cache.json`) with a `CachePort` in core, implemented with Redis + TTL in infra.

```typescript
// packages/core/src/cache/cache.port.ts
export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  invalidate(key: string): Promise<void>;
}
```

Default TTL for geocoding: 24-48 hours. Routes change; infinite caches produce stale data.

---

## 3. Migration strategy (Mikado Method)

Do not move everything at once. Each phase produces a working system.

| Phase | Component | Technical action | Result |
|-------|-----------|-----------------|--------|
| 0 | `@drivly/contracts` | Extract Zod schemas from route files to shared package | FE-BE type sync. No more copy-paste. |
| 1 | Pricing in `@drivly/core` | Extract `PricingService` as pure domain logic, zero DB deps | Testable with 50+ fixture scenarios in milliseconds. Unblocks ADR-002 P0. |
| 2 | Trip state machine in `@drivly/core` | Implement `Trip` entity with explicit transitions | Eliminates invalid state bugs by design. |
| 3 | Repository ports + `@drivly/db` impls | Extract Drizzle queries from services into repository classes | Services dictate *what*, repos handle *how*. |
| 4 | `@drivly/infra` adapters | Extract Stripe, WhatsApp, Redis, push notification adapters | Side effects decoupled from domain. |
| 5 | `TenantContext` threading | Add tenant context to every use case, enforce in preHandler | Multi-tenant isolation guaranteed at domain level. |
| 6 | `drivly-bot` extraction | Split WhatsApp monolith into input adapter + event subscribers | Bot is a thin app, not a 77KB god file. |

Phases 0-2 align with Sprint 1 (Lane A). Phases 3-6 are Sprint 2+.

---

## 4. Consequences

### What improves
- **Testability:** Core domain logic is testable without framework, DB, or external services.
- **Tenant isolation:** Enforced structurally via `TenantContext`, not ad-hoc per query.
- **Trip reliability:** State machine prevents invalid transitions at compile time + runtime.
- **Onboarding new devs:** Clear boundaries — "pricing logic is in `packages/core/src/pricing/`, Stripe integration is in `packages/infra/src/stripe/`".
- **Future extraction:** Any module can become a microservice by replacing in-process calls with HTTP/gRPC. The ports are already defined.

### What changes
- Services no longer receive framework request objects. They receive typed commands + `TenantContext`.
- DB queries move from services to repository implementations in `@drivly/db`.
- Side effects (notifications, audit, metrics) move from inline calls to event subscribers.
- New code goes into `packages/core/`, `packages/db/`, or `packages/infra/` — not into `apps/drivly-api/src/services/`.

### What could break
- **Migration overlap:** During the transition, some services will live in both the old location and `@drivly/core`. Requires discipline to not duplicate logic.
- **Event ordering:** In-process event dispatch is synchronous by default. If a subscriber throws, it can break the main flow. Mitigation: catch + log in event dispatcher, critical events get retry via BullMQ.

### What is NOT changed by this ADR
- **ORM choice:** Drizzle stays (ADR-001).
- **Auth strategy:** Supabase Auth stays (ADR-001, taxi-app/CLAUDE.md).
- **Pricing approach:** Port + refactor stays (ADR-002).
- **Monorepo layout:** `apps/` + `packages/` stays (ADR-003). This ADR adds `core/` and `infra/` to the packages list.
- **Deploy target:** DigitalOcean App Platform stays.
- **Mobile apps:** Expo/RN stays. White-label mobile strategy is a future product decision, not an architecture one.

---

## 5. Review triggers

Re-evaluate this ADR if:

- Team grows beyond 4 engineers and module boundaries cause merge conflicts → consider extracting to separate repos or microservices.
- A single module's load dominates (e.g., dispatch needs 10x the compute of everything else) → extract that module to a dedicated service.
- Event volume exceeds what in-process dispatch can handle → introduce a message broker (Redis Streams, BullMQ) for async domain events.
- Multi-region deployment is needed → the monolith must be stateless (already is with Redis sessions), but tenant routing adds complexity.
