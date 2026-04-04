# Rockland Taxi — Custom Taxi Platform for Rockland County, NY

A full-stack ride-hailing platform built specifically for the Rockland, NY taxi market.

## Overview

This monorepo contains all components of the Rockland Taxi platform:

| Package | Description |
|---|---|
| `apps/api` | Node.js/TypeScript REST + WebSocket API server |
| `apps/driver-app` | React Native driver app (iOS + Android) |
| `apps/rider-app` | React Native rider app (iOS + Android) |
| `apps/admin` | React web admin dashboard |
| `packages/shared` | Shared TypeScript types, utilities, and constants |
| `packages/db` | Database migrations, seeds, and query helpers |

## Quick Start

```bash
# Install dependencies
npm install

# Start local dev environment (requires Docker)
docker compose up -d       # PostgreSQL + Redis
npm run db:migrate         # Run migrations
npm run dev                # Start all services in watch mode
```

## Documentation

- [ADR-001: Tech Stack Choices](docs/adr/001-tech-stack.md)
- [Data Model / ER Diagram](docs/er-diagram.md)
- [External Dependencies](docs/external-dependencies.md)
- [Monorepo Structure](docs/repo-structure.md)

## Tech Stack

- **Backend**: Node.js 22 + TypeScript + Fastify
- **Mobile**: React Native 0.74 + Expo
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Cache / Queues**: Redis 7
- **Maps**: Google Maps Platform (Directions, Places, Geocoding)
- **Payments**: Stripe
- **Push Notifications**: Expo Push / APNs + FCM
- **Infra**: Railway (API) + Expo EAS (mobile builds) + Vercel (admin)

## Contributing

See [AGENTS.md](AGENTS.md) for agent coding guidelines and conventions.
