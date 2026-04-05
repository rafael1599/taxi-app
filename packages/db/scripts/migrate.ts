import { Client } from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/migrations');

async function run() {
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rockland_taxi';
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Track applied migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE filename = $1', [file]);
      if (rows.length > 0) {
        console.log(`  skip  ${file}`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

      // ALTER TYPE ... ADD VALUE cannot be used inside a transaction
      // (new enum values must be committed before use). Extract these
      // statements and run them before the transactional block.
      const enumAddValueRe = /^ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE\b[^;]*;/gim;
      const enumStatements = sql.match(enumAddValueRe) || [];
      const remainingSql = sql.replace(enumAddValueRe, '').trim();

      try {
        for (const stmt of enumStatements) {
          await client.query(stmt);
        }
        await client.query('BEGIN');
        if (remainingSql) {
          await client.query(remainingSql);
        }
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  apply ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations complete.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
