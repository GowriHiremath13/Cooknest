
require('dotenv').config();

const { Pool } = require('pg');

const db = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'cooknest',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
});

const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

async function getMealDBImage(title) {
  try {
    const q = encodeURIComponent(title);
    const response = await fetch(
      `https://www.themealdb.com/api/json/v1/1/search.php?s=${q}`
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.meals?.[0]?.strMealThumb || null;
  } catch {
    return null;
  }
}

async function getUnsplashImage(title) {
  if (!UNSPLASH_KEY) return null;

  try {
    const q = encodeURIComponent(`${title} food dish`);
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${q}&per_page=1&orientation=landscape`,
      {
        headers: {
          Authorization: `Client-ID ${UNSPLASH_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`Unsplash returned HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.results?.[0]?.urls?.regular || null;
  } catch {
    return null;
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function updateMissingImages() {
  try {
    const result = await db.query(`
      SELECT recipe_id, title
      FROM recipes
      WHERE image_url IS NULL OR BTRIM(image_url) = ''
      ORDER BY recipe_id
    `);

    console.log(`Found ${result.rows.length} recipes without images.\n`);

    let success = 0;
    let failed = 0;

    for (const recipe of result.rows) {
      let url = await getMealDBImage(recipe.title);
      let source = 'TheMealDB';

      if (!url) {
        url = await getUnsplashImage(recipe.title);
        source = 'Unsplash';
      }

      if (url) {
        await db.query(
          `UPDATE recipes SET image_url = $1 WHERE recipe_id = $2`,
          [url, recipe.recipe_id]
        );

        console.log(
          `✓ [${recipe.recipe_id}] ${recipe.title} (${source})`
        );
        success++;
      } else {
        console.log(`✗ [${recipe.recipe_id}] ${recipe.title}`);
        failed++;
      }

      await delay(300);
    }

    console.log(`\nDone! ${success} updated; ${failed} not found.`);
  } catch (error) {
    console.error('Image update failed:', error.message);
  } finally {
    await db.end();
  }
}

updateMissingImages();
