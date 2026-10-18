
require('dotenv').config({ override: true });
const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const sql = fs.readFileSync(
    'G:\\cooking\\bulk_recipes_postgres.sql',
    'utf8'
  );

  const referenced = new Set(
    [...sql.matchAll(/FROM Ingredients WHERE name = '((?:[^']|'')*)'/gi)]
      .map(m => m[1].replace(/''/g, "'"))
  );

  // Extract ingredient names from INSERT INTO Ingredients (name, unit)
  const inserted = new Set();
  const blocks = sql.matchAll(
    /INSERT INTO Ingredients\s*\(\s*name\s*,\s*unit\s*\)\s*VALUES\s*([\s\S]*?);/gi
  );

  for (const block of blocks) {
    for (const match of block[1].matchAll(
      /\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*\)/g
    )) {
      inserted.add(match[1].replace(/''/g, "'"));
    }
  }

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
    const result = await client.query(
      'SELECT name FROM public.ingredients'
    );

    const available = new Set([
      ...result.rows.map(row => row.name),
      ...inserted,
    ]);

    const missing = [...referenced].filter(name => !available.has(name));

    console.log('Unique referenced names:', referenced.size);
    console.log('Names inserted by bulk SQL:', inserted.size);
    console.log('Names available after import:', available.size);
    console.log('Names still missing:', missing.length);

    if (missing.length) console.log(missing.slice(0, 80));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('CHECK FAILED:', error.message);
  process.exitCode = 1;
});
