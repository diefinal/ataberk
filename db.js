const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');

let db;

function getDb() {
  return db;
}

async function initDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL,
      filename TEXT NOT NULL,
      thumbnail TEXT,
      category_id INTEGER,
      views INTEGER DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_id) REFERENCES media(id)
    );
  `);

  // Admin kullanıcı oluştur
  const adminCheck = db.exec("SELECT id FROM users WHERE username='admin'");
  if (!adminCheck.length || !adminCheck[0].values.length) {
    const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    db.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, 1)', ['admin', hashed]);
    console.log('Admin user created: admin / admin123');
  }

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Yardımcı fonksiyonlar - better-sqlite3 API'sine benzer arayüz
function prepare(sql) {
  return {
    get: (...params) => {
      const flat = params.flat();
      const result = db.exec(sql, flat);
      if (!result.length || !result[0].values.length) return undefined;
      const cols = result[0].columns;
      const row = result[0].values[0];
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      return obj;
    },
    all: (...params) => {
      const flat = params.flat();
      const result = db.exec(sql, flat);
      if (!result.length) return [];
      const cols = result[0].columns;
      return result[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => obj[c] = row[i]);
        return obj;
      });
    },
    run: (...params) => {
      const flat = params.flat();
      db.run(sql, flat);
      saveDb();
    }
  };
}

function exec(sql) {
  db.run(sql);
  saveDb();
}

module.exports = { initDb, getDb, prepare, exec, saveDb };
