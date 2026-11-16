const path = require("path");
const root = path.resolve(__dirname, "..");
require("dotenv").config({
  path: path.join(root, ".env"),
  quiet: true,
  override: true,
});
function validate(e) {
  if (e.APP_ENV !== "development" || e.HOST !== "127.0.0.1")
    throw Error("Only localhost DEV permitted");
  if (!/^[a-f0-9]{64}$/.test(e.SESSION_SECRET || ""))
    throw Error("Random session secret required");
  const u = new URL(e.DATABASE_URL || "invalid:");
  if (
    u.protocol !== "postgresql:" ||
    u.hostname !== "127.0.0.1" ||
    u.port !== "55439" ||
    u.pathname !== "/ataberk_dev" ||
    u.username !== "ataberk_app" ||
    u.search ||
    u.hash
  )
    throw Error("Only isolated DEV database permitted");
  if (
    e.MEDIA_DRIVER !== "local" ||
    e.MAIL_DRIVER !== "outbox" ||
    e.EXTERNAL_SERVICES !== "disabled"
  )
    throw Error("External services must be disabled");
  if (
    Object.keys(e).some(
      (k) =>
        /^(CLOUDINARY_|RESEND_|WHATSAPP_|BUFFER_|OPENAI_|YOUTUBE_API_KEY|LIVE_SERVER_URL|PGHOST|PGSERVICE|PGOPTIONS|PGDATABASE)/.test(
          k,
        ) && e[k],
    )
  )
    throw Error("Live configuration prohibited");
  return {
    root,
    runtime: path.join(root, ".runtime"),
    databaseUrl: u.href,
    host: "127.0.0.1",
    port: 4317,
    secret: e.SESSION_SECRET,
  };
}
module.exports = { ...validate(process.env), validate };
