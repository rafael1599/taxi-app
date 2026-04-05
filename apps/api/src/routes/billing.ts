import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requirePlatformAdmin, getCompanyId } from '../middleware/auth.js';
import {
  createCompanyStripeAccount,
  createCompanyOnboardingLink,
  getCompanyStripeStatus,
  createCompanySubscription,
  createDriverSubscription,
  cancelDriverSubscription,
  getDriverSubscriptionStatus,
  recordCommission,
  transferDriverEarnings,
  getDriverEarnings,
  getCompanyRevenue,
  getCompanyDriverBreakdown,
  handleStripeWebhook,
  listCommissions,
  updateCompanyCommission,
} from '../services/stripe.js';

export async function billingRoutes(app: FastifyInstance) {
  // ── Company Stripe Connect ────────────────────────────────────────────────

  /** Create Stripe Connect account for a company */
  app.post('/billing/company/connect', { preHandler: requireAdmin }, async (request, reply) => {
    const companyId = getCompanyId(request);
    if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
    const result = await createCompanyStripeAccount(companyId);
    return reply.code(201).send(result);
  });

  /** Get Stripe onboarding link for company */
  app.post(
    '/billing/company/onboarding-link',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const companyId = getCompanyId(request);
      if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
      const body = z.object({ returnUrl: z.string().url() }).parse(request.body);
      const result = await createCompanyOnboardingLink(companyId, body.returnUrl);
      return result;
    },
  );

  /** Get Stripe Connect status for company */
  app.get('/billing/company/status', { preHandler: requireAdmin }, async (request, reply) => {
    const companyId = getCompanyId(request);
    if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
    return getCompanyStripeStatus(companyId);
  });

  /** Create SaaS subscription for company */
  app.post(
    '/billing/company/subscription',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const companyId = getCompanyId(request);
      if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
      const body = z.object({ priceId: z.string(), email: z.string().email() }).parse(request.body);
      const result = await createCompanySubscription(companyId, body.priceId, body.email);
      return reply.code(201).send(result);
    },
  );

  /** Update company commission percentage */
  app.patch('/billing/company/commission', { preHandler: requireAdmin }, async (request, reply) => {
    const companyId = getCompanyId(request);
    if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
    const body = z.object({ commissionPercent: z.number().min(0).max(100) }).parse(request.body);
    const updated = await updateCompanyCommission(companyId, body.commissionPercent);
    return updated;
  });

  // ── Driver Subscriptions ──────────────────────────────────────────────────

  /** Create weekly subscription for a driver */
  app.post(
    '/billing/drivers/:driverId/subscription',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const body = z.object({ priceId: z.string(), email: z.string().email() }).parse(request.body);
      const result = await createDriverSubscription(driverId, body.priceId, body.email);
      return reply.code(201).send(result);
    },
  );

  /** Cancel a driver's subscription */
  app.delete(
    '/billing/drivers/:driverId/subscription',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      const result = await cancelDriverSubscription(driverId);
      return result;
    },
  );

  /** Get driver subscription status */
  app.get(
    '/billing/drivers/:driverId/subscription',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { driverId } = request.params as { driverId: string };
      return getDriverSubscriptionStatus(driverId);
    },
  );

  // ── Commissions ───────────────────────────────────────────────────────────

  /** List commissions for a company */
  app.get('/billing/commissions', { preHandler: requireAdmin }, async (request, reply) => {
    const companyId = getCompanyId(request);
    if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
    const query = request.query as { limit?: string; offset?: string; driverId?: string };
    return listCommissions(companyId, {
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
      driverId: query.driverId,
    });
  });

  /** Manually record commission for a ride (typically called by trip lifecycle) */
  app.post(
    '/billing/commissions/record/:rideId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { rideId } = request.params as { rideId: string };
      const commission = await recordCommission(rideId);
      return reply.code(201).send(commission);
    },
  );

  /** Transfer driver earnings for a commission */
  app.post(
    '/billing/commissions/:commissionId/transfer',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { commissionId } = request.params as { commissionId: string };
      const result = await transferDriverEarnings(commissionId);
      return result;
    },
  );

  // ── Financial Reports ─────────────────────────────────────────────────────

  const dateRangeSchema = z.object({
    from: z.string().transform((s) => new Date(s)),
    to: z.string().transform((s) => new Date(s)),
  });

  /** Company revenue summary */
  app.get('/billing/reports/revenue', { preHandler: requireAdmin }, async (request, reply) => {
    const companyId = getCompanyId(request);
    if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
    const { from, to } = dateRangeSchema.parse(request.query);
    return getCompanyRevenue(companyId, from, to);
  });

  /** Per-driver earnings breakdown */
  app.get('/billing/reports/drivers', { preHandler: requireAdmin }, async (request, reply) => {
    const companyId = getCompanyId(request);
    if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
    const { from, to } = dateRangeSchema.parse(request.query);
    return getCompanyDriverBreakdown(companyId, from, to);
  });

  /** Individual driver earnings */
  app.get(
    '/billing/reports/drivers/:driverId',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const companyId = getCompanyId(request);
      if (!companyId) return reply.code(403).send({ error: 'Company scope required' });
      const { driverId } = request.params as { driverId: string };
      const { from, to } = dateRangeSchema.parse(request.query);
      return getDriverEarnings(driverId, companyId, from, to);
    },
  );

  // ── Stripe Webhook ────────────────────────────────────────────────────────

  /** Stripe webhook endpoint — no auth, verified via Stripe signature */
  app.post(
    '/billing/webhook',
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'] as string;
      if (!signature) return reply.code(400).send({ error: 'Missing stripe-signature header' });

      const rawBody = (request as unknown as { rawBody: string }).rawBody;
      if (!rawBody) return reply.code(400).send({ error: 'Missing raw body' });

      const result = await handleStripeWebhook(rawBody, signature);
      return { received: true, ...result };
    },
  );
}
