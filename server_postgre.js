require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());


const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.Cooknest,
  
ssl: {
  ca: require('fs').readFileSync('./ca.pem'),
  rejectUnauthorized: true
}

});


// 1. GET ALL RECIPES
app.get('/api/recipes', async (req, res) => {
  try {
    const { cuisine, difficulty, max_time } = req.query;
    let query = `
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url, c.name AS category, u.username AS submitted_by,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings
      FROM Recipes r
      LEFT JOIN Categories c ON r.category_id = c.category_id
      LEFT JOIN Users u ON r.submitted_by = u.user_id
      LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.status = 'approved'
    `;
    const params = [];
    if (cuisine)    { query += ` AND r.cuisine = ?`;         params.push(cuisine); }
    if (difficulty) { query += ` AND r.difficulty = ?`;      params.push(difficulty); }
    if (max_time)   { query += ` AND r.cook_time_mins <= ?`; params.push(max_time); }
    if (req.query.language) { query += ` AND r.language = ?`; params.push(req.query.language); }
    query += ` GROUP BY r.recipe_id ORDER BY avg_rating DESC, r.created_at DESC`;
    const [rows] = await db.query(query, params);
    res.json({ success: true, count: rows.length, data: rows });
  }  catch (err) {
  console.error('Recipes API error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Unknown database error'
  });
}
});

// 2. GET SINGLE RECIPE
app.get('/api/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [recipe] = await db.query(`
      SELECT r.*, c.name AS category, u.username AS submitted_by_user
      FROM Recipes r
      LEFT JOIN Categories c ON r.category_id = c.category_id
      LEFT JOIN Users u ON r.submitted_by = u.user_id
      WHERE r.recipe_id = ? AND r.status = 'approved'
    `, [id]);
    if (!recipe.length) return res.status(404).json({ success: false, message: 'Recipe not found' });

    const [ingredients] = await db.query(`
      SELECT i.name, i.unit, ri.quantity
      FROM Recipe_Ingredients ri
      JOIN Ingredients i ON ri.ingredient_id = i.ingredient_id
      WHERE ri.recipe_id = ?
    `, [id]);

    const [nutrition] = await db.query(
      `SELECT calories, protein_g, fat_g, carbs_g FROM Nutrition WHERE recipe_id = ?`, [id]
    );

    const [ratings] = await db.query(`
      SELECT u.username, rt.score, rt.comment, rt.created_at
      FROM Ratings rt
      JOIN Users u ON rt.user_id = u.user_id
      WHERE rt.recipe_id = ?
      ORDER BY rt.created_at DESC
    `, [id]);

    const [similar] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             COUNT(DISTINCT ri2.ingredient_id) AS shared_ingredients
      FROM Recipes r
      JOIN Recipe_Ingredients ri2 ON r.recipe_id = ri2.recipe_id
      WHERE r.status = 'approved' AND r.recipe_id != ?
        AND ri2.ingredient_id IN (
          SELECT ingredient_id FROM Recipe_Ingredients WHERE recipe_id = ?
        )
      GROUP BY r.recipe_id
      ORDER BY shared_ingredients DESC LIMIT 3
    `, [id, id]);

    res.json({
      success: true,
      data: {
        ...recipe[0], ingredients,
        nutrition: nutrition[0] || null, ratings, similar,
        avg_rating: ratings.length
          ? (ratings.reduce((a, b) => a + b.score, 0) / ratings.length).toFixed(1)
          : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. SEARCH BY INGREDIENTS
app.get('/api/search', async (req, res) => {
  try {
    const { ingredients } = req.query;
    if (!ingredients) return res.status(400).json({ success: false, message: 'Provide ingredients' });
    const list = ingredients.split(',').map(i => i.trim().toLowerCase());
    for (const term of list) {
      await db.query(
        `INSERT INTO SearchLog (search_term) VALUES (?)
         ON DUPLICATE KEY UPDATE search_count = search_count + 1, last_searched = NOW()`,
        [term]
      );
    }
    const placeholders = list.map(() => 'LOWER(i.name) LIKE ?').join(' OR ');
    const params = list.map(i => `%${i}%`);
    const [rows] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty, r.image_url,
             COUNT(DISTINCT i.ingredient_id) AS matched_ingredients,
             ${list.length} AS searched_count,
             GROUP_CONCAT(DISTINCT i.name ORDER BY i.name SEPARATOR ', ') AS matched_with,
             ROUND(AVG(rt.score), 1) AS avg_rating
      FROM Recipes r
      JOIN Recipe_Ingredients ri ON r.recipe_id = ri.recipe_id
      JOIN Ingredients i ON ri.ingredient_id = i.ingredient_id
      LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.status = 'approved' AND (${placeholders})
      GROUP BY r.recipe_id
      ORDER BY matched_ingredients DESC, avg_rating DESC
    `, params);
    res.json({ success: true, count: rows.length, searched_for: list, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. MISSING INGREDIENTS
app.get('/api/almost', async (req, res) => {
  try {
    const { ingredients, missing = 1 } = req.query;
    if (!ingredients) return res.status(400).json({ success: false, message: 'Provide ingredients' });
    const list = ingredients.split(',').map(i => i.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return res.status(400).json({ success: false, message: 'No valid ingredients' });

    const likeConditions = list.map(() => 'LOWER(i.name) LIKE ?').join(' OR ');
    const likeParams = list.map(i => `%${i}%`);
    const maxMissing = parseInt(missing) || 1;

    const [rows] = await db.query(`
      SELECT
        r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty, r.image_url,
        COUNT(DISTINCT ri.ingredient_id) AS total_ingredients,
        COUNT(DISTINCT CASE WHEN (${likeConditions}) THEN i.ingredient_id END) AS have_count,
        COUNT(DISTINCT ri.ingredient_id) -
          COUNT(DISTINCT CASE WHEN (${likeConditions}) THEN i.ingredient_id END) AS missing_count,
        GROUP_CONCAT(
          DISTINCT CASE WHEN NOT (${likeConditions}) THEN i.name END
          ORDER BY i.name SEPARATOR ', '
        ) AS missing_ingredients,
        ROUND(AVG(rt.score), 1) AS avg_rating
      FROM Recipes r
      JOIN Recipe_Ingredients ri ON r.recipe_id = ri.recipe_id
      JOIN Ingredients i ON ri.ingredient_id = i.ingredient_id
      LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.status = 'approved'
      GROUP BY r.recipe_id
      HAVING missing_count BETWEEN 1 AND ?
      ORDER BY missing_count ASC, have_count DESC, avg_rating DESC
    `, [...likeParams, ...likeParams, ...likeParams, maxMissing]);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. TODAY'S RECIPES
app.get('/api/today', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty, r.image_url,
             c.name AS category, u.username AS submitted_by, r.created_at,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings
      FROM Recipes r
      LEFT JOIN Categories c ON r.category_id = c.category_id
      LEFT JOIN Users u ON r.submitted_by = u.user_id
      LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.status = 'approved' AND DATE(r.created_at) = CURDATE()
      GROUP BY r.recipe_id ORDER BY r.created_at DESC
    `);

    const [special] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty, r.image_url,
             c.name AS category, u.username AS submitted_by,
             ROUND(AVG(rt.score), 1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings
      FROM Recipes r
      LEFT JOIN Categories c ON r.category_id = c.category_id
      LEFT JOIN Users u ON r.submitted_by = u.user_id
      LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.status = 'approved'
      GROUP BY r.recipe_id
      ORDER BY (r.recipe_id * DAYOFYEAR(CURDATE())) % 1000
      LIMIT 1
    `);

    if (!rows.length) {
      const [weekRows] = await db.query(`
        SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty, r.image_url,
               c.name AS category, u.username AS submitted_by, r.created_at,
               ROUND(AVG(rt.score), 1) AS avg_rating,
               COUNT(DISTINCT rt.rating_id) AS total_ratings
        FROM Recipes r
        LEFT JOIN Categories c ON r.category_id = c.category_id
        LEFT JOIN Users u ON r.submitted_by = u.user_id
        LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
        WHERE r.status = 'approved'
          AND r.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        GROUP BY r.recipe_id ORDER BY r.created_at DESC LIMIT 20
      `);
      return res.json({ success: true, count: weekRows.length, period: 'this_week',
        label: "This Week's Recipes", special: special[0] || null, data: weekRows });
    }
    res.json({ success: true, count: rows.length, period: 'today',
      label: "Today's Recipes", special: special[0] || null, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. TRENDING
app.get('/api/trending', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT search_term, search_count FROM SearchLog ORDER BY search_count DESC LIMIT 6`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 7. ADMIN STATS
app.get('/api/admin/stats', async (req, res) => {
  try {
    const [[totals]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM Recipes WHERE status='approved')    AS total_recipes,
        (SELECT COUNT(*) FROM Users)                              AS total_users,
        (SELECT COUNT(*) FROM Ingredients)                        AS total_ingredients,
        (SELECT COUNT(*) FROM Ratings)                            AS total_ratings,
        (SELECT ROUND(AVG(score),1) FROM Ratings)                 AS overall_avg_rating,
        (SELECT COUNT(*) FROM Recipes WHERE status='pending')     AS pending_recipes
    `);
    const [top_recipes] = await db.query(`
      SELECT r.title, ROUND(AVG(rt.score),1) AS avg_rating, COUNT(rt.rating_id) AS total_ratings
      FROM Recipes r JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      GROUP BY r.recipe_id ORDER BY avg_rating DESC, total_ratings DESC LIMIT 5
    `);
    const [by_cuisine] = await db.query(`
      SELECT cuisine, COUNT(*) AS count FROM Recipes
      WHERE status='approved' AND cuisine IS NOT NULL
      GROUP BY cuisine ORDER BY count DESC
    `);
    const [by_difficulty] = await db.query(`SELECT difficulty, COUNT(*) AS count FROM Recipes WHERE status='approved' GROUP BY difficulty`);
    const [trending] = await db.query(`SELECT search_term, search_count FROM SearchLog ORDER BY search_count DESC LIMIT 5`);
    const [recent] = await db.query(`
      SELECT r.title, u.username AS submitted_by, r.created_at
      FROM Recipes r JOIN Users u ON r.submitted_by = u.user_id
      ORDER BY r.created_at DESC LIMIT 5
    `);
    res.json({ success: true, data: { totals, top_recipes, by_cuisine, by_difficulty, trending, recent } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 8. RATE A RECIPE
app.post('/api/recipes/:id/rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, score, comment } = req.body;
    if (score < 1 || score > 5) return res.status(400).json({ success: false, message: 'Score must be 1-5' });
    await db.query(`
      INSERT INTO Ratings (user_id, recipe_id, score, comment) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE score = VALUES(score), comment = VALUES(comment)
    `, [user_id, id, score, comment]);
    res.json({ success: true, message: 'Rating submitted!' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 9. SUBMIT RECIPE
app.post('/api/recipes', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { title, instructions, cuisine, cook_time_mins, difficulty,
            category_id, submitted_by, image_url, ingredients, nutrition } = req.body;
    const [result] = await conn.query(`
      INSERT INTO Recipes (title, instructions, cuisine, cook_time_mins, difficulty, category_id, submitted_by, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')
    `, [title, instructions, cuisine, cook_time_mins, difficulty, category_id, submitted_by, image_url||null]);
    const recipe_id = result.insertId;
    for (const ing of ingredients) {
      await conn.query(`INSERT IGNORE INTO Ingredients (name, unit) VALUES (?, ?)`, [ing.name.toLowerCase(), ing.unit]);
      const [[ingRow]] = await conn.query(`SELECT ingredient_id FROM Ingredients WHERE name = ?`, [ing.name.toLowerCase()]);
      await conn.query(`INSERT INTO Recipe_Ingredients (recipe_id, ingredient_id, quantity) VALUES (?, ?, ?)`,
        [recipe_id, ingRow.ingredient_id, ing.quantity]);
    }
    if (nutrition) {
      await conn.query(`INSERT INTO Nutrition (recipe_id, calories, protein_g, fat_g, carbs_g) VALUES (?, ?, ?, ?, ?)`,
        [recipe_id, nutrition.calories, nutrition.protein_g, nutrition.fat_g, nutrition.carbs_g]);
    }
    await conn.commit();
    res.status(201).json({ success: true, message: 'Recipe submitted!', recipe_id });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ success: false, message: err.message });
  } finally { conn.release(); }
});

// 10. CATEGORIES
app.get('/api/categories', async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM Categories`);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 11. INGREDIENTS AUTOCOMPLETE
app.get('/api/ingredients', async (req, res) => {
  try {
    const { q } = req.query;
    let query = `SELECT ingredient_id, name, unit FROM Ingredients`;
    const params = [];
    if (q) { query += ` WHERE name LIKE ?`; params.push(`%${q}%`); }
    query += ` ORDER BY name`;
    const [rows] = await db.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 12. TOP RATED
app.get('/api/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const [rows] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.image_url,
             ROUND(AVG(rt.score),1) AS avg_rating, COUNT(rt.rating_id) AS total_ratings
      FROM Recipes r JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.status = 'approved'
      GROUP BY r.recipe_id HAVING total_ratings > 0
      ORDER BY avg_rating DESC, total_ratings DESC LIMIT ?
    `, [limit]);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 13. REGISTER
app.post('/api/users/register', async (req, res) => {
  try {
    const { username, email, phone, password } = req.body;
    if (!username || (!email && !phone) || !password)
      return res.status(400).json({ success: false, message: 'Username, email or phone, and password are required' });
    const password_hash = `hashed_${password}`;
    const [result] = await db.query(
      `INSERT INTO Users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)`,
      [username, email || null, phone || null, password_hash]
    );
    const user = { user_id: result.insertId, username, email: email||null, phone: phone||null };
    res.status(201).json({ success: true, message: 'Account created!', user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, message: 'Email or phone already registered' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// 14. LOGIN
app.post('/api/users/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const password_hash = `hashed_${password}`;
    const [rows] = await db.query(
      `SELECT user_id, username, email, phone FROM Users WHERE (email = ? OR phone = ?) AND password_hash = ?`,
      [identifier, identifier, password_hash]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    res.json({ success: true, message: 'Login successful', user: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 15. USER PROFILE
app.get('/api/users/:id/profile', async (req, res) => {
  try {
    const { id } = req.params;
    const [[user]] = await db.query(
      `SELECT user_id, username, email, phone, created_at FROM Users WHERE user_id = ?`, [id]
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const [recipes] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url, r.status, r.created_at,
             ROUND(AVG(rt.score),1) AS avg_rating, COUNT(DISTINCT rt.rating_id) AS total_ratings
      FROM Recipes r LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.submitted_by = ? GROUP BY r.recipe_id ORDER BY r.created_at DESC
    `, [id]);
    const [[stats]] = await db.query(`
      SELECT COUNT(*) AS total_recipes,
             COUNT(CASE WHEN status='approved' THEN 1 END) AS approved,
             COALESCE(ROUND(AVG(rt.score),1),0) AS avg_rating_received,
             COUNT(DISTINCT rt.rating_id) AS total_ratings_received
      FROM Recipes r LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE r.submitted_by = ?
    `, [id]);
    res.json({ success: true, data: { user, recipes, stats } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// 16. BOOKMARKS
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS Bookmarks (
        bookmark_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        recipe_id   INT NOT NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_bookmark (user_id, recipe_id),
        FOREIGN KEY (user_id)   REFERENCES Users(user_id)   ON DELETE CASCADE,
        FOREIGN KEY (recipe_id) REFERENCES Recipes(recipe_id) ON DELETE CASCADE
      )
    `);
  } catch(e) {}
})();

app.post('/api/bookmarks', async (req, res) => {
  try {
    const { user_id, recipe_id } = req.body;
    await db.query(`INSERT IGNORE INTO Bookmarks (user_id, recipe_id) VALUES (?, ?)`, [user_id, recipe_id]);
    res.json({ success: true, message: 'Bookmarked!' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.delete('/api/bookmarks', async (req, res) => {
  try {
    const { user_id, recipe_id } = req.body;
    await db.query(`DELETE FROM Bookmarks WHERE user_id = ? AND recipe_id = ?`, [user_id, recipe_id]);
    res.json({ success: true, message: 'Removed bookmark' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

app.get('/api/bookmarks/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    const [rows] = await db.query(`
      SELECT r.recipe_id, r.title, r.cuisine, r.cook_time_mins, r.difficulty,
             r.image_url, ROUND(AVG(rt.score),1) AS avg_rating,
             COUNT(DISTINCT rt.rating_id) AS total_ratings
      FROM Bookmarks b
      JOIN Recipes r ON b.recipe_id = r.recipe_id
      LEFT JOIN Ratings rt ON r.recipe_id = rt.recipe_id
      WHERE b.user_id = ? AND r.status = 'approved'
      GROUP BY r.recipe_id, b.created_at
      ORDER BY b.created_at DESC
    `, [user_id]);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// START SERVER
const PORT = process.env.PORT || 5000;
app.use(express.static(__dirname));
app.listen(PORT, () => console.log(`Cooking DB API running at http://localhost:${PORT}`));