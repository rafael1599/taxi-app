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
  'accepted',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
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
    passwordHash: text('password_hash').notNull(),
    licenseNumber: text('license_number').notNull().unique(),
    tlcLicense: text('tlc_license'),
    stripeAccountId: text('stripe_acct'),
    isActive: boolean('is_active').notNull().default(true),
    isAvailable: boolean('is_available').notNull().default(false),
    currentLat: doublePrecision('current_lat'),
    currentLng: doublePrecision('current_lng'),
    locationAt: timestamp('location_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('drivers_available_idx')
      .on(t.isAvailable, t.isActive)
      .where(sql`${t.isAvailable} = true AND ${t.isActive} = true`),
    index('drivers_company_id_idx').on(t.companyId),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('rides_status_idx')
      .on(t.status)
      .where(sql`${t.status} IN ('requested', 'accepted', 'in_progress')`),
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
    capturedAt: timestamp('captured_at'),
    refundedAt: timestamp('refunded_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payments_ride_id_idx').on(t.rideId),
    index('payments_rider_id_idx').on(t.riderId),
    index('payments_status_idx').on(t.status),
    index('payments_company_id_idx').on(t.companyId),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [index('fixed_routes_company_id_idx').on(t.companyId)],
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
