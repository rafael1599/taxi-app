import { getRedis, REDIS_KEYS } from './redis.js';

// ── Audit Log Types ──────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  entity: 'ride' | 'driver' | 'offer';
  entityId: string;
  companyId: string;
  action: string;
  fromState?: string | undefined;
  toState?: string | undefined;
  actorType?: 'system' | 'driver' | 'rider' | 'admin' | undefined;
  actorId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

// ── Audit Logger ─────────────────────────────────────────────────────────────

const AUDIT_LIST_KEY = 'audit:log';
const AUDIT_MAX_ENTRIES = 10_000; // keep last 10k entries in Redis

export async function logAudit(entry: Omit<AuditEntry, 'timestamp'>): Promise<void> {
  const redis = getRedis();
  const full: AuditEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  try {
    const pipeline = redis.pipeline();
    pipeline.lpush(AUDIT_LIST_KEY, JSON.stringify(full));
    pipeline.ltrim(AUDIT_LIST_KEY, 0, AUDIT_MAX_ENTRIES - 1);

    // Also push to company-specific list for scoped queries
    const companyKey = `audit:log:${entry.companyId}`;
    pipeline.lpush(companyKey, JSON.stringify(full));
    pipeline.ltrim(companyKey, 0, AUDIT_MAX_ENTRIES - 1);

    await pipeline.exec();
  } catch (err) {
    // Audit logging should never break the main flow
    console.error('[Audit] Failed to log entry:', err);
  }
}

export async function getAuditLog(
  companyId?: string,
  limit = 100,
  offset = 0,
): Promise<AuditEntry[]> {
  const redis = getRedis();
  const key = companyId ? `audit:log:${companyId}` : AUDIT_LIST_KEY;
  const entries = await redis.lrange(key, offset, offset + limit - 1);
  return entries.map((e: string) => JSON.parse(e) as AuditEntry);
}

// ── Convenience helpers ──────────────────────────────────────────────────────

export function logRideTransition(
  rideId: string,
  companyId: string,
  fromStatus: string,
  toStatus: string,
  actorType: AuditEntry['actorType'] = 'system',
  actorId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return logAudit({
    entity: 'ride',
    entityId: rideId,
    companyId,
    action: 'status_change',
    fromState: fromStatus,
    toState: toStatus,
    actorType,
    actorId,
    metadata,
  });
}

export function logDriverTransition(
  driverId: string,
  companyId: string,
  fromStatus: string,
  toStatus: string,
  actorType: AuditEntry['actorType'] = 'system',
  actorId?: string,
): Promise<void> {
  return logAudit({
    entity: 'driver',
    entityId: driverId,
    companyId,
    action: 'status_change',
    fromState: fromStatus,
    toState: toStatus,
    actorType,
    actorId,
  });
}

export function logOfferEvent(
  offerId: string,
  companyId: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  return logAudit({
    entity: 'offer',
    entityId: offerId,
    companyId,
    action,
    metadata,
  });
}
