
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

  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        c.table_name,
        c.column_name,
        pg_get_serial_sequence(
          'public.' || c.table_name,
          c.column_name
        ) AS sequence_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name IN (
          'recipes',
          'ingredients',
          'categories',
          'nutrition'
        )
        AND c.column_default LIKE 'nextval%'
      ORDER BY c.table_name;
    `);

    console.table(result.rows);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
