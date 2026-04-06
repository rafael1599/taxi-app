import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock Stripe so tests don't need a real API key
vi.mock('stripe', () => {
  const StripeClass = vi.fn().mockImplementation(() => ({}));
  return { default: StripeClass };
});

// Mock the DB module so tests don't require a live Postgres connection
vi.mock('@drivly/db', () => ({
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
    const { db } = await import('@drivly/db');
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

  it('returns 400 on missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/driver/register',
      payload: { email: 'bad@test.com' }, // missing required fields
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/driver/login', () => {
  it('returns 401 with invalid credentials', async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.query.drivers.findFirst).mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/driver/login',
      payload: { email: 'nobody@example.com', password: 'wrongpassword' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 on invalid email format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/driver/login',
      payload: { email: 'not-an-email', password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/auth/rider/register', () => {
  it('returns 201 with a token on valid payload', async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.insert)
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'rider-uuid' }]),
        }),
      } as any)
      .mockReturnValueOnce({
        values: vi.fn().mockResolvedValue(undefined),
      } as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/rider/register',
      payload: {
        fullName: 'Jane Rider',
        phone: '8455559876',
        email: 'jane@rider.com',
        password: 'securepassword',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('token');
  });
});

describe('GET /api/v1/rides (authenticated driver)', () => {
  it('returns 200 with an empty array when no rides exist', async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.query.rides.findMany).mockResolvedValueOnce([]);

    // Sign a driver JWT
    const token = app.jwt.sign({ sub: 'driver-uuid', role: 'driver' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/rides',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('GET /api/v1/rides/:id (IDOR protection)', () => {
  it("returns 403 when rider accesses another rider's ride", async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.query.rides.findFirst).mockResolvedValueOnce({
      id: 'ride-uuid',
      riderId: 'other-rider-uuid',
      driverId: null,
      status: 'requested',
    } as any);

    const token = app.jwt.sign({ sub: 'my-rider-uuid', role: 'rider' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/rides/ride-uuid',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 when rider accesses their own ride', async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.query.rides.findFirst).mockResolvedValueOnce({
      id: 'ride-uuid',
      riderId: 'my-rider-uuid',
      driverId: null,
      status: 'requested',
    } as any);

    const token = app.jwt.sign({ sub: 'my-rider-uuid', role: 'rider' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/rides/ride-uuid',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/v1/rides/estimate', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rides/estimate',
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

  it('returns fare estimate for a rider', async () => {
    const token = app.jwt.sign({ sub: 'my-rider-uuid', role: 'rider' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rides/estimate',
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        pickupLat: 41.09,
        pickupLng: -73.91,
        pickupAddress: '1 Main St',
        dropoffLat: 41.11,
        dropoffLng: -74.04,
        dropoffAddress: '100 Spring St',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('fareEstimate');
    expect(body).toHaveProperty('distanceKm');
    expect(body).toHaveProperty('durationMin');
    expect(Number(body.fareEstimate)).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/rides/me/active', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/rides/me/active' });
    expect(res.statusCode).toBe(401);
  });

  it('returns null when rider has no active ride', async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.query.rides.findFirst).mockResolvedValueOnce(undefined);

    const token = app.jwt.sign({ sub: 'my-rider-uuid', role: 'rider' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/rides/me/active',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });
});

describe('GET /api/v1/rides/me/history', () => {
  it('returns rider trip history', async () => {
    const { db } = await import('@drivly/db');
    vi.mocked(db.query.rides.findMany).mockResolvedValueOnce([
      { id: 'ride-1', status: 'completed', fareFinal: '12.50' } as any,
    ]);

    const token = app.jwt.sign({ sub: 'my-rider-uuid', role: 'rider' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/rides/me/history',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});
