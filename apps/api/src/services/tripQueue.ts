import { Queue, Worker, Job } from 'bullmq';
import { getRedis, createRedisConnection } from './redis.js';

// ── Job Types ────────────────────────────────────────────────────────────────

export interface OfferTimeoutJob {
  type: 'offer_timeout';
  offerId: string;
  rideId: string;
  driverId: string;
  companyId: string;
  pickupLat: number;
  pickupLng: number;
}

export interface SearchTimeoutJob {
  type: 'search_timeout';
  rideId: string;
}

export type TripJobData = OfferTimeoutJob | SearchTimeoutJob;

// ── Queue ────────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'trip-dispatch';

let queue: Queue<TripJobData> | null = null;
let worker: Worker<TripJobData> | null = null;

export function getTripQueue(): Queue<TripJobData> {
  if (!queue) {
    queue = new Queue<TripJobData>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
        attempts: 1, // timeouts should not retry
      },
    });
  }
  return queue;
}

// ── Schedule Jobs ────────────────────────────────────────────────────────────

export async function scheduleOfferTimeout(
  offerId: string,
  rideId: string,
  driverId: string,
  companyId: string,
  pickupLat: number,
  pickupLng: number,
  delaySec: number,
): Promise<void> {
  const q = getTripQueue();
  await q.add(
    'offer_timeout',
    {
      type: 'offer_timeout',
      offerId,
      rideId,
      driverId,
      companyId,
      pickupLat,
      pickupLng,
    },
    {
      delay: delaySec * 1000,
      jobId: `offer-timeout:${offerId}`,
    },
  );
}

export async function scheduleSearchTimeout(rideId: string, delaySec: number): Promise<void> {
  const q = getTripQueue();
  await q.add(
    'search_timeout',
    {
      type: 'search_timeout',
      rideId,
    },
    {
      delay: delaySec * 1000,
      jobId: `search-timeout:${rideId}`,
    },
  );
}

export async function cancelOfferTimeout(offerId: string): Promise<void> {
  const q = getTripQueue();
  const job = await q.getJob(`offer-timeout:${offerId}`);
  if (job) {
    await job.remove().catch(() => {
      // job may have already been processed
    });
  }
}

export async function cancelSearchTimeout(rideId: string): Promise<void> {
  const q = getTripQueue();
  const job = await q.getJob(`search-timeout:${rideId}`);
  if (job) {
    await job.remove().catch(() => {
      // job may have already been processed
    });
  }
}

// ── Worker ───────────────────────────────────────────────────────────────────

// The processor is set lazily to avoid circular imports.
// Call initTripWorker() from index.ts after all services are loaded.

type JobProcessor = (job: Job<TripJobData>) => Promise<void>;

let processorFn: JobProcessor | null = null;

export function setTripJobProcessor(fn: JobProcessor): void {
  processorFn = fn;
}

export function initTripWorker(): Worker<TripJobData> {
  if (worker) return worker;

  const connection = createRedisConnection();

  worker = new Worker<TripJobData>(
    QUEUE_NAME,
    async (job) => {
      if (!processorFn) {
        throw new Error('Trip job processor not set — call setTripJobProcessor() first');
      }
      await processorFn(job);
    },
    {
      connection,
      concurrency: 10,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[TripQueue] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[TripQueue] Worker error:', err.message);
  });

  console.log('[TripQueue] Worker started');
  return worker;
}

// ── Maintenance Queue (stale driver detection) ──────────────────────────────

const MAINT_QUEUE_NAME = 'driver-maintenance';
let maintQueue: Queue | null = null;
let maintWorker: Worker | null = null;

export function initMaintenanceWorker(): void {
  if (maintWorker) return;

  const connection = createRedisConnection();

  maintQueue = new Queue(MAINT_QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  // Add repeating job: run every 30 seconds
  maintQueue
    .add(
      'stale_check',
      {},
      {
        repeat: { every: 30_000 },
        jobId: 'stale-driver-check',
      },
    )
    .catch(console.error);

  maintWorker = new Worker(
    MAINT_QUEUE_NAME,
    async () => {
      // Lazy import to avoid circular deps
      const { markStaleDriversOffline } = await import('./dispatch.js');
      await markStaleDriversOffline();
    },
    { connection, concurrency: 1 },
  );

  maintWorker.on('error', (err) => {
    console.error('[Maintenance] Worker error:', err.message);
  });

  console.log('[Maintenance] Stale driver check worker started (every 30s)');
}

export async function closeTripQueue(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (maintWorker) {
    await maintWorker.close();
    maintWorker = null;
  }
  if (maintQueue) {
    await maintQueue.close();
    maintQueue = null;
  }
}
