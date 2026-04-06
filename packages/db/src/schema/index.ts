import {
  boolean,
  char,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums ──────────────────────────────────────────────────────────────────────

export const rideStatusEnum = pgEnum('ride_status', [
  'requested',
  'searching_driver',
  'driver_assigned',
  'accepted',
  'arrived',
  'en_route',
  'in_progress',
  'picked_up',
  'completed',
  'cancelled',
]);

export const driverStatusEnum = pgEnum('driver_status', [
  'offline',
  'idle',
  'incoming',
  'accepted',
  'en_route',
  'arrived',
  'picked_up',
  'completed',
]);

export const tripOfferStatusEnum = pgEnum('trip_offer_status', [
  'pending',
  'accepted',
  'rejected',
  'expired',
]);

export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'authorized',
  'captured',
  'refunded',
  'failed',
]);

export const adminRoleEnum = pgEnum('admin_role', [
  'super_admin',
  'dispatcher',
  'viewer',
  'platform_admin',
  'company_admin',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);

export const otpChannelEnum = pgEnum('otp_channel', ['whatsapp', 'sms']);

export const migrationSourceEnum = pgEnum('migration_source', [
  'legacy',
  'local',
  'migration_script',
]);

// ── Companies (multi-tenant root) ─────────────────────────────────────────────

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  whatsappJid: text('whatsapp_jid'),
  isActive: boolean('is_active').notNull().default(true),
  settings: jsonb('settings').notNull().default({}),
  stripeAccountId: text('stripe_account_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeCustomerId: text('stripe_customer_id'),
  subscriptionStatus: subscriptionStatusEnum('subscription_status').default('trialing'),
  commissionPercent: numeric('commission_percent', { precision: 5, scale: 2 })
    .notNull()
    .default('10.00'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ── Tables ─────────────────────────────────────────────────────────────────────

export const riders = pgTable('riders', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  fullName: text('full_name').notNull(),
  phone: text('phone').notNull().unique(),
  email: text('email').notNull().unique(),
  avatarUrl: text('avatar_url'),
  stripeCustomerId: text('stripe_cust'),
  pushToken: text('push_token'),
  phoneVerified: boolean('phone_verified').notNull().default(false),
  avgRating: numeric('avg_rating', { precision: 3, scale: 2 }),
  totalRatings: integer('total_ratings').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull().unique(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'), // nullable: OTP is primary auth for drivers
    licenseNumber: text('license_number').notNull().unique(),
    tlcLicense: text('tlc_license'),
    stripeAccountId: text('stripe_acct'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCustomerId: text('stripe_customer_id'),
    subscriptionStatus: subscriptionStatusEnum('subscription_status'),
    isActive: boolean('is_active').notNull().default(true),
    isAvailable: boolean('is_available').notNull().default(false),
    status: driverStatusEnum('status').notNull().default('offline'),
    currentLat: doublePrecision('current_lat'),
    currentLng: doublePrecision('current_lng'),
    locationAt: timestamp('location_at'),
    pushToken: text('push_token'),
    avgRating: numeric('avg_rating', { precision: 3, scale: 2 }),
    totalRatings: integer('total_ratings').notNull().default(0),
    // OTP authentication (primary method for drivers)
    phoneVerified: boolean('phone_verified').notNull().default(false),
    otpCode: text('otp_code'),
    otpExpiresAt: timestamp('otp_expires_at'),
    otpChannel: otpChannelEnum('otp_channel'),
    lastLoginAt: timestamp('last_login_at'),
    // Persistent session (refresh tokens — Uber-style)
    refreshToken: text('refresh_token').unique(),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    // Optional link to employee (future: driver on payroll)
    employeeId: uuid('employee_id'),
    // Soft delete with timestamp
    deactivatedAt: timestamp('deactivated_at'),
    // Migration tracking
    legacySupabaseId: text('legacy_supabase_id').unique(),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('drivers_available_idx')
      .on(t.isAvailable, t.isActive)
      .where(sql`${t.isAvailable} = true AND ${t.isActive} = true`),
    index('drivers_company_id_idx').on(t.companyId),
    index('drivers_status_idx')
      .on(t.status)
      .where(sql`${t.status} = 'idle'`),
    index('drivers_refresh_token_idx')
      .on(t.refreshToken)
      .where(sql`${t.refreshToken} IS NOT NULL`),
    index('drivers_employee_id_idx')
      .on(t.employeeId)
      .where(sql`${t.employeeId} IS NOT NULL`),
  ],
);

export const ridersAuth = pgTable('riders_auth', {
  id: uuid('id').primaryKey().defaultRandom(),
  riderId: uuid('rider_id')
    .notNull()
    .references(() => riders.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  driverId: uuid('driver_id')
    .notNull()
    .references(() => drivers.id, { onDelete: 'cascade' }),
  make: text('make').notNull(),
  model: text('model').notNull(),
  year: integer('year').notNull(),
  color: text('color').notNull(),
  plate: text('plate').notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const rides = pgTable(
  'rides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.id),
    driverId: uuid('driver_id').references(() => drivers.id),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id),
    status: rideStatusEnum('status').notNull().default('requested'),
    pickupLat: doublePrecision('pickup_lat').notNull(),
    pickupLng: doublePrecision('pickup_lng').notNull(),
    pickupAddress: text('pickup_address').notNull(),
    dropoffLat: doublePrecision('dropoff_lat').notNull(),
    dropoffLng: doublePrecision('dropoff_lng').notNull(),
    dropoffAddress: text('dropoff_address').notNull(),
    // PostGIS columns — managed via raw SQL migration; typed as text here for Drizzle compat
    pickupGeog: text('pickup_geog'),
    dropoffGeog: text('dropoff_geog'),
    distanceKm: doublePrecision('distance_km'),
    durationMin: integer('duration_min'),
    fareEstimate: numeric('fare_estimate', { precision: 8, scale: 2 }),
    fareFinal: numeric('fare_final', { precision: 8, scale: 2 }),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at'),
    pickedUpAt: timestamp('picked_up_at'),
    droppedOffAt: timestamp('dropped_off_at'),
    cancelledAt: timestamp('cancelled_at'),
    cancelReason: text('cancel_reason'),
    searchExpiresAt: timestamp('search_expires_at'),
    rejectedDriverIds: text('rejected_driver_ids'), // UUID[] stored as text for Drizzle compat
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('rides_status_idx')
      .on(t.status)
      .where(
        sql`${t.status} IN ('requested', 'searching_driver', 'driver_assigned', 'accepted', 'en_route', 'in_progress')`,
      ),
    index('rides_rider_id_idx').on(t.riderId, t.createdAt),
    index('rides_driver_id_idx').on(t.driverId, t.createdAt),
    index('rides_company_id_idx').on(t.companyId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id),
    riderId: uuid('rider_id')
      .notNull()
      .references(() => riders.id),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    stripePiId: text('stripe_pi_id'),
    stripePmId: text('stripe_pm_id'),
    commissionAmount: numeric('commission_amount', { precision: 10, scale: 2 }),
    capturedAt: timestamp('captured_at'),
    refundedAt: timestamp('refunded_at'),
    failureReason: text('failure_reason'),
    failedAt: timestamp('failed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payments_ride_id_idx').on(t.rideId),
    index('payments_rider_id_idx').on(t.riderId),
    index('payments_status_idx').on(t.status),
    index('payments_company_id_idx').on(t.companyId),
  ],
);

// ── Trip Offers ────────────────────────────────────────────────────────────

export const tripOffers = pgTable(
  'trip_offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    status: tripOfferStatusEnum('status').notNull().default('pending'),
    offeredAt: timestamp('offered_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    respondedAt: timestamp('responded_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('trip_offers_ride_id_idx').on(t.rideId),
    index('trip_offers_driver_id_idx').on(t.driverId),
    index('trip_offers_company_id_idx').on(t.companyId),
    index('trip_offers_pending_idx')
      .on(t.status, t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// ── Pricing Engine ──────────────────────────────────────────────────────────

export const pricingRules = pgTable('pricing_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' })
    .unique(),
  baseRatePerMile: numeric('base_rate_per_mile', { precision: 8, scale: 2 })
    .notNull()
    .default('3.00'),
  minimumFare: numeric('minimum_fare', { precision: 8, scale: 2 }).notNull().default('7.00'),
  perMinuteRate: numeric('per_minute_rate', { precision: 8, scale: 2 }).notNull().default('0.20'),
  currency: char('currency', { length: 3 }).notNull().default('USD'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const zoneMinimums = pgTable(
  'zone_minimums',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    zoneName: text('zone_name').notNull(),
    minimumFare: numeric('minimum_fare', { precision: 8, scale: 2 }).notNull(),
    // PostGIS polygon — managed via raw SQL; typed as text for Drizzle compat
    boundaryPolygon: text('boundary_polygon'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('zone_minimums_company_id_idx').on(t.companyId)],
);

export const fixedRoutes = pgTable(
  'fixed_routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name'),
    originLat: doublePrecision('origin_lat').notNull(),
    originLng: doublePrecision('origin_lng').notNull(),
    destLat: doublePrecision('dest_lat').notNull(),
    destLng: doublePrecision('dest_lng').notNull(),
    // PostGIS geography columns — managed via trigger in SQL migration
    originGeog: text('origin_geog'),
    destGeog: text('dest_geog'),
    radiusMeters: integer('radius_meters').notNull().default(500),
    fixedPrice: numeric('fixed_price', { precision: 8, scale: 2 }).notNull(),
    // Dynamic pricing preparation (defaults to static/off)
    isDynamicEnabled: boolean('is_dynamic_enabled').notNull().default(false),
    basePrice: numeric('base_price', { precision: 8, scale: 2 }),
    rulesConfig: jsonb('rules_config').notNull().default({}),
    // Operational metadata
    note: text('note'),
    isActive: boolean('is_active').notNull().default(true),
    // Migration tracking
    legacySupabaseId: text('legacy_supabase_id').unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('fixed_routes_company_id_idx').on(t.companyId)],
);

// ── Commissions ────────────────────────────────────────────────────────────

export const commissions = pgTable(
  'commissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    fareAmount: numeric('fare_amount', { precision: 10, scale: 2 }).notNull(),
    commissionPercent: numeric('commission_percent', { precision: 5, scale: 2 }).notNull(),
    commissionAmount: numeric('commission_amount', { precision: 10, scale: 2 }).notNull(),
    driverEarnings: numeric('driver_earnings', { precision: 10, scale: 2 }).notNull(),
    stripeTransferId: text('stripe_transfer_id'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('commissions_company_id_idx').on(t.companyId),
    index('commissions_driver_id_idx').on(t.driverId),
    index('commissions_ride_id_idx').on(t.rideId),
  ],
);

// ── Stripe Webhook Events ─────────────────────────────────────────────────

export const stripeWebhookEvents = pgTable('stripe_webhook_events', {
  id: text('id').primaryKey(), // Stripe event ID (evt_xxx)
  type: text('type').notNull(),
  processedAt: timestamp('processed_at').notNull().defaultNow(),
  companyId: uuid('company_id').references(() => companies.id),
});

// ── Ratings ───────────────────────────────────────────────────────────────────

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    rideId: uuid('ride_id')
      .notNull()
      .references(() => rides.id, { onDelete: 'cascade' }),
    fromDriverId: uuid('from_driver_id').references(() => drivers.id),
    fromRiderId: uuid('from_rider_id').references(() => riders.id),
    toDriverId: uuid('to_driver_id').references(() => drivers.id),
    toRiderId: uuid('to_rider_id').references(() => riders.id),
    score: integer('score').notNull(), // 1-5 stars
    comment: text('comment'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('ratings_ride_id_idx').on(t.rideId),
    index('ratings_to_driver_id_idx').on(t.toDriverId),
    index('ratings_to_rider_id_idx').on(t.toRiderId),
    index('ratings_company_id_idx').on(t.companyId),
  ],
);

// ── Driver Metrics ─────────────────────────────────────────────────────────

export const driverMetrics = pgTable(
  'driver_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    eventType: text('event_type').notNull(), // cancellation, completion, timeout, rejection
    rideId: uuid('ride_id').references(() => rides.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('driver_metrics_driver_idx').on(t.driverId),
    index('driver_metrics_company_idx').on(t.companyId),
    index('driver_metrics_driver_type_window_idx').on(t.driverId, t.eventType, t.createdAt),
  ],
);

// ── Admins ──────────────────────────────────────────────────────────────────

export const admins = pgTable('admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => companies.id),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: adminRoleEnum('role').notNull().default('viewer'),
  isActive: boolean('is_active').notNull().default(true),
  // Migration tracking
  legacySupabaseId: text('legacy_supabase_id').unique(),
  updatedBy: uuid('updated_by'),
  migrationSource: migrationSourceEnum('migration_source'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ── Employees (HR / office staff — dispatchers, admin personnel) ─────────────

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    adminId: uuid('admin_id').references(() => admins.id),
    employeeCode: text('employee_code'),
    fullName: text('full_name').notNull(),
    hourlyRate: numeric('hourly_rate', { precision: 8, scale: 2 }).notNull().default('0'),
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: timestamp('deactivated_at'),
    // Migration tracking
    legacySupabaseId: text('legacy_supabase_id').unique(),
    updatedBy: uuid('updated_by'),
    migrationSource: migrationSourceEnum('migration_source'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('employees_company_id_idx').on(t.companyId),
    index('employees_admin_id_idx')
      .on(t.adminId)
      .where(sql`${t.adminId} IS NOT NULL`),
    index('employees_active_idx')
      .on(t.companyId, t.isActive)
      .where(sql`${t.isActive} = true`),
  ],
);

// ── Time Entries (hour tracking — payroll, immutable history) ─────────────────

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    // ON DELETE RESTRICT: never cascade-delete time entries.
    // HR/payroll data must be immutable for audits and labor compliance.
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time'),
    notes: text('notes'),
    // Migration tracking
    legacySupabaseId: text('legacy_supabase_id').unique(),
    updatedBy: uuid('updated_by'),
    migrationSource: migrationSourceEnum('migration_source'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('time_entries_company_id_idx').on(t.companyId),
    index('time_entries_employee_id_idx').on(t.employeeId),
    index('time_entries_date_range_idx').on(t.employeeId, t.startTime),
    index('time_entries_company_period_idx').on(t.companyId, t.startTime),
  ],
);
