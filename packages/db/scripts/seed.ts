import { Client } from 'pg';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

async function run() {
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/rockland_taxi';
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Ensure the default test company exists
    const { rows } = await client.query('SELECT id FROM companies WHERE id = $1', [
      DEFAULT_COMPANY_ID,
    ]);

    if (rows.length === 0) {
      await client.query(
        `INSERT INTO companies (id, name, slug, settings)
         VALUES ($1, $2, $3, $4)`,
        [
          DEFAULT_COMPANY_ID,
          'Rockland Taxi',
          'rockland-taxi',
          JSON.stringify({
            baseFareUsd: 3.0,
            perKmUsd: 1.75,
            perMinUsd: 0.35,
            minimumFareUsd: 7.0,
          }),
        ],
      );
      console.log('  Created default company: Rockland Taxi');
    } else {
      console.log('  Default company already exists');
    }

    console.log('Seed complete.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
