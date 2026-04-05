import Stripe from 'stripe';
import { db, schema } from '@rockland-taxi/db';
import { eq, and, sql, desc } from 'drizzle-orm';

// ── Stripe client ─────────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  return new Stripe(STRIPE_SECRET_KEY);
}

// ── Company Stripe Connect ────────────────────────────────────────────────────

/** Create a Stripe Connect Express account for a company */
export async function createCompanyStripeAccount(companyId: string) {
  const stripe = getStripe();
  const company = await db.query.companies.findFirst({
    where: eq(schema.companies.id, companyId),
  });
  if (!company) throw new Error('Company not found');
  if (company.stripeAccountId) return { accountId: company.stripeAccountId };

  const account = await stripe.accounts.create({
    type: 'express',
    metadata: { companyId, companyName: company.name },
  });

  await db
    .update(schema.companies)
    .set({ stripeAccountId: account.id, updatedAt: new Date() })
    .where(eq(schema.companies.id, companyId));

  return { accountId: account.id };
}

/** Generate an onboarding link for company Stripe Connect */
export async function createCompanyOnboardingLink(companyId: string, returnUrl: string) {
  const stripe = getStripe();
  const company = await db.query.companies.findFirst({
    where: eq(schema.companies.id, companyId),
  });
  if (!company?.stripeAccountId) throw new Error('Company has no Stripe account');

  const link = await stripe.accountLinks.create({
    account: company.stripeAccountId,
    refresh_url: `${returnUrl}?refresh=true`,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  return { url: link.url };
}

/** Get Stripe Connect account status for a company */
export async function getCompanyStripeStatus(companyId: string) {
  const stripe = getStripe();
  const company = await db.query.companies.findFirst({
    where: eq(schema.companies.id, companyId),
  });
  if (!company?.stripeAccountId) {
    return { connected: false, chargesEnabled: false, payoutsEnabled: false };
  }

  const account = await stripe.accounts.retrieve(company.stripeAccountId);
  return {
    connected: true,
    accountId: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  };
}

// ── Company SaaS Subscription ─────────────────────────────────────────────────

/** Create a Stripe customer + subscription for a company (monthly SaaS fee) */
export async function createCompanySubscription(companyId: string, priceId: string, email: string) {
  const stripe = getStripe();
  const company = await db.query.companies.findFirst({
    where: eq(schema.companies.id, companyId),
  });
  if (!company) throw new Error('Company not found');

  // Create or reuse customer
  let customerId = company.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      name: company.name,
      metadata: { companyId },
    });
    customerId = customer.id;
    await db
      .update(schema.companies)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(schema.companies.id, companyId));
  }

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata: { companyId, type: 'company_saas' },
  });

  await db
    .update(schema.companies)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status as 'active' | 'trialing',
      updatedAt: new Date(),
    })
    .where(eq(schema.companies.id, companyId));

  return { subscriptionId: subscription.id, status: subscription.status };
}

// ── Driver Subscriptions ──────────────────────────────────────────────────────

/** Create a Stripe customer + weekly subscription for a driver */
export async function createDriverSubscription(driverId: string, priceId: string, email: string) {
  const stripe = getStripe();
  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, driverId),
  });
  if (!driver) throw new Error('Driver not found');

  let customerId = driver.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email,
      name: driver.fullName,
      metadata: { driverId, companyId: driver.companyId },
    });
    customerId = customer.id;
    await db
      .update(schema.drivers)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(schema.drivers.id, driverId));
  }

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata: { driverId, companyId: driver.companyId, type: 'driver_weekly' },
  });

  await db
    .update(schema.drivers)
    .set({
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status as 'active' | 'trialing',
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));

  return { subscriptionId: subscription.id, status: subscription.status };
}

/** Cancel a driver's subscription */
export async function cancelDriverSubscription(driverId: string) {
  const stripe = getStripe();
  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, driverId),
  });
  if (!driver?.stripeSubscriptionId) throw new Error('Driver has no active subscription');

  const canceled = await stripe.subscriptions.cancel(driver.stripeSubscriptionId);

  await db
    .update(schema.drivers)
    .set({
      subscriptionStatus: 'canceled',
      updatedAt: new Date(),
    })
    .where(eq(schema.drivers.id, driverId));

  return { status: canceled.status };
}

/** Get driver subscription status */
export async function getDriverSubscriptionStatus(driverId: string) {
  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, driverId),
  });
  if (!driver) throw new Error('Driver not found');

  return {
    subscriptionId: driver.stripeSubscriptionId,
    subscriptionStatus: driver.subscriptionStatus,
    stripeCustomerId: driver.stripeCustomerId,
  };
}

// ── Commission Tracking ───────────────────────────────────────────────────────

/** Record commission for a completed ride */
export async function recordCommission(rideId: string) {
  const ride = await db.query.rides.findFirst({
    where: eq(schema.rides.id, rideId),
  });
  if (!ride || !ride.driverId || !ride.fareFinal) {
    throw new Error('Ride not found, no driver, or no final fare');
  }

  const company = await db.query.companies.findFirst({
    where: eq(schema.companies.id, ride.companyId),
  });
  if (!company) throw new Error('Company not found');

  const fareAmount = parseFloat(ride.fareFinal);
  const commissionPct = parseFloat(company.commissionPercent);
  const commissionAmt = Math.round(fareAmount * (commissionPct / 100) * 100) / 100;
  const driverEarnings = Math.round((fareAmount - commissionAmt) * 100) / 100;

  const [commission] = await db
    .insert(schema.commissions)
    .values({
      companyId: ride.companyId,
      rideId: ride.id,
      driverId: ride.driverId,
      fareAmount: fareAmount.toFixed(2),
      commissionPercent: commissionPct.toFixed(2),
      commissionAmount: commissionAmt.toFixed(2),
      driverEarnings: driverEarnings.toFixed(2),
      status: 'pending',
    })
    .returning();

  return commission;
}

/** Transfer driver earnings via Stripe Connect */
export async function transferDriverEarnings(commissionId: string) {
  const stripe = getStripe();
  const commission = await db.query.commissions.findFirst({
    where: eq(schema.commissions.id, commissionId),
  });
  if (!commission) throw new Error('Commission not found');

  const driver = await db.query.drivers.findFirst({
    where: eq(schema.drivers.id, commission.driverId),
  });
  if (!driver?.stripeAccountId) throw new Error('Driver has no Stripe account for payouts');

  const amountCents = Math.round(parseFloat(commission.driverEarnings) * 100);

  const transfer = await stripe.transfers.create({
    amount: amountCents,
    currency: 'usd',
    destination: driver.stripeAccountId,
    metadata: {
      commissionId: commission.id,
      rideId: commission.rideId,
      driverId: commission.driverId,
    },
  });

  await db
    .update(schema.commissions)
    .set({ stripeTransferId: transfer.id, status: 'transferred' })
    .where(eq(schema.commissions.id, commissionId));

  return { transferId: transfer.id };
}

// ── Financial Reports ─────────────────────────────────────────────────────────

/** Get earnings summary for a driver within a date range */
export async function getDriverEarnings(driverId: string, companyId: string, from: Date, to: Date) {
  const result = await db
    .select({
      totalFares: sql<string>`COALESCE(SUM(${schema.commissions.fareAmount}), 0)`,
      totalCommission: sql<string>`COALESCE(SUM(${schema.commissions.commissionAmount}), 0)`,
      totalEarnings: sql<string>`COALESCE(SUM(${schema.commissions.driverEarnings}), 0)`,
      rideCount: sql<number>`COUNT(*)::int`,
    })
    .from(schema.commissions)
    .where(
      and(
        eq(schema.commissions.driverId, driverId),
        eq(schema.commissions.companyId, companyId),
        sql`${schema.commissions.createdAt} >= ${from}`,
        sql`${schema.commissions.createdAt} <= ${to}`,
      ),
    );

  return result[0];
}

/** Get company revenue summary within a date range */
export async function getCompanyRevenue(companyId: string, from: Date, to: Date) {
  const result = await db
    .select({
      totalFares: sql<string>`COALESCE(SUM(${schema.commissions.fareAmount}), 0)`,
      totalCommission: sql<string>`COALESCE(SUM(${schema.commissions.commissionAmount}), 0)`,
      totalDriverPay: sql<string>`COALESCE(SUM(${schema.commissions.driverEarnings}), 0)`,
      rideCount: sql<number>`COUNT(*)::int`,
    })
    .from(schema.commissions)
    .where(
      and(
        eq(schema.commissions.companyId, companyId),
        sql`${schema.commissions.createdAt} >= ${from}`,
        sql`${schema.commissions.createdAt} <= ${to}`,
      ),
    );

  return result[0];
}

/** Get per-driver earnings breakdown for a company */
export async function getCompanyDriverBreakdown(companyId: string, from: Date, to: Date) {
  const rows = await db
    .select({
      driverId: schema.commissions.driverId,
      driverName: schema.drivers.fullName,
      totalFares: sql<string>`COALESCE(SUM(${schema.commissions.fareAmount}), 0)`,
      totalEarnings: sql<string>`COALESCE(SUM(${schema.commissions.driverEarnings}), 0)`,
      totalCommission: sql<string>`COALESCE(SUM(${schema.commissions.commissionAmount}), 0)`,
      rideCount: sql<number>`COUNT(*)::int`,
    })
    .from(schema.commissions)
    .innerJoin(schema.drivers, eq(schema.commissions.driverId, schema.drivers.id))
    .where(
      and(
        eq(schema.commissions.companyId, companyId),
        sql`${schema.commissions.createdAt} >= ${from}`,
        sql`${schema.commissions.createdAt} <= ${to}`,
      ),
    )
    .groupBy(schema.commissions.driverId, schema.drivers.fullName)
    .orderBy(sql`SUM(${schema.commissions.fareAmount}) DESC`);

  return rows;
}

// ── Webhook Processing ────────────────────────────────────────────────────────

/** Check if a webhook event has already been processed (idempotency) */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const existing = await db.query.stripeWebhookEvents.findFirst({
    where: eq(schema.stripeWebhookEvents.id, eventId),
  });
  return !!existing;
}

/** Mark a webhook event as processed */
export async function markEventProcessed(eventId: string, type: string, companyId?: string) {
  await db
    .insert(schema.stripeWebhookEvents)
    .values({ id: eventId, type, companyId: companyId ?? null })
    .onConflictDoNothing();
}

/** Handle incoming Stripe webhook event */
export async function handleStripeWebhook(rawBody: string, signature: string) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  if (await isEventProcessed(event.id)) {
    return { duplicate: true, eventId: event.id };
  }

  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const meta = subscription.metadata;
      const status = subscription.status as
        | 'active'
        | 'canceled'
        | 'past_due'
        | 'unpaid'
        | 'paused';

      if (meta.type === 'driver_weekly' && meta.driverId) {
        await db
          .update(schema.drivers)
          .set({ subscriptionStatus: status, updatedAt: new Date() })
          .where(eq(schema.drivers.id, meta.driverId));
        await markEventProcessed(event.id, event.type, meta.companyId);
      } else if (meta.type === 'company_saas' && meta.companyId) {
        await db
          .update(schema.companies)
          .set({ subscriptionStatus: status, updatedAt: new Date() })
          .where(eq(schema.companies.id, meta.companyId));
        await markEventProcessed(event.id, event.type, meta.companyId);
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      await markEventProcessed(event.id, event.type);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      // Subscription status will be updated via subscription.updated event
      await markEventProcessed(event.id, event.type);
      break;
    }

    default:
      await markEventProcessed(event.id, event.type);
      break;
  }

  return { duplicate: false, eventId: event.id, type: event.type };
}

/** List commissions for a company */
export async function listCommissions(
  companyId: string,
  opts: { limit?: number; offset?: number; driverId?: string } = {},
) {
  const { limit = 50, offset = 0, driverId } = opts;
  const conditions = [eq(schema.commissions.companyId, companyId)];
  if (driverId) conditions.push(eq(schema.commissions.driverId, driverId));

  return db.query.commissions.findMany({
    where: and(...conditions),
    orderBy: (c) => [desc(c.createdAt)],
    limit,
    offset,
  });
}

/** Update company commission percentage */
export async function updateCompanyCommission(companyId: string, commissionPercent: number) {
  if (commissionPercent < 0 || commissionPercent > 100) {
    throw new Error('Commission percent must be between 0 and 100');
  }
  const [updated] = await db
    .update(schema.companies)
    .set({ commissionPercent: commissionPercent.toFixed(2), updatedAt: new Date() })
    .where(eq(schema.companies.id, companyId))
    .returning();
  return updated;
}
