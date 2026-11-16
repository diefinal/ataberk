const express = require("express"),
  bcrypt = require("bcryptjs"),
  { pool } = require("./db"),
  {
    wrap,
    requireAdmin,
    limited,
    digest,
    randomToken,
    audit,
  } = require("./security");
const router = express.Router(),
  dummy = bcrypt.hashSync("invalid-account-placeholder", 12);
const valid = (p) =>
  typeof p === "string" && p.length >= 12 && Buffer.byteLength(p, "utf8") <= 72;
router.get("/admin/giris", (req, res) =>
  res.render("family/password-login", {
    title: "Yönetici girişi",
    error: null,
  }),
);
router.post(
  "/admin/giris",
  wrap(async (req, res) => {
    const email = String(req.body.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body.password || "");
    if (
      (await limited("admin-password:ip:" + req.ip, 20, 900)) ||
      (await limited("admin-password:" + email, 5, 900))
    )
      return res.status(429).render("family/password-login", {
        title: "Yönetici girişi",
        error: "Çok fazla deneme. Bir süre sonra tekrar deneyin.",
      });
    const user = (
      await pool.query(
        "SELECT u.*,m.family_id,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1 AND u.active AND (u.super_admin OR m.role='family_admin')",
        [email],
      )
    ).rows[0];
    const correct =
      Buffer.byteLength(password, "utf8") <= 72 &&
      (await bcrypt.compare(password, user?.password_hash || dummy));
    if (!user?.password_hash || !correct)
      return res.status(401).render("family/password-login", {
        title: "Yönetici girişi",
        error: "E-posta veya şifre hatalı.",
      });
    await new Promise((ok, fail) =>
      req.session.regenerate((e) => (e ? fail(e) : ok())),
    );
    req.session.userId = user.id;
    req.session.authAt = Date.now();
    req.session.csrf = randomToken();
    await pool.query("DELETE FROM rate_limits WHERE key=$1", [
      digest("admin-password:" + email),
    ]);
    await audit(user, "admin.password_login", user.id);
    res.redirect("/admin");
  }),
);
router.get("/admin/sifre", requireAdmin, (req, res) =>
  res.render("family/password-change", {
    title: "Yönetici şifrem",
    error: null,
  }),
);
router.post(
  "/admin/sifre",
  requireAdmin,
  wrap(async (req, res) => {
    const { current_password, new_password, confirmation } = req.body;
    if (!valid(new_password) || new_password !== confirmation)
      return res.status(400).render("family/password-change", {
        title: "Yönetici şifrem",
        error:
          "Yeni şifre en az 12 karakter olmalı, 72 baytı geçmemeli ve iki alan aynı olmalı.",
      });
    if (await limited("password-change:" + req.user.id, 5, 900))
      return res.sendStatus(429);
    if (
      !req.user.password_hash ||
      !(await bcrypt.compare(
        String(current_password || ""),
        req.user.password_hash,
      ))
    )
      return res.status(400).render("family/password-change", {
        title: "Yönetici şifrem",
        error: "Mevcut şifre hatalı.",
      });
    const hash = await bcrypt.hash(new_password, 12),
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        hash,
        req.user.id,
      ]);
      await c.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [
        String(req.user.id),
      ]);
      await audit(req.user, "admin.password_change", req.user.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    await new Promise((ok, fail) =>
      req.session.destroy((e) => (e ? fail(e) : ok())),
    );
    res.clearCookie(
      require("./config/runtime").production
        ? "ataberk.family.sid"
        : "ataberk.dev.sid",
    );
    res.redirect("/admin/giris");
  }),
);
module.exports = router;
