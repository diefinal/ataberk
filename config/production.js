const path = require("path");
function validate(e) {
  if (e.APP_ENV !== "production" || e.FAMILY_RELEASE_ENABLED !== "yes")
    throw Error("Production release is not configured");
  const origin = new URL(e.FAMILY_PUBLIC_ORIGIN || "invalid:");
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.port ||
    origin.hostname === "localhost"
  )
    throw Error("HTTPS production origin required");
  const u = new URL(e.FAMILY_DATABASE_URL || "invalid:");
  if (
    !["postgresql:", "postgres:"].includes(u.protocol) ||
    ["127.0.0.1", "localhost", "::1"].includes(u.hostname) ||
    u.pathname.includes("ataberk_dev") ||
    !u.username ||
    !u.password
  )
    throw Error("Separate production database credentials required");
  if (e.FAMILY_DB_SCHEMA !== "ataberk_family_v1")
    throw Error("Isolated production schema required");
  for (const key of ["FAMILY_SESSION_SECRET", "FAMILY_CAPSULE_KEY"])
    if (!/^[a-f0-9]{64}$/.test(e[key] || ""))
      throw Error("Missing independent production secret: " + key);
  if (e.FAMILY_SESSION_SECRET === e.FAMILY_CAPSULE_KEY)
    throw Error("Production secrets must be independent");
  if (
    !/^[a-z0-9_-]+$/.test(e.CLOUDINARY_CLOUD_NAME || "") ||
    !/^\d+$/.test(e.CLOUDINARY_API_KEY || "") ||
    !e.CLOUDINARY_API_SECRET
  )
    throw Error("Cloudinary configuration required");
  if (!e.RESEND_API_KEY || !e.FAMILY_MAIL_FROM || !e.FAMILY_MAIL_TEST_RECIPIENT)
    throw Error("Production mail configuration required");
  const port = Number(e.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("Invalid production PORT");
  const hosts = [origin.host];
  if (e.RENDER_EXTERNAL_HOSTNAME) {
    if (!/^[a-z0-9-]+\.onrender\.com$/.test(e.RENDER_EXTERNAL_HOSTNAME))
      throw Error("Invalid Render hostname");
    hosts.push(e.RENDER_EXTERNAL_HOSTNAME);
  }
  return {
    production: true,
    root: path.resolve(__dirname, ".."),
    runtime: path.resolve(__dirname, "../.runtime"),
    host: "0.0.0.0",
    port,
    origin: origin.origin,
    hosts,
    secret: e.FAMILY_SESSION_SECRET,
    vaultKey: e.FAMILY_CAPSULE_KEY,
    schema: e.FAMILY_DB_SCHEMA,
    databaseUrl: u.href,
    cloudinary: {
      cloud_name: e.CLOUDINARY_CLOUD_NAME,
      api_key: e.CLOUDINARY_API_KEY,
      api_secret: e.CLOUDINARY_API_SECRET,
    },
    mail: {
      apiKey: e.RESEND_API_KEY,
      from: e.FAMILY_MAIL_FROM,
      testRecipient: e.FAMILY_MAIL_TEST_RECIPIENT,
      enabled: e.FAMILY_MAIL_ENABLED === "yes",
    },
    font:
      e.FAMILY_PDF_FONT ||
      path.resolve(__dirname, "../assets/fonts/NotoSans-Regular.ttf"),
    boldFont:
      e.FAMILY_PDF_BOLD_FONT ||
      path.resolve(__dirname, "../assets/fonts/NotoSans-Bold.ttf"),
  };
}
module.exports = { validate };
