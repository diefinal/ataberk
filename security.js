const crypto = require("crypto"),
  session = require("express-session"),
  { pool } = require("./db");
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("hex");
class PgStore extends session.Store {
  get(sid, cb) {
    pool
      .query("SELECT sess FROM sessions WHERE sid=$1 AND expires_at>now()", [
        sid,
      ])
      .then((r) => cb(null, r.rows[0]?.sess))
      .catch(cb);
  }
  set(sid, sess, cb = () => {}) {
    pool
      .query(
        "INSERT INTO sessions(sid,sess,expires_at) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET sess=$2,expires_at=$3",
        [sid, sess, new Date(sess.cookie.expires || Date.now() + 3600000)],
      )
      .then(() => cb())
      .catch(cb);
  }
  destroy(sid, cb = () => {}) {
    pool
      .query("DELETE FROM sessions WHERE sid=$1", [sid])
      .then(() => cb())
      .catch(cb);
  }
  touch(sid, sess, cb = () => {}) {
    pool
      .query("UPDATE sessions SET expires_at=$2 WHERE sid=$1", [
        sid,
        new Date(sess.cookie.expires),
      ])
      .then(() => cb())
      .catch(cb);
  }
}
function csrf(req, res, next) {
  req.session.csrf ||= randomToken();
  res.locals.csrf = req.session.csrf;
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const candidate = req.get("x-csrf-token") || req.body?._csrf || "";
    const a = Buffer.from(String(candidate)),
      b = Buffer.from(req.session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return res
        .status(403)
        .send("Güvenlik doğrulaması başarısız. Sayfayı yenileyin.");
  }
  next();
}
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
async function loadUser(req, res, next) {
  if (
    req.session.userId &&
    Date.now() - (req.session.authAt || 0) < 8 * 3600000
  ) {
    const r = await pool.query(
      "SELECT u.*,m.family_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND u.active=true ORDER BY m.family_id LIMIT 1",
      [req.session.userId],
    );
    req.user = r.rows[0];
  }
  res.locals.user = req.user || null;
  res.locals.session = {
    user: req.user
      ? {
          ...req.user,
          is_admin: req.user.role === "family_admin" || req.user.super_admin,
        }
      : null,
    verified: !!req.user,
  };
  next();
}
function requireUser(req, res, next) {
  if (!req.user) return res.redirect("/giris");
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect("/giris");
  if (req.user.role !== "family_admin" && !req.user.super_admin)
    return res.status(403).send("Yönetici yetkisi gerekli.");
  next();
}
const albumPredicate = (alias = "a", userParam = "$1") =>
  `(${alias}.family_id=(SELECT family_id FROM memberships WHERE user_id=${userParam} ORDER BY family_id LIMIT 1) AND (EXISTS(SELECT 1 FROM memberships z JOIN users u ON u.id=z.user_id WHERE z.user_id=${userParam} AND z.family_id=${alias}.family_id AND (z.role='family_admin' OR u.super_admin)) OR EXISTS(SELECT 1 FROM album_permissions p WHERE p.album_id=${alias}.id AND p.user_id=${userParam})))`;
async function albumAccess(user, id) {
  return (
    await pool.query(
      `SELECT a.* FROM albums a WHERE a.id=$2 AND ${albumPredicate()}`,
      [user.id, id],
    )
  ).rows[0];
}
async function mediaAccess(user, id) {
  return (
    await pool.query(
      `SELECT m.*,CASE WHEN EXISTS(SELECT 1 FROM media p WHERE p.id=m.poster_media_id AND p.album_id=m.album_id AND p.type='image' AND p.deleted_at IS NULL) THEN m.poster_media_id END poster_id,a.title album_title,a.family_id FROM media m JOIN albums a ON a.id=m.album_id WHERE m.id=$2 AND m.deleted_at IS NULL AND ${albumPredicate()}`,
      [user.id, id],
    )
  ).rows[0];
}
async function audit(actor, action, target, client = pool) {
  await client.query(
    "INSERT INTO audit_logs(actor_id,family_id,action,target) VALUES($1,$2,$3,$4)",
    [actor.id, actor.family_id, action, String(target)],
  );
}
async function limited(key, max, seconds) {
  const r = await pool.query(
    `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END,expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING hits`,
    [digest(key), seconds],
  );
  return r.rows[0].hits > max;
}
module.exports = {
  digest,
  randomToken,
  PgStore,
  csrf,
  wrap,
  loadUser,
  requireUser,
  requireAdmin,
  albumPredicate,
  albumAccess,
  mediaAccess,
  audit,
  limited,
};
