const config = require("./config/runtime");
if (!config.production) require("./config/network");
const { Pool } = require("pg");
const url = config.production ? new URL(config.databaseUrl) : null;
const pool = new Pool({
  ...(config.production
    ? {
        host: url.hostname,
        port: Number(url.port || 5432),
        database: decodeURIComponent(url.pathname.slice(1)),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        options: "-c search_path=" + config.schema,
      }
    : { connectionString: config.databaseUrl }),
  ssl: config.production ? { rejectUnauthorized: true } : false,
  max: 6,
  connectionTimeoutMillis: 3000,
});
function prepare(sql) {
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  return {
    get: async (p = []) => (await pool.query(sql, p)).rows[0],
    all: async (p = []) => (await pool.query(sql, p)).rows,
    run: async (p = []) => pool.query(sql, p),
  };
}
module.exports = { pool, prepare };
