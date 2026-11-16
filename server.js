const config = require("./config/runtime");
if (!config.production) require("./config/network");
const express = require("express"),
  session = require("express-session"),
  path = require("path"),
  { pool } = require("./db");
const { PgStore, csrf, wrap, loadUser } = require("./security");
const app = express();
app.disable("x-powered-by");
if (config.production) app.set("trust proxy", 1);
app.get("/healthz", (req, res) => res.json({ status: "ok" }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use((req, res, next) => {
  if (
    config.production
      ? !config.hosts.includes(req.get("host"))
      : !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) ||
        req.get("host") !== `127.0.0.1:${config.port}`
  )
    return res.status(403).send("Yalnız DEV localhost erişimi.");
  res.set({
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store, private",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  });
  next();
});
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.locals.production = !!config.production;
  next();
});
app.use(
  session({
    name: config.production ? "ataberk.family.sid" : "ataberk.dev.sid",
    secret: config.secret,
    store: new PgStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: !!config.production,
      maxAge: 3600000,
    },
  }),
);
app.use(csrf);
app.use(wrap(loadUser));
app.use(require("./password-auth"));
app.use(require("./auth"));
app.use(require("./community").router);
app.use(require("./experiences").router);
app.use(require("./enhancements").router);
app.use(require("./family"));
app.use("/oyunlar", require("./routes/games"));
app.get("/haberler", (req, res) =>
  res.render("family/external", { title: "Haberler", kind: "news" }),
);
app.get(["/youtube", "/youtube/video/:id"], (req, res) =>
  res.render("family/external", { title: "YouTube", kind: "youtube" }),
);
app.use(["/taksi", "/webhook"], (req, res) =>
  res.status(503).render("family/notice", {
    title: "Bağımsız servis",
    message:
      "Taksi, WhatsApp ve bildirim servisleri bu DEV ortamında kapalıdır.",
  }),
);
app.use((req, res) =>
  res.status(404).render("family/notice", {
    title: "Sayfa bulunamadı",
    message: "Bu adres bulunamadı veya erişim izniniz yok.",
  }),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const validation = [
    "22P02",
    "22007",
    "22008",
    "23503",
    "23505",
    "23514",
  ].includes(err.code);
  res
    .status(validation ? 400 : err.code === "LIMIT_FILE_SIZE" ? 413 : 500)
    .render("family/notice", {
      title: "İşlem tamamlanamadı",
      message: validation
        ? "Gönderilen bilgileri kontrol edin."
        : "İşlem güvenli biçimde durduruldu. Tekrar deneyin.",
    });
  if (!validation) console.error("DEV request error:", err.message);
});
if (require.main === module) {
  (async () => {
    const expected = require("fs")
      .readdirSync(path.join(__dirname, "migrations"))
      .filter((f) => f.endsWith(".up.sql"))
      .sort();
    const actual = (
      await pool.query("SELECT version FROM schema_migrations ORDER BY version")
    ).rows.map((r) => r.version);
    if (JSON.stringify(expected) !== JSON.stringify(actual))
      throw Error("Run DEV migrations before startup");
    const identity = (
      await pool.query(
        "SELECT current_database() db,current_user usr,inet_server_addr()::text host,current_schema() schema,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super",
      )
    ).rows[0];
    if (
      config.production
        ? identity.db === "ataberk_dev" ||
          identity.schema !== config.schema ||
          identity.super
        : identity.db !== "ataberk_dev" ||
          identity.usr !== "ataberk_app" ||
          !identity.host.startsWith("127.0.0.1")
    )
      throw Error("DEV identity check failed");
    app.listen(config.port, config.host, () =>
      console.log(
        config.production
          ? `Ataberk’in Dünyası: ${config.origin}`
          : `Ataberk’in Dünyası DEV: http://${config.host}:${config.port}`,
      ),
    );
  })().catch(async (e) => {
    console.error(e.message);
    await pool.end();
    process.exitCode = 1;
  });
}
module.exports = { app };
