// patch_server.js — run once: node patch_server.js
const fs = require('fs');

let s = fs.readFileSync('server.js', 'utf8');
let count = 0;

// All the SELECT blocks that need image_url added
const patches = [
  // GET all recipes
  {
    find: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             c.name AS category,
             u.username AS submitted_by,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings`,
    replace: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url,
             c.name AS category,
             u.username AS submitted_by,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings`
  },
  // Search query
  {
    find: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             COUNT(DISTINCT i.ingredient_id) AS matched_ingredients,`,
    replace: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url,
             COUNT(DISTINCT i.ingredient_id) AS matched_ingredients,`
  },
  // Today query
  {
    find: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             c.name AS category, u.username AS submitted_by, r.created_at,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings`,
    replace: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url,
             c.name AS category, u.username AS submitted_by, r.created_at,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings`
  },
  // Profile / user recipes query
  {
    find: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.status, r.created_at,
             ROUND(AVG(rt.score),1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings`,
    replace: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url, r.status, r.created_at,
             ROUND(AVG(rt.score),1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings`
  },
  // Top rated query
  {
    find: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins,
             ROUND(AVG(rt.score),1) AS avg_rating,
             COUNT(rt.rating_id) AS total_ratings`,
    replace: `SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins,
             r.image_url,
             ROUND(AVG(rt.score),1) AS avg_rating,
             COUNT(rt.rating_id) AS total_ratings`
  },
];

for (const { find, replace } of patches) {
  if (s.includes(find)) {
    s = s.replace(find, replace);
    count++;
    console.log(`✓ Patched: ${find.split('\n')[0].trim().substring(0,60)}`);
  } else {
    console.log(`✗ Not found: ${find.split('\n')[0].trim().substring(0,60)}`);
  }
}

fs.writeFileSync('server.js', s);
console.log(`\nDone — ${count} queries patched. Restart your server.`);