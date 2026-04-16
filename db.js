const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') || process.env.DATABASE_URL?.includes('dpg-')
    ? { rejectUnauthorized: false }
    : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      filename TEXT NOT NULL,
      thumbnail TEXT,
      category_id INTEGER,
      views INTEGER DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      media_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reactions (
      id SERIAL PRIMARY KEY,
      media_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(media_id, email)
    );
  `);

  // Admin kullanıcı oluştur
  const res = await pool.query("SELECT id FROM users WHERE username='admin'");
  if (res.rows.length === 0) {
    const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    await pool.query('INSERT INTO users (username, password, is_admin) VALUES ($1, $2, 1)', ['admin', hashed]);
    console.log('Admin user created: admin / admin123');
  }

  console.log('Database ready');
}

// SQLite benzeri senkron API — PostgreSQL async olduğu için wrapper
function prepare(sql) {
  // PostgreSQL için ? yerine $1, $2 kullan
  const pgSql = sql.replace(/\?/g, (_, i) => {
    let count = 0;
    for (let j = 0; j < _.length; j++) if (sql[j] === '?') count++;
    return '?'; // geçici, aşağıda düzelteceğiz
  });

  return {
    get: async (params = []) => {
      const flat = Array.isArray(params) ? params.flat() : [params];
      const converted = convertSql(sql);
      const res = await pool.query(converted, flat);
      return res.rows[0] || undefined;
    },
    all: async (params = []) => {
      const flat = Array.isArray(params) ? params.flat() : [params];
      const converted = convertSql(sql);
      const res = await pool.query(converted, flat);
      return res.rows;
    },
    run: async (params = []) => {
      const flat = Array.isArray(params) ? params.flat() : [params];
      const converted = convertSql(sql);
      await pool.query(converted, flat);
    }
  };
}

function convertSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function exec(sql) {
  return pool.query(sql);
}

module.exports = { initDb, prepare, exec, pool };
