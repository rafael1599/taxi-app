import { Pool } from 'pg';

/**
 * Supabase (Control de Horas) — read-only connection pool.
 * Uses SUPABASE_DATABASE_URL from .env.
 */
const supabaseConnectionString = process.env.SUPABASE_DATABASE_URL;

if (!supabaseConnectionString) {
  console.warn('⚠️  SUPABASE_DATABASE_URL not set — legacy data endpoints will be unavailable');
}

export const supabasePool = supabaseConnectionString
  ? new Pool({
      connectionString: supabaseConnectionString,
      max: 5, // Low pool — read-only, secondary DB
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false }, // Supabase requires SSL
    })
  : null;

/**
 * Execute a raw SQL query against the Supabase DB.
 * Returns rows or throws if the pool is not configured.
 */
export async function supabaseQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (!supabasePool) {
    throw new Error('Supabase connection not configured (SUPABASE_DATABASE_URL missing)');
  }
  const result = await supabasePool.query(text, params);
  return result.rows as T[];
}

/**
 * Gracefully close the Supabase pool.
 */
export async function closeSupabasePool(): Promise<void> {
  if (supabasePool) {
    await supabasePool.end();
  }
}
