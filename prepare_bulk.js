
const fs = require('fs');

const input = 'G:\\cooking\\bulk_recipes_ready.sql';
const output = 'G:\\cooking\\bulk_recipes_postgres.sql';

let sql = fs.readFileSync(input, 'utf8');

// PostgreSQL standard strings use doubled apostrophes.
// Convert MySQL-style escaped apostrophes inside SQL text.
sql = sql.replace(/\\'/g, "''");

fs.writeFileSync(output, sql, 'utf8');

console.log('Created:', output);
console.log('Original file preserved.');
console.log('Remaining backslash-escaped apostrophes:', (sql.match(/\\'/g) || []).length);
