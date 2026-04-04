# Monorepo Structure

## Decision: npm Workspaces Monorepo

We use a single Git repository with **npm workspaces** for all platform components.

**Why monorepo:**
- TypeScript types in `packages/shared` are imported directly — no package publish step, no type drift between API and apps
- A single `npm install` at root resolves all deps; no cross-repo version pinning
- Atomic commits across API + app changes (e.g., adding a new API field + consuming it in the app in one PR)

**Why npm workspaces over Turborepo/Nx:**
- Our package count is small (6 packages) — Turborepo's build caching adds complexity without proportional benefit at this scale
- npm workspaces hoisting is sufficient; we can adopt Turbo later if build times grow

---

## Directory Layout

```
rockland-taxi/
├── README.md
├── package.json              # root — workspaces config, shared dev deps
├── tsconfig.base.json        # base TS config extended by all packages
├── .env.example              # all required env var keys (no values)
├── .env                      # local dev secrets (gitignored)
├── docker-compose.yml        # local Postgres + Redis
├── .eslintrc.json            # root ESLint config
├── .prettierrc               # Prettier config
├── .husky/                   # pre-commit lint + type-check
│
├── apps/
│   ├── api/                  # Node.js + TypeScript + Fastify backend
│   │   ├── src/
│   │   │   ├── routes/       # Fastify route plugins (rides, drivers, riders, payments)
│   │   │   ├── services/     # Business logic (dispatch, fare, payment)
│   │   │   ├── ws/           # WebSocket handlers (driver location, ride events)
│   │   │   ├── jobs/         # BullMQ background jobs
│   │   │   ├── middleware/   # Auth, error handler, rate limit
│   │   │   └── index.ts      # Server entrypoint
│   │   ├── test/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── driver-app/           # React Native (Expo) — driver-facing app
│   │   ├── app/              # Expo Router file-based navigation
│   │   │   ├── (auth)/       # Login / OTP screens
│   │   │   └── (home)/       # Online toggle, active ride, earnings
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/         # API client, location tracking
│   │   ├── app.json          # Expo config
│   │   ├── eas.json          # EAS Build config
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── rider-app/            # React Native (Expo) — rider-facing app
│   │   ├── app/
│   │   │   ├── (auth)/       # Login / OTP screens
│   │   │   └── (home)/       # Request ride, map, ride status, history
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/         # API client, payment (Stripe)
│   │   ├── app.json
│   │   ├── eas.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── admin/                # React + Vite — operator admin dashboard
│       ├── src/
│       │   ├── pages/        # Dashboard, Rides, Drivers, Riders, Reports
│       │   ├── components/
│       │   └── main.tsx
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── shared/               # Shared TypeScript types + utils
│   │   ├── src/
│   │   │   ├── types/        # RideStatus, Driver, Rider, Payment interfaces
│   │   │   ├── constants/    # Fare multipliers, status labels, map defaults
│   │   │   └── utils/        # Haversine distance, fare calculation
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── db/                   # Database layer
│       ├── src/
│       │   ├── schema/       # Drizzle schema (rides, drivers, riders, vehicles, payments)
│       │   ├── migrations/   # Drizzle Kit auto-generated migration files
│       │   └── client.ts     # Drizzle + pg pool setup
│       ├── package.json
│       └── tsconfig.json
│
└── docs/
    ├── adr/
    │   └── 001-tech-stack.md
    ├── er-diagram.md
    ├── external-dependencies.md
    └── repo-structure.md     # this file
```

---

## Root package.json Scripts

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev -w apps/api\" \"npm run dev -w apps/admin\"",
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces --if-present",
    "db:migrate": "npm run migrate -w packages/db",
    "db:generate": "npm run generate -w packages/db",
    "lint": "eslint . --ext .ts,.tsx",
    "type-check": "tsc --noEmit --project tsconfig.base.json"
  }
}
```

---

## Import Conventions

Packages reference each other by workspace name:

```ts
// In apps/api
import { RideStatus, calculateFare } from '@rockland-taxi/shared';
import { db, schema } from '@rockland-taxi/db';

// In apps/rider-app
import { RideStatus } from '@rockland-taxi/shared';
```

All packages are prefixed `@rockland-taxi/*` in their `package.json` names.
