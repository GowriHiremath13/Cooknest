
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
    await client.query(sql);
    await client.query(`SELECT setval(pg_get_serial_sequence('public.recipes','recipe_id'), (SELECT MAX(recipe_id) FROM public.recipes), true)`);
await client.query(`SELECT setval(pg_get_serial_sequence('public.ingredients','ingredient_id'), (SELECT MAX(ingredient_id) FROM public.ingredients), true)`);
    await client.query('COMMIT');
    console.log('SUCCESS: Bulk recipe import completed!');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('IMPORT FAILED:', error.message);
  process.exitCode = 1;
});
