
require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');

const db = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'cooknest',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
});

function getCategory(meal) {
  const cat = (meal.strCategory || '').toLowerCase();

  if (cat.includes('breakfast') || cat.includes('starter')) return 1;
  if (cat.includes('side') || cat.includes('miscellaneous')) return 2;
  if (
    cat.includes('dessert') ||
    cat.includes('cake') ||
    cat.includes('pastry')
  ) return 5;

  return 3;
}

function getDifficulty(count, steps) {
  if (count <= 5 || steps <= 3) return 'easy';
  if (count <= 12 || steps <= 6) return 'medium';
  return 'hard';
}

function getCookTime(instructions) {
  const words = (instructions || '').split(/\s+/).filter(Boolean).length;
  if (words < 80) return 15;
  if (words < 200) return 30;
  if (words < 400) return 45;
  return 60;
}

function getNutrition(count) {
  return {
    calories: 150 + count * 25,
    protein: 15,
    fat: 10,
    carbs: 30,
  };
}

function getIngredients(meal) {
  const result = [];

  for (let i = 1; i <= 20; i++) {
    const name = (meal[`strIngredient${i}`] || '').trim();
    const measure = (meal[`strMeasure${i}`] || '').trim();

    if (name && name.toLowerCase() !== 'null') {
      result.push({ name, measure });
    }
  }

  return result;
}

async function main() {
  const file = 'themealdb_recipes.json';

  if (!fs.existsSync(file)) {
    throw new Error(
      'themealdb_recipes.json is missing. Run node fetch_recipes.js first.'
    );
  }

  const meals = JSON.parse(fs.readFileSync(file, 'utf8'));

  console.log(`Loaded ${meals.length} meals.`);
  console.log('Importing into PostgreSQL without deleting existing recipes.');

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (const meal of meals) {
    const title = (meal.strMeal || '').trim();
    const ingredients = getIngredients(meal);

    if (!title || ingredients.length === 0) {
      skipped++;
      continue;
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT recipe_id FROM recipes WHERE LOWER(title) = LOWER($1) LIMIT 1',
        [title]
      );

      if (existing.rows.length) {
        await client.query('ROLLBACK');
        skipped++;
        continue;
      }

      const instructions = (meal.strInstructions || '').trim();
      const steps = instructions.split(/\n/).filter(line => line.trim()).length;
      const difficulty = getDifficulty(ingredients.length, steps);
      const categoryId = getCategory(meal);
      const cuisine = meal.strArea || 'Other';
      const cookTime = getCookTime(instructions);

      const recipeResult = await client.query(
        `INSERT INTO recipes
          (title, instructions, cuisine, cook_time_mins, difficulty,
           category_id, submitted_by, status, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING recipe_id`,
        [
          title,
          instructions || null,
          cuisine,
          cookTime,
          difficulty,
          categoryId,
          1,
          'approved',
          meal.strMealThumb || null,
        ]
      );

      const recipeId = recipeResult.rows[0].recipe_id;

      for (const item of ingredients) {
        let ingredientResult = await client.query(
          'SELECT ingredient_id FROM ingredients WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [item.name]
        );

        let ingredientId;

        if (ingredientResult.rows.length) {
          ingredientId = ingredientResult.rows[0].ingredient_id;
        } else {
          ingredientResult = await client.query(
            `INSERT INTO ingredients (name, unit)
             VALUES ($1, $2)
             RETURNING ingredient_id`,
            [item.name, 'as needed']
          );
          ingredientId = ingredientResult.rows[0].ingredient_id;
        }

        await client.query(
          `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [recipeId, ingredientId, 1]
        );
      }

      const nutrition = getNutrition(ingredients.length);

      await client.query(
        `INSERT INTO nutrition
          (recipe_id, calories, protein_g, fat_g, carbs_g)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (recipe_id) DO NOTHING`,
        [
          recipeId,
          nutrition.calories,
          nutrition.protein,
          nutrition.fat,
          nutrition.carbs,
        ]
      );

      await client.query('COMMIT');
      added++;

      if (added % 25 === 0) {
        console.log(`Added ${added} recipes so far...`);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      failed++;
      console.error(`Failed: ${title} — ${error.message}`);
    } finally {
      client.release();
    }
  }

  console.log('\nImport finished.');
  console.log(`Added: ${added}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  const count = await db.query('SELECT COUNT(*) FROM recipes');
  console.log(`Total recipes now in database: ${count.rows[0].count}`);
}

main()
  .catch(error => {
    console.error('Import stopped:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
