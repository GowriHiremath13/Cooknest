
const fs = require('fs');

const file = 'G:\\cooking\\bulk_recipes_postgres.sql';
const sql = fs.readFileSync(file, 'utf8');

console.log('File exists:', fs.existsSync(file));
console.log('File size:', (Buffer.byteLength(sql) / 1024 / 1024).toFixed(2), 'MB');

for (const table of [
  'Recipes',
  'Ingredients',
  'Categories',
  'Recipe_Ingredients',
  'Nutrition'
]) {
  const pattern = new RegExp(
    'INSERT INTO\\s+' + table + '\\b',
    'gi'
  );

  console.log(table + ' insert blocks:', (sql.match(pattern) || []).length);
}

console.log('Remaining USE statements:', (sql.match(/^\s*USE\s+/gim) || []).length);
console.log('Remaining INSERT IGNORE:', /INSERT\s+IGNORE/i.test(sql));
console.log('Remaining escaped apostrophes:', (sql.match(/\\'/g) || []).length);

console.log('\nFirst 500 characters:\n' + sql.slice(0, 500));
