import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock the DB module so tests don't require a live Postgres connection
vi.mock('@rockland-taxi/db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 'ride-uuid',
            riderId: 'rider-uuid',
            status: 'requested',
            pickupLat: 41.09,
            pickupLng: -73.91,
            pickupAddress: '1 Main St, Nyack, NY',
            dropoffLat: 41.11,
            dropoffLng: -74.04,
            dropoffAddress: '100 Spring St, Spring Valley, NY',
            fareEstimate: '9.50',
            distanceKm: 5,
            durationMin: 10,
            requestedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'ride-uuid', status: 'accepted' }]),
        }),
      }),
    }),
    query: {
      rides: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      drivers: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      riders: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      ridersAuth: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
  },
  schema: {
    drivers: { id: 'drivers.id' },
    riders: { id: 'riders.id' },
    ridersAuth: { riderId: 'ridersAuth.riderId', id: 'ridersAuth.id' },
    vehicles: { id: 'vehicles.id' },
    rides: { id: 'rides.id' },
  },
}));

import { buildApp } from '../src/index.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret';
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});

describe('POST /api/v1/rides (unauthenticated)', () => {
  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rides',
      payload: {
        pickupLat: 41.09,
        pickupLng: -73.91,
        pickupAddress: '1 Main St',
        dropoffLat: 41.11,
        dropoffLng: -74.04,
        dropoffAddress: '100 Spring St',
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/auth/driver/register', () => {
  it('returns 201 with a token on valid payload', async () => {
    // Patch the db.insert chain to return a driver
    const { db } = await import('@rockland-taxi/db');
    vi.mocked(db.insert).mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'driver-uuid' }]),
      }),
    } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/driver/register',
      payload: {
        fullName: 'John Driver',
        phone: '8455551234',
        email: 'john@driver.com',
        password: 'securepassword',
        licenseNumber: 'DL-12345',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('token');
  });
});
