import type { FastifyInstance } from 'fastify';
import { supabaseQuery, db, schema } from '@drivly/db';
import { eq } from 'drizzle-orm';
import { requireAdmin, getCompanyId, requireCompanyScope } from '../middleware/auth.js';

/**
 * Legacy data routes — reads from Supabase (Control de Horas DB).
 * All routes require admin auth. Prefix: /api/v1/legacy
 *
 * Phase 2: /legacy/drivers and /legacy/price-overrides now read from LOCAL DB.
 * Phase 3 will migrate: employees, time-entries, stats.
 */
export async function legacyRoutes(app: FastifyInstance) {
  // ── Drivers (MIGRATED to local DB — Phase 2) ──────────────────────────────
  app.get(
    '/legacy/drivers',
    { preHandler: [requireAdmin, requireCompanyScope], schema: { tags: ['Legacy'] } },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const allDrivers = await db
        .select({
          id: schema.drivers.id,
          name: schema.drivers.fullName,
          phone: schema.drivers.phone,
          isActive: schema.drivers.isActive,
          isAvailable: schema.drivers.isAvailable,
          status: schema.drivers.status,
          currentLat: schema.drivers.currentLat,
          currentLng: schema.drivers.currentLng,
          locationAt: schema.drivers.locationAt,
          createdAt: schema.drivers.createdAt,
          updatedAt: schema.drivers.updatedAt,
          legacySupabaseId: schema.drivers.legacySupabaseId,
        })
        .from(schema.drivers)
        .where(eq(schema.drivers.companyId, companyId))
        .orderBy(schema.drivers.fullName);
      return reply.send(allDrivers);
    },
  );

  // ── Trips ──────────────────────────────────────────────────────────────────
  app.get(
    '/legacy/trips',
    { preHandler: requireAdmin, schema: { tags: ['Legacy'] } },
    async (request, reply) => {
      const { limit = '50', offset = '0', status } = request.query as Record<string, string>;
      const params: unknown[] = [Number(limit), Number(offset)];
      let whereClause = '';
      if (status) {
        whereClause = `WHERE t.status = $3`;
        params.push(status);
      }

      const trips = await supabaseQuery(
        `
        SELECT
          t.id, t."clientPhone", t."clientName",
          t."pickupAddress", t."pickupLat", t."pickupLng",
          t."dropoffAddress", t."dropoffLat", t."dropoffLng",
          t.price, t.distance, t."estimatedMinutes",
          t.status, t."createdAt", t."assignedAt", t."completedAt",
          d.name AS "driverName", d.phone AS "driverPhone"
        FROM "Trip" t
        LEFT JOIN "Driver" d ON d.id = t."driverId"
        ${whereClause}
        ORDER BY t."createdAt" DESC
        LIMIT $1 OFFSET $2
      `,
        params,
      );

      const countResult = await supabaseQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM "Trip" ${whereClause}`,
        status ? [status] : [],
      );

      return reply.send({
        trips,
        total: Number(countResult[0]?.count ?? 0),
        limit: Number(limit),
        offset: Number(offset),
      });
    },
  );

  // ── Price Overrides (MIGRATED to local fixed_routes — Phase 2) ──────────────
  app.get(
    '/legacy/price-overrides',
    { preHandler: [requireAdmin, requireCompanyScope], schema: { tags: ['Legacy'] } },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { active } = request.query as Record<string, string>;

      let rows = await db
        .select()
        .from(schema.fixedRoutes)
        .where(eq(schema.fixedRoutes.companyId, companyId))
        .orderBy(schema.fixedRoutes.name);

      if (active === 'true') {
        rows = rows.filter((r) => r.isActive);
      } else if (active === 'false') {
        rows = rows.filter((r) => !r.isActive);
      }

      // Map to legacy API shape for backward compatibility
      const overrides = rows.map((r) => ({
        id: r.id,
        originLabel: r.name?.split(' → ')[0] ?? '',
        destLabel: r.name?.split(' → ')[1] ?? '',
        originLat: r.originLat,
        originLng: r.originLng,
        destLat: r.destLat,
        destLng: r.destLng,
        price: Number(r.fixedPrice),
        radiusMiles: Math.round((r.radiusMeters / 1609.34) * 100) / 100,
        isActive: r.isActive,
        note: r.note,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));

      return reply.send(overrides);
    },
  );

  // ── Employees ──────────────────────────────────────────────────────────────
  app.get(
    '/legacy/employees',
    { preHandler: requireAdmin, schema: { tags: ['Legacy'] } },
    async (_request, reply) => {
      const employees = await supabaseQuery(`
        SELECT
          e.id, e.employee_code AS "employeeCode", e.full_name AS "fullName",
          e.hourly_rate AS "hourlyRate", e."isActive",
          e."createdAt", e."updatedAt",
          u.email, u.role
        FROM "Employee" e
        LEFT JOIN "User" u ON u.id = e."userId"
        ORDER BY e.full_name
      `);
      return reply.send(employees);
    },
  );

  // ── Time Entries ───────────────────────────────────────────────────────────
  app.get(
    '/legacy/time-entries',
    { preHandler: requireAdmin, schema: { tags: ['Legacy'] } },
    async (request, reply) => {
      const {
        limit = '50',
        offset = '0',
        employeeId,
        from,
        to,
      } = request.query as Record<string, string>;

      const params: unknown[] = [Number(limit), Number(offset)];
      const conditions: string[] = [];

      if (employeeId) {
        params.push(employeeId);
        conditions.push(`t."employeeId" = $${params.length}`);
      }
      if (from) {
        params.push(from);
        conditions.push(`t.start_time >= $${params.length}::timestamp`);
      }
      if (to) {
        params.push(to);
        conditions.push(`t.end_time <= $${params.length}::timestamp`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const entries = await supabaseQuery(
        `
        SELECT
          t.id, t.start_time AS "startTime", t.end_time AS "endTime",
          t."createdAt",
          e.full_name AS "employeeName", e.employee_code AS "employeeCode",
          e.hourly_rate AS "hourlyRate",
          EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600.0 AS "hoursWorked"
        FROM "TimeEntry" t
        JOIN "Employee" e ON e.id = t."employeeId"
        ${whereClause}
        ORDER BY t.start_time DESC
        LIMIT $1 OFFSET $2
      `,
        params,
      );

      const countParams = params.slice(2); // Remove limit/offset
      const countConditions = conditions.map((c, i) => c.replace(`$${i + 3}`, `$${i + 1}`));
      const countWhere = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : '';

      const countResult = await supabaseQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM "TimeEntry" t ${countWhere}`,
        countParams,
      );

      return reply.send({
        entries,
        total: Number(countResult[0]?.count ?? 0),
        limit: Number(limit),
        offset: Number(offset),
      });
    },
  );

  // ── Time Entries Summary (per employee) ────────────────────────────────────
  app.get(
    '/legacy/time-entries/summary',
    { preHandler: requireAdmin, schema: { tags: ['Legacy'] } },
    async (request, reply) => {
      const { from, to } = request.query as Record<string, string>;
      const params: unknown[] = [];
      const conditions: string[] = [];

      if (from) {
        params.push(from);
        conditions.push(`t.start_time >= $${params.length}::timestamp`);
      }
      if (to) {
        params.push(to);
        conditions.push(`t.end_time <= $${params.length}::timestamp`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const summary = await supabaseQuery(
        `
        SELECT
          e.id AS "employeeId",
          e.full_name AS "employeeName",
          e.employee_code AS "employeeCode",
          e.hourly_rate AS "hourlyRate",
          COUNT(t.id)::int AS "totalEntries",
          ROUND(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600.0)::numeric, 2) AS "totalHours",
          ROUND((SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600.0) * e.hourly_rate)::numeric, 2) AS "totalPay"
        FROM "Employee" e
        LEFT JOIN "TimeEntry" t ON t."employeeId" = e.id
          ${whereClause ? `AND ${conditions.join(' AND ')}` : ''}
        WHERE e."isActive" = true
        GROUP BY e.id, e.full_name, e.employee_code, e.hourly_rate
        ORDER BY e.full_name
      `,
        params,
      );

      return reply.send(summary);
    },
  );

  // ── Dashboard stats (hybrid: local DB for drivers/routes, Supabase for rest) ─
  app.get(
    '/legacy/stats',
    { preHandler: [requireAdmin, requireCompanyScope], schema: { tags: ['Legacy'] } },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;

      // Local DB queries (drivers + fixed_routes — migrated in Phase 2)
      const localDrivers = await db
        .select()
        .from(schema.drivers)
        .where(eq(schema.drivers.companyId, companyId));

      const localRoutes = await db
        .select()
        .from(schema.fixedRoutes)
        .where(eq(schema.fixedRoutes.companyId, companyId));

      // Supabase queries (trips, employees, time entries — still in Phase 3)
      const [trips, employees, timeEntries] = await Promise.all([
        supabaseQuery<{ total: string; completed: string; cancelled: string; revenue: string }>(`
          SELECT
            count(*)::text AS total,
            count(*) FILTER (WHERE status = 'completed')::text AS completed,
            count(*) FILTER (WHERE status = 'cancelled')::text AS cancelled,
            COALESCE(SUM(price) FILTER (WHERE status = 'completed'), 0)::text AS revenue
          FROM "Trip"
        `),
        supabaseQuery<{ total: string; active: string }>(`
          SELECT
            count(*)::text AS total,
            count(*) FILTER (WHERE "isActive" = true)::text AS active
          FROM "Employee"
        `),
        supabaseQuery<{ total: string; totalHours: string }>(`
          SELECT
            count(*)::text AS total,
            COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0)::numeric, 1), 0)::text AS "totalHours"
          FROM "TimeEntry"
          WHERE end_time IS NOT NULL
        `),
      ]);

      return reply.send({
        drivers: {
          total: localDrivers.length,
          active: localDrivers.filter((d) => d.isActive).length,
          available: localDrivers.filter((d) => d.isAvailable).length,
        },
        trips: {
          total: Number(trips[0]?.total ?? 0),
          completed: Number(trips[0]?.completed ?? 0),
          cancelled: Number(trips[0]?.cancelled ?? 0),
          revenue: Number(trips[0]?.revenue ?? 0),
        },
        employees: {
          total: Number(employees[0]?.total ?? 0),
          active: Number(employees[0]?.active ?? 0),
        },
        timeEntries: {
          total: Number(timeEntries[0]?.total ?? 0),
          totalHours: Number(timeEntries[0]?.totalHours ?? 0),
        },
        priceOverrides: {
          total: localRoutes.length,
          active: localRoutes.filter((r) => r.isActive).length,
        },
      });
    },
  );
}
