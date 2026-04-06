/**
 * Phase 1 — Migrate Supabase Users → local admins table
 *
 * What this does:
 *   1. Reads all Users from Supabase (with Employee LEFT JOIN for full_name)
 *   2. Ensures the Excellent Car Service company exists in local DB
 *   3. Inserts each User as an admin in the local DB
 *   4. Copies bcrypt hashes byte-for-byte (no re-hashing)
 *   5. Tracks legacy IDs for traceability
 *
 * Safe to run multiple times (skips existing emails).
 * Does NOT modify Supabase — read-only access.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-supabase-admins.ts
 */

import { db, pool } from '../src/client.js';
import { supabaseQuery, closeSupabasePool } from '../src/supabaseClient.js';
import { admins, companies } from '../src/schema/index.js';
import { eq } from 'drizzle-orm';

// ── Supabase row types ──────────────────────────────────────────────────────

interface SupabaseUser {
  id: string;
  email: string;
  password_hash: string;
  role: 'PLATFORM_ADMIN' | 'COMPANY_ADMIN' | 'EMPLOYEE';
  isActive: boolean;
  companyId: string;
  createdAt: string;
  full_name: string | null;
}

interface SupabaseCompany {
  id: string;
  company_name: string;
  displayName: string | null;
  logoUrl: string | null;
  createdAt: string;
}

// ── Role mapping ────────────────────────────────────────────────────────────

const ROLE_MAP: Record<string, 'platform_admin' | 'company_admin' | 'viewer'> = {
  PLATFORM_ADMIN: 'platform_admin',
  COMPANY_ADMIN: 'company_admin',
  EMPLOYEE: 'viewer',
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Phase 1: Migrate Supabase Users → Local Admins        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // 1. Read Company from Supabase
  console.log('① Reading Company from Supabase...');
  const supabaseCompanies = await supabaseQuery<SupabaseCompany>(
    `SELECT id, company_name, "displayName", "logoUrl", "createdAt" FROM "Company"`,
  );

  if (supabaseCompanies.length === 0) {
    console.error('❌ No companies found in Supabase. Aborting.');
    process.exit(1);
  }

  const supabaseCompany = supabaseCompanies[0];
  console.log(`   Found: "${supabaseCompany.company_name}" (${supabaseCompany.id})\n`);

  // 2. Ensure Company exists in local DB
  console.log('② Ensuring Company exists in local DB...');
  const existingCompanies = await db
    .select()
    .from(companies)
    .where(eq(companies.slug, 'excellent-car-service'));

  let localCompanyId: string;

  if (existingCompanies.length > 0) {
    localCompanyId = existingCompanies[0].id;
    console.log(`   Already exists: ${localCompanyId}\n`);
  } else {
    const [inserted] = await db
      .insert(companies)
      .values({
        name: supabaseCompany.company_name,
        slug: 'excellent-car-service',
        logo: supabaseCompany.logoUrl,
        isActive: true,
        settings: {},
        createdAt: new Date(supabaseCompany.createdAt),
        updatedAt: new Date(supabaseCompany.createdAt),
      })
      .returning();
    localCompanyId = inserted.id;
    console.log(`   Created: ${localCompanyId}\n`);
  }

  // 3. Read Users from Supabase (with Employee join for full_name)
  console.log('③ Reading Users from Supabase...');
  const users = await supabaseQuery<SupabaseUser>(
    `SELECT u.id, u.email, u.password_hash, u.role, u."isActive", u."companyId",
            u."createdAt", e.full_name
     FROM "User" u
     LEFT JOIN "Employee" e ON e."userId" = u.id
     ORDER BY u."createdAt"`,
  );
  console.log(`   Found ${users.length} users\n`);

  // 4. Insert each User as admin in local DB
  console.log('④ Migrating Users → Admins...\n');

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    // Check if already migrated (by email)
    const existing = await db.select().from(admins).where(eq(admins.email, user.email));

    if (existing.length > 0) {
      console.log(`   skip  ${user.email} (already exists as ${existing[0].id})`);
      skipped++;
      continue;
    }

    const adminRole = ROLE_MAP[user.role] ?? 'viewer';
    const fullName = user.full_name ?? user.email.split('@')[0];

    // For platform_admin, companyId is nullable
    const companyId = adminRole === 'platform_admin' ? null : localCompanyId;

    const [inserted] = await db
      .insert(admins)
      .values({
        fullName: fullName,
        email: user.email,
        passwordHash: user.password_hash, // bcrypt hash copied byte-for-byte
        role: adminRole,
        companyId: companyId,
        isActive: user.isActive,
        legacySupabaseId: user.id,
        migrationSource: 'migration_script',
        updatedBy: null,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(),
      })
      .returning();

    console.log(`   ✓ ${user.email} → ${adminRole} (${inserted.id}) [legacy: ${user.id}]`);
    migrated++;
  }

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  Results: ${migrated} migrated, ${skipped} skipped                     ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  // 5. Verify
  console.log('⑤ Verification...');
  const allAdmins = await db.select().from(admins);
  console.log(`   Local admins table: ${allAdmins.length} rows`);

  const withLegacy = allAdmins.filter((a) => a.legacySupabaseId);
  console.log(`   With legacy_supabase_id: ${withLegacy.length}`);

  for (const a of allAdmins) {
    console.log(
      `   - ${a.email} | role=${a.role} | active=${a.isActive} | legacy=${a.legacySupabaseId ?? 'none'}`,
    );
  }

  console.log('\n✅ Phase 1 migration complete.');
  console.log('   Next: Update adminAuth.ts to query local admins table.\n');
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
