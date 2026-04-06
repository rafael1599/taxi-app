/**
 * Phase 2b — Migrate Supabase Drivers → local drivers table
 *
 * What this does:
 *   1. Reads all Drivers from Supabase (with Company join)
 *   2. Resolves the local company_id for Excellent Car Service
 *   3. Inserts each Driver in the local DB
 *   4. Supabase drivers have NO email/password — they use WhatsApp OTP
 *   5. Creates a placeholder email (phone@driver.local) for the NOT NULL constraint
 *   6. Creates matching vehicle records for plate+vehicle info
 *   7. Tracks legacy IDs in legacy_supabase_id
 *
 * Safe to run multiple times (skips existing legacy IDs).
 * Does NOT modify Supabase — read-only access.
 *
 * Usage:
 *   pnpm --filter @drivly/db migrate:drivers
 */

import { db, pool } from '../src/client.js';
import { supabaseQuery, closeSupabasePool } from '../src/supabaseClient.js';
import { drivers, vehicles, companies } from '../src/schema/index.js';
import { eq } from 'drizzle-orm';

// ── Supabase row type ──────────────────────────────────────────────────────

interface SupabaseDriver {
  id: string;
  name: string;
  phone: string;
  plate: string | null;
  vehicle: string | null;
  isActive: boolean;
  isOnline: boolean;
  lastLocationLat: number | null;
  lastLocationLng: number | null;
  lastLocationAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Phase 2b: Migrate Supabase Drivers → Local Drivers    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // 1. Get local company ID
  console.log('① Resolving local company...');
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, 'excellent-car-service'));

  if (!company) {
    console.error('❌ Company "excellent-car-service" not found in local DB.');
    console.error('   Run Phase 1 migration first: pnpm db:migrate-admins');
    process.exit(1);
  }

  console.log(`   Found: "${company.name}" (${company.id})\n`);

  // 2. Read Drivers from Supabase
  console.log('② Reading Drivers from Supabase...');
  const supabaseDrivers = await supabaseQuery<SupabaseDriver>(`
    SELECT
      d.id, d.name, d.phone, d.plate, d.vehicle,
      d."isActive", d."isOnline",
      d."lastLocationLat", d."lastLocationLng", d."lastLocationAt",
      d."createdAt", d."updatedAt"
    FROM "Driver" d
    ORDER BY d.name
  `);
  console.log(`   Found ${supabaseDrivers.length} drivers\n`);

  if (supabaseDrivers.length === 0) {
    console.log('   Nothing to migrate.\n');
    return;
  }

  // 3. Insert each Driver
  console.log('③ Migrating Drivers...\n');

  let migrated = 0;
  let skipped = 0;
  let vehiclesCreated = 0;

  for (const sd of supabaseDrivers) {
    // Check if already migrated (by legacy ID)
    const existingByLegacy = await db
      .select()
      .from(drivers)
      .where(eq(drivers.legacySupabaseId, sd.id));

    if (existingByLegacy.length > 0) {
      console.log(`   skip  "${sd.name}" (already migrated as ${existingByLegacy[0].id})`);
      skipped++;
      continue;
    }

    // Also check by phone (avoid unique constraint violation)
    const existingByPhone = await db.select().from(drivers).where(eq(drivers.phone, sd.phone));

    if (existingByPhone.length > 0) {
      console.log(
        `   skip  "${sd.name}" (phone ${sd.phone} already exists as ${existingByPhone[0].id})`,
      );
      skipped++;
      continue;
    }

    // Supabase drivers don't have email — create placeholder
    // The phone is their primary identifier (OTP auth)
    const cleanPhone = sd.phone.replace(/[^+\d]/g, '');
    const placeholderEmail = `${cleanPhone}@driver.local`;

    // Supabase drivers don't have license numbers — use a placeholder
    // that will need to be updated when they log in / verify
    const placeholderLicense = `PENDING-${cleanPhone}`;

    const [inserted] = await db
      .insert(drivers)
      .values({
        companyId: company.id,
        fullName: sd.name,
        phone: sd.phone,
        email: placeholderEmail,
        passwordHash: null, // OTP-only driver, no password
        licenseNumber: placeholderLicense,
        isActive: sd.isActive,
        isAvailable: false, // Start offline after migration
        status: 'offline',
        currentLat: sd.lastLocationLat,
        currentLng: sd.lastLocationLng,
        locationAt: sd.lastLocationAt ? new Date(sd.lastLocationAt) : null,
        phoneVerified: true, // They already use WhatsApp, phone is verified
        otpChannel: 'whatsapp',
        legacySupabaseId: sd.id,
        updatedBy: null,
        createdAt: new Date(sd.createdAt),
        updatedAt: new Date(sd.updatedAt),
      })
      .returning();

    console.log(
      `   ✓ "${sd.name}" | ${sd.phone} | active=${sd.isActive} (${inserted.id}) [legacy: ${sd.id}]`,
    );
    migrated++;

    // 4. If driver has vehicle info, create a vehicle record
    if (sd.plate) {
      const existingVehicle = await db.select().from(vehicles).where(eq(vehicles.plate, sd.plate));

      if (existingVehicle.length === 0) {
        // Parse vehicle string (e.g., "Toyota Camry 2020" or just "Camry")
        const vehicleParts = (sd.vehicle ?? 'Unknown Unknown').split(' ');
        const make = vehicleParts[0] ?? 'Unknown';
        const model = vehicleParts.slice(1, -1).join(' ') || vehicleParts[1] || 'Unknown';
        const yearStr = vehicleParts[vehicleParts.length - 1];
        const year = /^\d{4}$/.test(yearStr) ? Number(yearStr) : 2020;

        await db.insert(vehicles).values({
          companyId: company.id,
          driverId: inserted.id,
          make,
          model: model || 'Unknown',
          year,
          color: 'Unknown', // Not in Supabase data
          plate: sd.plate,
        });

        console.log(`     + Vehicle: ${sd.vehicle ?? 'N/A'} | plate: ${sd.plate}`);
        vehiclesCreated++;
      }
    }
  }

  // 5. Verify
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(
    `║  Results: ${migrated} drivers, ${vehiclesCreated} vehicles, ${skipped} skipped          ║`,
  );
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  console.log('④ Verification...');
  const allDrivers = await db.select().from(drivers);
  console.log(`   Local drivers table: ${allDrivers.length} rows`);

  const withLegacy = allDrivers.filter((d) => d.legacySupabaseId);
  console.log(`   With legacy_supabase_id: ${withLegacy.length}`);

  for (const d of allDrivers) {
    console.log(
      `   - ${d.fullName} | ${d.phone} | active=${d.isActive} | OTP=${d.otpChannel ?? 'none'} | legacy=${d.legacySupabaseId ?? 'none'}`,
    );
  }

  console.log('\n✅ Phase 2b migration complete.');
  console.log('   Drivers can now authenticate via OTP (POST /auth/driver/otp/login)\n');
}

main()
  .catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeSupabasePool();
    await pool.end();
  });
