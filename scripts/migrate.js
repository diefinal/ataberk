const fs = require("fs"),
  path = require("path"),
  crypto = require("crypto"),
  { pool } = require("../db");
async function migrate() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(4317001)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ DEFAULT now())",
    );
    for (const file of fs
      .readdirSync(path.join(__dirname, "../migrations"))
      .filter((f) => f.endsWith(".up.sql"))
      .sort()) {
      const sql = fs.readFileSync(
          path.join(__dirname, "../migrations", file),
          "utf8",
        ),
        checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const prior = (
        await c.query(
          "SELECT checksum FROM schema_migrations WHERE version=$1",
          [file],
        )
      ).rows[0];
      if (prior && prior.checksum !== checksum)
        throw Error("Applied migration changed");
      if (!prior) {
        await c.query(sql);
        await c.query(
          "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
          [file, checksum],
        );
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
if (require.main === module)
  migrate()
    .then(() => console.log("DEV migrations ready"))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = { migrate };
