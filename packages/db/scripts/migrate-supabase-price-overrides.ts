/**
 * Phase 2a — Migrate Supabase PriceOverrides → local fixed_routes table
 *
 * What this does:
 *   1. Reads all PriceOverrides from Supabase
 *   2. Resolves the local company_id for Excellent Car Service
 *   3. Inserts each PriceOverride as a fixed_route in local DB
 *   4. Converts radiusMiles → radiusMeters (× 1609.34)
 *   5. Maps: originLabel+destLabel → name, price → fixedPrice
 *   6. Tracks legacy IDs in legacy_supabase_id
 *
 * Safe to run multiple times (skips existing legacy IDs).
 * Does NOT modify Supabase — read-only access.
 *
 * Usage:
 *   pnpm --filter @drivly/db migrate:price-overrides
 */

import { db, pool } from '../src/client.js';
import { supabaseQuery, closeSupabasePool } from '../src/supabaseClient.js';
import { fixedRoutes, companies } from '../src/schema/index.js';
import { eq } from 'drizzle-orm';

// ── Supabase row type ──────────────────────────────────────────────────────

interface SupabasePriceOverride {
  id: string;
  originLabel: string;
  destLabel: string;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  price: number;
  radiusMiles: number;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

const MILES_TO_METERS = 1609.34;

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Phase 2a: Migrate PriceOverrides → Fixed Routes       ║');
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

  // 2. Read PriceOverrides from Supabase
  console.log('② Reading PriceOverrides from Supabase...');
  const overrides = await supabaseQuery<SupabasePriceOverride>(`
    SELECT
      id, "originLabel", "destLabel",
      "originLat", "originLng", "destLat", "destLng",
      price, "radiusMiles", "isActive", note,
      "createdAt", "updatedAt"
    FROM "PriceOverride"
    ORDER BY "originLabel", "destLabel"
  `);
  console.log(`   Found ${overrides.length} price overrides\n`);

  if (overrides.length === 0) {
    console.log('   Nothing to migrate.\n');
    return;
  }

  // 3. Insert each PriceOverride as fixed_route
  console.log('③ Migrating PriceOverrides → Fixed Routes...\n');

  let migrated = 0;
  let skipped = 0;

  for (const po of overrides) {
    // Check if already migrated (by legacy ID)
    const existing = await db
      .select()
      .from(fixedRoutes)
      .where(eq(fixedRoutes.legacySupabaseId, po.id));

    if (existing.length > 0) {
      console.log(`   skip  "${po.originLabel} → ${po.destLabel}" (already migrated)`);
      skipped++;
      continue;
    }

    const name = `${po.originLabel} → ${po.destLabel}`;
    const radiusMeters = Math.round(po.radiusMiles * MILES_TO_METERS);

    const [inserted] = await db
      .insert(fixedRoutes)
      .values({
        companyId: company.id,
        name,
        originLat: po.originLat,
        originLng: po.originLng,
        destLat: po.destLat,
        destLng: po.destLng,
        radiusMeters,
        fixedPrice: String(po.price),
        isActive: po.isActive,
        note: po.note,
        legacySupabaseId: po.id,
        createdAt: new Date(po.createdAt),
        updatedAt: new Date(po.updatedAt),
      })
      .returning();

    console.log(
      `   ✓ "${name}" | $${po.price} | ${po.radiusMiles}mi → ${radiusMeters}m | active=${po.isActive} (${inserted.id})`,
    );
    migrated++;
  }

  // 4. Verify
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(
    `║  Results: ${migrated} migrated, ${skipped} skipped${' '.repeat(Math.max(0, 25 - String(migrated).length - String(skipped).length))}║`,
  );
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  console.log('④ Verification...');
  const allRoutes = await db.select().from(fixedRoutes);
  console.log(`   Local fixed_routes table: ${allRoutes.length} rows`);

  const withLegacy = allRoutes.filter((r) => r.legacySupabaseId);
  console.log(`   With legacy_supabase_id: ${withLegacy.length}`);

  for (const r of allRoutes) {
    console.log(
      `   - ${r.name ?? 'unnamed'} | $${r.fixedPrice} | ${r.radiusMeters}m | active=${r.isActive} | legacy=${r.legacySupabaseId ?? 'none'}`,
    );
  }

  console.log('\n✅ Phase 2a migration complete.');
  console.log('   Price overrides are now available via /api/v1/pricing/fixed-routes\n');
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
