const https = require('https');
const fs = require('fs');

// ── helpers ──────────────────────────────────────────────────────────────────
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve(null); } });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function esc(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

// Map TheMealDB area → cuisine name
const CUISINE_MAP = {
  American:'American', British:'British', Canadian:'Canadian', Chinese:'Chinese',
  Croatian:'European', Dutch:'European', Egyptian:'Middle Eastern',
  Filipino:'Asian', French:'French', Greek:'Mediterranean',
  Indian:'Indian', Irish:'European', Italian:'Italian',
  Jamaican:'Caribbean', Japanese:'Japanese', Kenyan:'African',
  Malaysian:'Asian', Mexican:'Mexican', Moroccan:'African',
  Polish:'European', Portuguese:'European', Russian:'European',
  Spanish:'Mediterranean', Thai:'Thai', Tunisian:'African',
  Turkish:'Middle Eastern', Unknown:'Other', Vietnamese:'Asian',
  'South Indian':'South Indian'
};

// Difficulty heuristic based on ingredient count + cook time
function getDifficulty(ingCount, steps) {
  if (ingCount <= 5 || steps <= 3) return 'easy';
  if (ingCount <= 12 || steps <= 6) return 'medium';
  return 'hard';
}

// Rough cook time from instruction word count
function estimateCookTime(instructions) {
  const words = (instructions || '').split(' ').length;
  if (words < 80) return 15;
  if (words < 200) return 30;
  if (words < 400) return 45;
  return 60;
}

// Category mapping
function getCategory(tags, strCategory) {
  const cat = (strCategory || '').toLowerCase();
  if (cat.includes('breakfast') || cat.includes('starter')) return 1;
  if (cat.includes('side') || cat.includes('miscellaneous')) return 2;
  if (cat.includes('dessert') || cat.includes('cake') || cat.includes('pastry')) return 5;
  if (cat.includes('seafood') || cat.includes('lamb') || cat.includes('beef') ||
      cat.includes('chicken') || cat.includes('pork') || cat.includes('goat') ||
      cat.includes('vegetarian') || cat.includes('vegan') || cat.includes('pasta')) return 3;
  return 3;
}

// Rough nutrition estimate
function estimateNutrition(ingCount) {
  const base = 150 + ingCount * 25;
  return {
    calories: base + Math.floor(Math.random() * 100),
    protein:  Math.round(5 + Math.random() * 25),
    fat:      Math.round(3 + Math.random() * 20),
    carbs:    Math.round(10 + Math.random() * 50)
  };
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching meal list from TheMealDB...');

  // Collect meal IDs from every letter a-z
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  let allMeals = [];
  for (const letter of letters) {
    const data = await get(`https://www.themealdb.com/api/json/v1/1/search.php?f=${letter}`);
    if (data && data.meals) allMeals = allMeals.concat(data.meals);
    process.stdout.write(`  Fetched letter '${letter}' → ${allMeals.length} meals so far\r`);
    await sleep(120);
  }
  console.log(`\nTotal meals fetched: ${allMeals.length}`);

  // De-duplicate by idMeal
  const seen = new Set();
  allMeals = allMeals.filter(m => { if (seen.has(m.idMeal)) return false; seen.add(m.idMeal); return true; });
  console.log(`After de-dup: ${allMeals.length} unique meals`);

  // ── build SQL ──────────────────────────────────────────────────────────────
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- AUTO-GENERATED SEED DATA — TheMealDB (${allMeals.length} recipes)`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Run AFTER your existing seed_data.sql`);
  lines.push(`-- ============================================================`);
  lines.push(`USE recipe;`);
  lines.push(``);

  // Track global ingredient map to avoid re-inserting
  const ingredientNames = new Set();
  const recipeRows   = [];
  const riRows       = [];
  const nutritionRows= [];
  const ingInserts   = [];

  const BASE_USER = 1; // admin
  let recipeOffset = 12; // start after the 10 already inserted

  for (let idx = 0; idx < allMeals.length; idx++) {
    const m = allMeals[idx];
    const recipeId = recipeOffset + idx;

    // Extract ingredients (TheMealDB stores them as strIngredient1..20)
    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
      const name = (m[`strIngredient${i}`] || '').trim().toLowerCase();
      const qty  = (m[`strMeasure${i}`]    || '').trim();
      if (name && name !== 'null') ingredients.push({ name, qty });
    }
    if (!ingredients.length) continue;

    const ingCount   = ingredients.length;
    const steps      = (m.strInstructions || '').split('\n').filter(l => l.trim()).length;
    const difficulty = getDifficulty(ingCount, steps);
    const cookTime   = estimateCookTime(m.strInstructions);
    const category   = getCategory(m.strTags, m.strCategory);
    const cuisine    = CUISINE_MAP[m.strArea] || m.strArea || 'Other';
    const nutr       = estimateNutrition(ingCount);

    // Recipe row
    recipeRows.push(
      `(${recipeId}, '${esc(m.strMeal)}', '${esc(m.strInstructions)}', ` +
      `'${esc(cuisine)}', ${cookTime}, '${difficulty}', ${category}, ${BASE_USER}, 'approved')`
    );

    // Ingredient rows
    for (const ing of ingredients) {
      if (!ingredientNames.has(ing.name)) {
        ingredientNames.add(ing.name);
        ingInserts.push(`('${esc(ing.name)}', 'as needed')`);
      }
    }

    // Recipe_Ingredients (resolved after ingredient inserts)
    riRows.push({ recipeId, ingredients });

    // Nutrition
    nutritionRows.push(
      `(${recipeId}, ${nutr.calories}, ${nutr.protein}, ${nutr.fat}, ${nutr.carbs})`
    );
  }

  // ── Write Recipes in batches of 50 ────────────────────────────────────────
  lines.push(`-- ── RECIPES (${recipeRows.length}) ─────────────────────────────────────`);
  lines.push(`INSERT INTO Recipes (recipe_id, title, instructions, cuisine, cook_time_mins, difficulty, category_id, submitted_by, status) VALUES`);
  for (let i = 0; i < recipeRows.length; i += 50) {
    const batch = recipeRows.slice(i, i + 50);
    if (i > 0) {
      lines.push(`;`);
      lines.push(`INSERT INTO Recipes (recipe_id, title, instructions, cuisine, cook_time_mins, difficulty, category_id, submitted_by, status) VALUES`);
    }
    lines.push(batch.join(',\n') + (i + 50 >= recipeRows.length ? ';' : ''));
  }
  lines.push(``);

  // ── Write Ingredients ──────────────────────────────────────────────────────
  lines.push(`-- ── INGREDIENTS (${ingInserts.length} new) ─────────────────────────────`);
  for (let i = 0; i < ingInserts.length; i += 100) {
    const batch = ingInserts.slice(i, i + 100);
    lines.push(`INSERT IGNORE INTO Ingredients (name, unit) VALUES`);
    lines.push(batch.join(',\n') + ';');
  }
  lines.push(``);

  // ── Write Recipe_Ingredients using subqueries ──────────────────────────────
  lines.push(`-- ── RECIPE_INGREDIENTS ─────────────────────────────────────────────`);
  for (const { recipeId, ingredients } of riRows) {
    for (const ing of ingredients) {
      lines.push(
        `INSERT IGNORE INTO Recipe_Ingredients (recipe_id, ingredient_id, quantity) ` +
        `SELECT ${recipeId}, ingredient_id, 1 FROM Ingredients WHERE name = '${esc(ing.name)}' LIMIT 1;`
      );
    }
  }
  lines.push(``);

  // ── Write Nutrition ────────────────────────────────────────────────────────
  lines.push(`-- ── NUTRITION ──────────────────────────────────────────────────────`);
  for (let i = 0; i < nutritionRows.length; i += 100) {
    const batch = nutritionRows.slice(i, i + 100);
    lines.push(`INSERT IGNORE INTO Nutrition (recipe_id, calories, protein_g, fat_g, carbs_g) VALUES`);
    lines.push(batch.join(',\n') + ';');
  }

  lines.push(``);
  lines.push(`-- ── DONE ───────────────────────────────────────────────────────────`);
  lines.push(`SELECT COUNT(*) AS total_recipes FROM Recipes;`);

  const sql = lines.join('\n');
  fs.writeFileSync('bulk_recipes.sql', sql, 'utf8');
  fs.writeFileSync(
  'themealdb_recipes.json',
  JSON.stringify(allMeals, null, 2),
  'utf8'
);

console.log('Raw meal data saved to themealdb_recipes.json');
  console.log(`\nDone! bulk_recipes.sql written (${(sql.length/1024).toFixed(1)} KB)`);
  console.log(`Recipes: ${recipeRows.length} | Ingredients: ${ingInserts.length}`);
}

main().catch(console.error);