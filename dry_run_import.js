
require('dotenv').config({ override: true });

const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const filePath = 'G:\\cooking\\bulk_recipes_postgres.sql';

  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filePath}`);
  }

  const sql = fs.readFileSync(filePath, 'utf8');

  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    console.log('Testing the SQL import...');
    await client.query(sql);

    const result = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM public.recipes) AS recipes,
        (SELECT COUNT(*) FROM public.ingredients) AS ingredients,
        (SELECT COUNT(*) FROM public.recipe_ingredients) AS recipe_ingredients,
        (SELECT COUNT(*) FROM public.nutrition) AS nutrition
    `);

    console.table(result.rows);

    await client.query('ROLLBACK');
    console.log('DRY RUN PASSED — all test changes were rolled back.');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {}

    console.error('DRY RUN FAILED:', error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('CONNECTION FAILED:', error.message);
  process.exitCode = 1;
});
