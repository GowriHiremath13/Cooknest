
require('dotenv').config({ override: true });

const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    for (const table of ['categories', 'users', 'ingredients']) {
      const result = await client.query(
        `SELECT * FROM public.${table} ORDER BY 1 LIMIT 40`
      );

      console.log(`\n--- ${table} ---`);
      console.table(result.rows);
    }
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('CHECK FAILED:', error.message);
  process.exitCode = 1;
});
