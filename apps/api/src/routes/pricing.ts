import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  requireAuth,
  requireAdmin,
  getCompanyId,
  requireCompanyScope,
} from '../middleware/auth.js';
import {
  calculatePriceQuote,
  getPricingRules,
  upsertPricingRules,
  listZoneMinimums,
  getZoneMinimum,
  createZoneMinimum,
  updateZoneMinimum,
  deleteZoneMinimum,
  listFixedRoutes,
  getFixedRoute,
  createFixedRoute,
  updateFixedRoute,
  deleteFixedRoute,
} from '../services/pricing.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const quoteSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  dropoffLat: z.number().min(-90).max(90),
  dropoffLng: z.number().min(-180).max(180),
});

const pricingRulesSchema = z.object({
  baseRatePerMile: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  minimumFare: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  perMinuteRate: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
});

const createZoneSchema = z.object({
  zoneName: z.string().min(1),
  minimumFare: z.string().regex(/^\d+(\.\d{1,2})?$/),
  boundaryPolygon: z.string().optional(),
});

const updateZoneSchema = z.object({
  zoneName: z.string().min(1).optional(),
  minimumFare: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  boundaryPolygon: z.string().optional(),
});

const createFixedRouteSchema = z.object({
  name: z.string().optional(),
  originLat: z.number().min(-90).max(90),
  originLng: z.number().min(-180).max(180),
  destLat: z.number().min(-90).max(90),
  destLng: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(50).max(5000).optional(),
  fixedPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const updateFixedRouteSchema = z.object({
  name: z.string().optional(),
  originLat: z.number().min(-90).max(90).optional(),
  originLng: z.number().min(-180).max(180).optional(),
  destLat: z.number().min(-90).max(90).optional(),
  destLng: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().min(50).max(5000).optional(),
  fixedPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
});

// ── Routes ──────────────────────────────────────────────────────────────────

export async function pricingRoutes(app: FastifyInstance) {
  // ── Quote endpoint (authenticated, any role) ────────────────────────────
  app.post(
    '/pricing/quote',
    { preHandler: [requireAuth, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const body = quoteSchema.parse(request.body);
      const quote = await calculatePriceQuote({ companyId, ...body });
      return quote;
    },
  );

  // ── Pricing rules (admin only) ─────────────────────────────────────────
  app.get(
    '/pricing/rules',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request) => {
      const companyId = getCompanyId(request)!;
      const rules = await getPricingRules(companyId);
      return rules ?? { message: 'No pricing rules configured, using defaults' };
    },
  );

  app.put(
    '/pricing/rules',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request) => {
      const companyId = getCompanyId(request)!;
      const body = pricingRulesSchema.parse(request.body);
      return upsertPricingRules(companyId, body);
    },
  );

  // ── Zone minimums (admin only) ─────────────────────────────────────────
  app.get(
    '/pricing/zones',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request) => {
      const companyId = getCompanyId(request)!;
      return listZoneMinimums(companyId);
    },
  );

  app.get(
    '/pricing/zones/:id',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { id } = request.params as { id: string };
      const zone = await getZoneMinimum(id, companyId);
      if (!zone) return reply.code(404).send({ error: 'Zone not found' });
      return zone;
    },
  );

  app.post(
    '/pricing/zones',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const body = createZoneSchema.parse(request.body);
      const zone = await createZoneMinimum({ companyId, ...body });
      return reply.code(201).send(zone);
    },
  );

  app.patch(
    '/pricing/zones/:id',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { id } = request.params as { id: string };
      const body = updateZoneSchema.parse(request.body);
      const updated = await updateZoneMinimum(id, companyId, body);
      if (!updated) return reply.code(404).send({ error: 'Zone not found' });
      return updated;
    },
  );

  app.delete(
    '/pricing/zones/:id',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { id } = request.params as { id: string };
      const deleted = await deleteZoneMinimum(id, companyId);
      if (!deleted) return reply.code(404).send({ error: 'Zone not found' });
      return { ok: true };
    },
  );

  // ── Fixed routes (admin only) ──────────────────────────────────────────
  app.get(
    '/pricing/fixed-routes',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request) => {
      const companyId = getCompanyId(request)!;
      return listFixedRoutes(companyId);
    },
  );

  app.get(
    '/pricing/fixed-routes/:id',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { id } = request.params as { id: string };
      const route = await getFixedRoute(id, companyId);
      if (!route) return reply.code(404).send({ error: 'Fixed route not found' });
      return route;
    },
  );

  app.post(
    '/pricing/fixed-routes',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const body = createFixedRouteSchema.parse(request.body);
      const route = await createFixedRoute({ companyId, ...body });
      return reply.code(201).send(route);
    },
  );

  app.patch(
    '/pricing/fixed-routes/:id',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { id } = request.params as { id: string };
      const body = updateFixedRouteSchema.parse(request.body);
      const updated = await updateFixedRoute(id, companyId, body);
      if (!updated) return reply.code(404).send({ error: 'Fixed route not found' });
      return updated;
    },
  );

  app.delete(
    '/pricing/fixed-routes/:id',
    { preHandler: [requireAdmin, requireCompanyScope] },
    async (request, reply) => {
      const companyId = getCompanyId(request)!;
      const { id } = request.params as { id: string };
      const deleted = await deleteFixedRoute(id, companyId);
      if (!deleted) return reply.code(404).send({ error: 'Fixed route not found' });
      return { ok: true };
    },
  );
}
