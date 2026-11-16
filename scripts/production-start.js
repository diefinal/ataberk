// No synthetic seed, filesystem secrets, or automatic legacy-data conversion.
const config = require("../config/runtime");
if (!config.production) throw Error("Use server.js for DEV");
const fs = require("fs"),
  { pool } = require("../db");
(async () => {
  if (!fs.existsSync(config.font) || !fs.existsSync(config.boldFont))
    throw Error("Packaged production fonts missing");
  // Schema must be provisioned by an operator after backup/restore verification.
  const meta = (
    await pool.query(
      "SELECT current_schema() s,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super",
    )
  ).rows[0];
  if (meta.s !== config.schema || meta.super)
    throw Error("Dedicated production schema/role must be prepared first");
  await require("./migrate").migrate();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(4317002)");
    const count = Number(
      (await c.query("SELECT count(*) n FROM users")).rows[0].n,
    );
    if (!count) {
      const email = (process.env.FAMILY_ADMIN_EMAIL || "").trim().toLowerCase(),
        hash = process.env.FAMILY_ADMIN_PASSWORD_HASH;
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('.test') ||
        !/^\$2[aby]\$12\$[./a-zA-Z0-9]{53}$/.test(hash || "")
      )
        throw Error(
          "Approved production admin and bcrypt12 password hash required",
        );
      const family = (
        await c.query("INSERT INTO families(name) VALUES($1) RETURNING id", [
          "Ataberk'in Dünyası",
        ])
      ).rows[0];
      const admin = (
        await c.query(
          "INSERT INTO users(email,name,super_admin,password_hash) VALUES($1,$2,true,$3) RETURNING id",
          [email, "Aile yöneticisi", hash],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO memberships(user_id,family_id,role) VALUES($1,$2,'family_admin')",
        [admin.id, family.id],
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
  // server.js performs its own migration identity check in its normal startup.
  await pool.end();
  const { spawn } = require("child_process"),
    child = spawn(
      process.execPath,
      [require("path").join(config.root, "server.js")],
      { stdio: "inherit", env: process.env },
    );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => {
    process.exitCode = code || 0;
  });
})().catch(async (e) => {
  console.error("Production startup refused:", e.message);
  await pool.end();
  process.exitCode = 1;
});
