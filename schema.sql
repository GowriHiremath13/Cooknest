CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(30) UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  category_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS ingredients (
  ingredient_id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  unit VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS recipes (
  recipe_id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  instructions TEXT,
  cuisine VARCHAR(100),
  cook_time_mins INTEGER,
  difficulty VARCHAR(30),
  category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
  submitted_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  image_url TEXT,
  language VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER NOT NULL REFERENCES recipes(recipe_id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
  quantity NUMERIC(12,3),
  PRIMARY KEY (recipe_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS nutrition (
  recipe_id INTEGER PRIMARY KEY REFERENCES recipes(recipe_id) ON DELETE CASCADE,
  calories NUMERIC(10,2),
  protein_g NUMERIC(10,2),
  fat_g NUMERIC(10,2),
  carbs_g NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS ratings (
  rating_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(recipe_id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS searchlog (
  search_term TEXT PRIMARY KEY,
  search_count INTEGER NOT NULL DEFAULT 1,
  last_searched TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookmarks (
  bookmark_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(recipe_id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, recipe_id)
);
