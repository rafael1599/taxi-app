import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';

// Singleton Redis client for the API
let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: true,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
    });

    client.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    client.on('connect', () => {
      console.log('[Redis] Connected');
    });
  }
  return client;
}

// Create a duplicate connection for BullMQ (it needs separate connections)
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

// ── Redis Key Helpers ────────────────────────────────────────────────────────

export const REDIS_KEYS = {
  // Driver availability: track online drivers per company
  driverOnline: (companyId: string, driverId: string) => `driver:online:${companyId}:${driverId}`,
  driverOnlineSet: (companyId: string) => `drivers:online:${companyId}`,

  // Pending trip offers
  tripOffer: (offerId: string) => `trip:offer:${offerId}`,
  tripSearch: (rideId: string) => `trip:search:${rideId}`,

  // Active trips per driver
  activeTrip: (driverId: string) => `driver:trip:${driverId}`,

  // WhatsApp pending bookings
  waBooking: (senderJid: string) => `wa:booking:${senderJid}`,

  // Rate limiting
  rateLimit: (key: string) => `rl:${key}`,

  // Metrics counters
  metricActiveTrips: (companyId: string) => `metric:active_trips:${companyId}`,
  metricOnlineDrivers: (companyId: string) => `metric:online_drivers:${companyId}`,
} as const;
