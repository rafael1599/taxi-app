import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, schema } from '@drivly/db';
import { eq, desc, count, and, inArray, sql, gte, lte } from 'drizzle-orm';
import { requireAdmin, getCompanyId } from '../middleware/auth.js';
import { getDriverPerformanceSummary } from '../services/driverMetrics.js';

export async function adminRoutes(app: FastifyInstance) {
  // GET /admin/dashboard — summary stats (company-scoped)
  app.get('/admin/dashboard', { preHandler: requireAdmin }, async (request) => {
    const companyId = getCompanyId(request);

    const driverWhere = companyId ? eq(schema.drivers.companyId, companyId) : undefined;
    const activeDriverWhere = companyId
      ? and(
          eq(schema.drivers.isAvailable, true),
          eq(schema.drivers.isActive, true),
          eq(schema.drivers.companyId, companyId),
        )
      : and(eq(schema.drivers.isAvailable, true), eq(schema.drivers.isActive, true));
    const riderWhere = companyId ? eq(schema.riders.companyId, companyId) : undefined;
    const rideWhere = companyId ? eq(schema.rides.companyId, companyId) : undefined;
    const pendingWhere = companyId
      ? and(
          inArray(schema.rides.status, ['requested', 'accepted', 'in_progress']),
          eq(schema.rides.companyId, companyId),
        )
      : inArray(schema.rides.status, ['requested', 'accepted', 'in_progress']);

    const [totalDrivers] = await db
      .select({ count: count() })
      .from(schema.drivers)
      .where(driverWhere);
    const [activeDrivers] = await db
      .select({ count: count() })
      .from(schema.drivers)
      .where(activeDriverWhere);
    const [totalRiders] = await db.select({ count: count() }).from(schema.riders).where(riderWhere);
    const [totalRides] = await db.select({ count: count() }).from(schema.rides).where(rideWhere);
    const [pendingRides] = await db
      .select({ count: count() })
      .from(schema.rides)
      .where(pendingWhere);

    return {
      totalDrivers: totalDrivers!.count,
      activeDrivers: activeDrivers!.count,
      totalRiders: totalRiders!.count,
      totalRides: totalRides!.count,
      pendingRides: pendingRides!.count,
    };
  });

  // GET /admin/drivers — list drivers (company-scoped)
  app.get('/admin/drivers', { preHandler: requireAdmin }, async (request) => {
    const companyId = getCompanyId(request);
    const { status } = (request.query as { status?: string }) ?? {};

    const conditions = [];
    if (companyId) conditions.push(eq(schema.drivers.companyId, companyId));
    if (status === 'active') conditions.push(eq(schema.drivers.isActive, true));
    else if (status === 'suspended') conditions.push(eq(schema.drivers.isActive, false));

    return db.query.drivers.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      columns: { passwordHash: false },
      orderBy: [desc(schema.drivers.createdAt)],
    });
  });

  // GET /admin/drivers/:id/performance — driver metrics (7-day rolling)
  app.get(
    '/admin/drivers/:id/performance',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const companyId = getCompanyId(request);
      if (!companyId) return reply.code(400).send({ error: 'Company scope required' });
      return getDriverPerformanceSummary(id, companyId);
    },
  );

  // PATCH /admin/drivers/:id — approve or suspend
  app.patch('/admin/drivers/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = getCompanyId(request);
    const body = z.object({ isActive: z.boolean() }).parse(request.body);

    const conditions = [eq(schema.drivers.id, id)];
    if (companyId) conditions.push(eq(schema.drivers.companyId, companyId));

    const [updated] = await db
      .update(schema.drivers)
      .set({ isActive: body.isActive, updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: schema.drivers.id, isActive: schema.drivers.isActive });

    if (!updated) return reply.code(404).send({ error: 'Driver not found' });
    return updated;
  });

  // GET /admin/rides — list rides (company-scoped)
  app.get('/admin/rides', { preHandler: requireAdmin }, async (request) => {
    const companyId = getCompanyId(request);
    const {
      status,
      limit = '50',
      offset = '0',
    } = request.query as {
      status?: string;
      limit?: string;
      offset?: string;
    };

    const validStatuses = [
      'requested',
      'accepted',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
    ];
    const conditions = [];
    if (companyId) conditions.push(eq(schema.rides.companyId, companyId));
    if (status && validStatuses.includes(status)) {
      conditions.push(
        eq(
          schema.rides.status,
          status as
            | 'requested'
            | 'accepted'
            | 'arrived'
            | 'in_progress'
            | 'completed'
            | 'cancelled',
        ),
      );
    }

    return db.query.rides.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.rides.createdAt)],
      limit: Math.min(Number(limit), 200),
      offset: Number(offset),
    });
  });

  // POST /admin/rides/:id/dispatch — manually assign a driver to a ride
  app.post('/admin/rides/:id/dispatch', { preHandler: requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const companyId = getCompanyId(request);
    const body = z.object({ driverId: z.string().uuid() }).parse(request.body);

    const rideConditions = [eq(schema.rides.id, id)];
    if (companyId) rideConditions.push(eq(schema.rides.companyId, companyId));

    const ride = await db.query.rides.findFirst({ where: and(...rideConditions) });
    if (!ride) return reply.code(404).send({ error: 'Ride not found' });
    if (!['requested', 'accepted'].includes(ride.status)) {
      return reply.code(409).send({ error: 'Ride cannot be dispatched in current state' });
    }

    // Driver must belong to the same company as the ride
    const driverConditions = [
      eq(schema.drivers.id, body.driverId),
      eq(schema.drivers.isActive, true),
    ];
    driverConditions.push(eq(schema.drivers.companyId, ride.companyId));

    const driver = await db.query.drivers.findFirst({
      where: and(...driverConditions),
    });
    if (!driver) return reply.code(404).send({ error: 'Driver not found or inactive' });

    const [updated] = await db
      .update(schema.rides)
      .set({
        driverId: body.driverId,
        status: 'accepted',
        acceptedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.rides.id, id))
      .returning();

    await db
      .update(schema.drivers)
      .set({ isAvailable: false, updatedAt: new Date() })
      .where(eq(schema.drivers.id, body.driverId));

    return updated;
  });

  // GET /admin/drivers/live — active driver locations for map (company-scoped)
  app.get('/admin/drivers/live', { preHandler: requireAdmin }, async (request) => {
    const companyId = getCompanyId(request);

    const conditions = [eq(schema.drivers.isActive, true), eq(schema.drivers.isAvailable, true)];
    if (companyId) conditions.push(eq(schema.drivers.companyId, companyId));

    return db.query.drivers.findMany({
      where: and(...conditions),
      columns: {
        id: true,
        fullName: true,
        phone: true,
        currentLat: true,
        currentLng: true,
        locationAt: true,
        isAvailable: true,
      },
    });
  });

  // GET /admin/analytics — KPI metrics (company-scoped)
  app.get('/admin/analytics', { preHandler: requireAdmin }, async (request) => {
    const companyId = getCompanyId(request);
    const { from, to } = request.query as { from?: string; to?: string };

    const dateFrom = from ? new Date(from) : new Date(Date.now() - 30 * 86400_000); // last 30 days
    const dateTo = to ? new Date(to) : new Date();

    const companyFilter = companyId ? eq(schema.rides.companyId, companyId) : undefined;
    const dateFilter = and(
      gte(schema.rides.createdAt, dateFrom),
      lte(schema.rides.createdAt, dateTo),
    );
    const baseWhere = companyFilter ? and(companyFilter, dateFilter) : dateFilter;

    // Total rides, completed, cancelled, completion rate
    const [rideStats] = await db
      .select({
        total: count(),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${schema.rides.status} = 'completed')::int`,
        cancelled: sql<number>`COUNT(*) FILTER (WHERE ${schema.rides.status} = 'cancelled')::int`,
      })
      .from(schema.rides)
      .where(baseWhere);

    if (!rideStats) throw new Error('Failed to get ride stats');
    const completionRate =
      rideStats.total > 0 ? Math.round((rideStats.completed / rideStats.total) * 100) : 0;

    // Revenue
    const paymentWhere = companyId
      ? and(
          eq(schema.payments.companyId, companyId),
          eq(schema.payments.status, 'captured'),
          gte(schema.payments.createdAt, dateFrom),
          lte(schema.payments.createdAt, dateTo),
        )
      : and(
          eq(schema.payments.status, 'captured'),
          gte(schema.payments.createdAt, dateFrom),
          lte(schema.payments.createdAt, dateTo),
        );

    const [revenue] = await db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(${schema.payments.amount}), 0)`,
        avgFare: sql<string>`COALESCE(AVG(${schema.payments.amount}), 0)`,
      })
      .from(schema.payments)
      .where(paymentWhere);

    // Average driver rating
    const ratingWhere = companyId
      ? and(
          eq(schema.ratings.companyId, companyId),
          gte(schema.ratings.createdAt, dateFrom),
          lte(schema.ratings.createdAt, dateTo),
          sql`${schema.ratings.toDriverId} IS NOT NULL`,
        )
      : and(
          gte(schema.ratings.createdAt, dateFrom),
          lte(schema.ratings.createdAt, dateTo),
          sql`${schema.ratings.toDriverId} IS NOT NULL`,
        );

    const [ratingStats] = await db
      .select({
        avgRating: sql<string>`COALESCE(ROUND(AVG(${schema.ratings.score}), 2), 0)`,
        totalRatings: sql<number>`COUNT(*)::int`,
      })
      .from(schema.ratings)
      .where(ratingWhere);

    // Rides per day (for chart)
    const dailyRides = await db
      .select({
        date: sql<string>`DATE(${schema.rides.createdAt})::text`,
        total: count(),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${schema.rides.status} = 'completed')::int`,
      })
      .from(schema.rides)
      .where(baseWhere)
      .groupBy(sql`DATE(${schema.rides.createdAt})`)
      .orderBy(sql`DATE(${schema.rides.createdAt})`);

    // Top 5 drivers by rides completed
    const topDrivers = await db
      .select({
        driverId: schema.rides.driverId,
        driverName: schema.drivers.fullName,
        completedRides: sql<number>`COUNT(*) FILTER (WHERE ${schema.rides.status} = 'completed')::int`,
        avgRating: sql<string>`COALESCE(${schema.drivers.avgRating}, 0)`,
      })
      .from(schema.rides)
      .innerJoin(schema.drivers, eq(schema.rides.driverId, schema.drivers.id))
      .where(and(baseWhere, sql`${schema.rides.driverId} IS NOT NULL`))
      .groupBy(schema.rides.driverId, schema.drivers.fullName, schema.drivers.avgRating)
      .orderBy(sql`COUNT(*) FILTER (WHERE ${schema.rides.status} = 'completed') DESC`)
      .limit(5);

    if (!revenue) throw new Error('Failed to get revenue');
    if (!ratingStats) throw new Error('Failed to get rating stats');

    return {
      period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
      rides: {
        total: rideStats.total,
        completed: rideStats.completed,
        cancelled: rideStats.cancelled,
        completionRate,
      },
      revenue: {
        total: parseFloat(revenue.totalRevenue).toFixed(2),
        avgFare: parseFloat(revenue.avgFare).toFixed(2),
      },
      ratings: {
        avgDriverRating: parseFloat(ratingStats.avgRating).toFixed(2),
        totalRatings: ratingStats.totalRatings,
      },
      dailyRides,
      topDrivers,
    };
  });

  // GET /admin/audit-log — audit log for state transitions (company-scoped)
  app.get('/admin/audit-log', { preHandler: requireAdmin }, async (request) => {
    const companyId = getCompanyId(request);
    const { limit = '100', offset = '0' } = (request.query as Record<string, string>) || {};

    const { getAuditLog } = await import('../services/auditLog.js');
    const entries = await getAuditLog(
      companyId ?? undefined,
      Math.min(Number(limit) || 100, 500),
      Number(offset) || 0,
    );

    return { entries, count: entries.length };
  });
}
