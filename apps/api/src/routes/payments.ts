import { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { db, schema } from '@drivly/db';
import { eq } from 'drizzle-orm';
import { requireRider } from '../middleware/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2025-02-24.acacia',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

// Ensure or create a Stripe customer for the rider, caching the ID in DB
async function getOrCreateStripeCustomer(riderId: string): Promise<string> {
  const rider = await db.query.riders.findFirst({
    where: eq(schema.riders.id, riderId),
    columns: { stripeCustomerId: true, email: true, fullName: true },
  });

  if (rider?.stripeCustomerId) return rider.stripeCustomerId;

  const customer = await stripe.customers.create({
    ...(rider?.email ? { email: rider.email } : {}),
    ...(rider?.fullName ? { name: rider.fullName } : {}),
    metadata: { riderId },
  });

  await db
    .update(schema.riders)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(schema.riders.id, riderId));

  return customer.id;
}

export async function paymentRoutes(app: FastifyInstance) {
  // POST /payments/setup-intent — create SetupIntent for adding a payment method
  app.post('/payments/setup-intent', { preHandler: requireRider }, async (request) => {
    const user = request.user as { sub: string };
    const customerId = await getOrCreateStripeCustomer(user.sub);

    const intent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
    });

    return { clientSecret: intent.client_secret };
  });

  // GET /payments/methods — list saved payment methods
  app.get('/payments/methods', { preHandler: requireRider }, async (request) => {
    const user = request.user as { sub: string };
    const rider = await db.query.riders.findFirst({
      where: eq(schema.riders.id, user.sub),
      columns: { stripeCustomerId: true },
    });

    if (!rider?.stripeCustomerId) return [];

    const customer = (await stripe.customers.retrieve(rider.stripeCustomerId)) as Stripe.Customer;
    const methods = await stripe.paymentMethods.list({
      customer: rider.stripeCustomerId,
      type: 'card',
    });

    const defaultPmId =
      typeof customer.invoice_settings?.default_payment_method === 'string'
        ? customer.invoice_settings.default_payment_method
        : null;

    return methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'unknown',
      last4: pm.card?.last4 ?? '****',
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
      isDefault: pm.id === defaultPmId,
    }));
  });

  // PATCH /payments/methods/default — set default payment method
  app.patch('/payments/methods/default', { preHandler: requireRider }, async (request, reply) => {
    const user = request.user as { sub: string };
    const { paymentMethodId } = z.object({ paymentMethodId: z.string() }).parse(request.body);

    const customerId = await getOrCreateStripeCustomer(user.sub);

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    return reply.send({ ok: true });
  });

  // DELETE /payments/methods/:id — detach a payment method
  app.delete('/payments/methods/:id', { preHandler: requireRider }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await stripe.paymentMethods.detach(id);
    return reply.send({ ok: true });
  });

  // POST /payments/webhook — Stripe webhook (no auth, verified by signature)
  app.post(
    '/payments/webhook',
    {
      config: { rawBody: true },
    },
    async (request, reply) => {
      const sig = request.headers['stripe-signature'];
      if (!sig || !webhookSecret) {
        return reply.code(400).send({ error: 'Missing signature' });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          (request as unknown as { rawBody: Buffer }).rawBody,
          Array.isArray(sig) ? sig[0]! : sig,
          webhookSecret,
        );
      } catch {
        return reply.code(400).send({ error: 'Invalid webhook signature' });
      }

      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object as Stripe.PaymentIntent;
        // Update payment record to captured
        if (pi.metadata?.paymentId) {
          await db
            .update(schema.payments)
            .set({ status: 'captured', capturedAt: new Date() })
            .where(eq(schema.payments.id, pi.metadata.paymentId));
        }
      }

      if (event.type === 'payment_intent.payment_failed') {
        const pi = event.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.paymentId) {
          await db
            .update(schema.payments)
            .set({ status: 'failed' })
            .where(eq(schema.payments.id, pi.metadata.paymentId));
        }
      }

      return reply.send({ received: true });
    },
  );
}
