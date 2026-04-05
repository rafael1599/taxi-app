import { db, schema } from '@rockland-taxi/db';
import { eq, and, sql, gte } from 'drizzle-orm';

const ROLLING_WINDOW_DAYS = 7;
const CANCELLATION_THRESHOLD = 0.3; // 30% cancellation rate
const PENALTY_TIMEOUT_MIN = 15; // 15 minutes offline penalty

export type MetricEvent = 'cancellation' | 'completion' | 'timeout' | 'rejection';

/** Record a driver performance event */
export async function recordDriverEvent(
  driverId: string,
  companyId: string,
  eventType: MetricEvent,
  rideId?: string,
): Promise<void> {
  await db.insert(schema.driverMetrics).values({
    driverId,
    companyId,
    eventType,
    rideId: rideId ?? null,
  });
}

/** Get driver cancellation rate (rolling 7-day window) */
export async function getDriverCancellationRate(
  driverId: string,
): Promise<{ cancellations: number; completions: number; rate: number }> {
  const windowStart = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const result = await db
    .select({
      cancellations: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} = 'cancellation')::int`,
      completions: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} = 'completion')::int`,
      total: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} IN ('cancellation', 'completion'))::int`,
    })
    .from(schema.driverMetrics)
    .where(
      and(
        eq(schema.driverMetrics.driverId, driverId),
        gte(schema.driverMetrics.createdAt, windowStart),
      ),
    );

  const { cancellations, completions, total } = result[0];
  const rate = total > 0 ? cancellations / total : 0;

  return { cancellations, completions, rate };
}

/** Check if driver should be penalized for high cancellation rate */
export async function shouldPenalizeDriver(driverId: string): Promise<boolean> {
  const { rate, cancellations } = await getDriverCancellationRate(driverId);
  // Only penalize if they have enough data points and rate exceeds threshold
  return cancellations >= 3 && rate > CANCELLATION_THRESHOLD;
}

/** Apply timeout penalty — set driver offline for PENALTY_TIMEOUT_MIN */
export async function applyTimeoutPenalty(
  driverId: string,
  companyId: string,
): Promise<{ penalized: boolean; timeoutUntil?: Date }> {
  const shouldPenalize = await shouldPenalizeDriver(driverId);
  if (!shouldPenalize) return { penalized: false };

  const timeoutUntil = new Date(Date.now() + PENALTY_TIMEOUT_MIN * 60 * 1000);

  await db
    .update(schema.drivers)
    .set({
      status: 'offline',
      isAvailable: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));

  console.log(
    `[DriverMetrics] Driver ${driverId} penalized (offline until ${timeoutUntil.toISOString()})`,
  );

  return { penalized: true, timeoutUntil };
}

/** Get performance summary for admin dashboard */
export async function getDriverPerformanceSummary(driverId: string, companyId: string) {
  const windowStart = new Date(Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const result = await db
    .select({
      cancellations: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} = 'cancellation')::int`,
      completions: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} = 'completion')::int`,
      timeouts: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} = 'timeout')::int`,
      rejections: sql<number>`COUNT(*) FILTER (WHERE ${schema.driverMetrics.eventType} = 'rejection')::int`,
    })
    .from(schema.driverMetrics)
    .where(
      and(
        eq(schema.driverMetrics.driverId, driverId),
        eq(schema.driverMetrics.companyId, companyId),
        gte(schema.driverMetrics.createdAt, windowStart),
      ),
    );

  const stats = result[0];
  const total = stats.cancellations + stats.completions;
  const cancellationRate = total > 0 ? stats.cancellations / total : 0;

  return {
    windowDays: ROLLING_WINDOW_DAYS,
    ...stats,
    cancellationRate: Math.round(cancellationRate * 100) / 100,
    penaltyThreshold: CANCELLATION_THRESHOLD,
    atRisk: cancellationRate > CANCELLATION_THRESHOLD,
  };
}
