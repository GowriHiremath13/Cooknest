
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
    const tables = [
      'recipes',
      'ingredients',
      'recipe_ingredients',
      'nutrition',
      'categories',
      'users',
    ];

    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS total FROM public.${table}`
      );
      console.log(`${table}: ${result.rows[0].total}`);
    }

    const links = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM public.recipe_ingredients ri
      JOIN public.recipes r ON r.recipe_id = ri.recipe_id
      JOIN public.ingredients i ON i.ingredient_id = ri.ingredient_id
    `);

    console.log('Valid recipe-ingredient links:', links.rows[0].total);

    const missing = await client.query(`
      SELECT COUNT(*)::int AS total
      FROM public.recipes r
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.recipe_ingredients ri
        WHERE ri.recipe_id = r.recipe_id
      )
    `);

    console.log('Recipes without ingredients:', missing.rows[0].total);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('VERIFICATION FAILED:', error.message);
  process.exitCode = 1;
});
