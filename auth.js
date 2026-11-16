const express = require("express"),
  crypto = require("crypto"),
  { pool } = require("./db"),
  { sendMail, sendOtp } = require("./mailer");
const { digest, randomToken, wrap, limited } = require("./security");
const router = express.Router();
router.use((req, res, next) => {
  res.locals.adminLogin = req.session.loginIntent === "admin";
  next();
});
const emailOf = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
const otpDigest = (challenge, code) =>
  crypto
    .createHmac("sha256", require("./config/runtime").secret)
    .update(challenge + ":" + code)
    .digest("hex");
router.get("/giris", (req, res) => {
  if (req.query.mod === "yonetici") return res.redirect("/admin/giris");
  req.session.loginIntent = req.query.mod === "yonetici" ? "admin" : "family";
  res.render("family/login", {
    title: "Aile girişi",
    step: "email",
    message: null,
    adminLogin: req.session.loginIntent === "admin",
  });
});
router.get("/admin/giris", (req, res) => res.redirect("/giris?mod=yonetici"));
router.post(
  "/giris",
  wrap(async (req, res) => {
    const email = emailOf(req.body.email);
    if (
      (await limited("otp:ip:" + req.ip, 20, 900)) ||
      (await limited("otp:mail:" + email, 3, 900))
    )
      return res.status(429).render("family/login", {
        title: "Aile girişi",
        step: "email",
        message: "Çok fazla istek. Bir süre sonra tekrar deneyin.",
      });
    const user = (
      await pool.query(
        "SELECT u.id FROM users u WHERE email=$1 AND active=true AND EXISTS(SELECT 1 FROM memberships WHERE user_id=u.id)",
        [email],
      )
    ).rows[0];
    const challenge = crypto.randomUUID();
    if (user) {
      const code = String(crypto.randomInt(100000, 1000000));
      await pool.query(
        "UPDATE otp_codes SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [user.id],
      );
      await pool.query(
        "INSERT INTO otp_codes(user_id,challenge,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
        [user.id, challenge, otpDigest(challenge, code)],
      );
      await sendOtp(email, code);
    }
    req.session.challenge = challenge;
    res.render("family/login", {
      title: "Kodu doğrula",
      step: "code",
      message: "Davetli bir üyeyseniz kodunuz test posta kutusuna iletildi.",
    });
  }),
);
router.post(
  "/dogrula",
  wrap(async (req, res) => {
    if (await limited("verify:" + req.ip, 30, 900))
      return res.status(429).send("Deneme sınırı aşıldı.");
    const challenge = req.session.challenge,
      code = String(req.body.code || "").trim();
    let userId;
    if (challenge) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const record = (
          await c.query(
            "SELECT * FROM otp_codes WHERE challenge=$1 FOR UPDATE",
            [challenge],
          )
        ).rows[0];
        if (
          record &&
          !record.used_at &&
          new Date(record.expires_at) > new Date() &&
          record.attempts < 5
        ) {
          await c.query(
            "UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1",
            [record.id],
          );
          if (
            crypto.timingSafeEqual(
              Buffer.from(otpDigest(challenge, code), "hex"),
              Buffer.from(record.code_hash, "hex"),
            )
          ) {
            await c.query("UPDATE otp_codes SET used_at=now() WHERE id=$1", [
              record.id,
            ]);
            userId = record.user_id;
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
    if (!userId)
      return res.status(400).render("family/login", {
        title: "Kodu doğrula",
        step: "code",
        message: "Kod geçersiz, süresi dolmuş veya deneme sınırına ulaşılmış.",
      });
    const adminIntent = req.session.loginIntent === "admin";
    await new Promise((resolve, reject) =>
      req.session.regenerate((e) => (e ? reject(e) : resolve())),
    );
    req.session.userId = userId;
    req.session.authAt = Date.now();
    req.session.csrf = randomToken();
    res.redirect(adminIntent ? "/admin" : "/albumler");
  }),
);
router.get(
  "/davet/:token",
  wrap(async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.token))
      return res.status(404).send("Davet bulunamadı.");
    const invite = (
      await pool.query(
        "SELECT i.*,f.name family_name FROM invitations i JOIN families f ON f.id=i.family_id WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()",
        [digest(req.params.token)],
      )
    ).rows[0];
    if (!invite)
      return res.status(404).send("Davet geçersiz veya süresi dolmuş.");
    res.set("Referrer-Policy", "no-referrer");
    res.render("family/invite", {
      title: "Aileye katıl",
      invite,
      token: req.params.token,
    });
  }),
);
router.post(
  "/davet/:token",
  wrap(async (req, res) => {
    const name = String(req.body.name || "")
      .trim()
      .slice(0, 80);
    if (!name) return res.status(400).send("Adınızı girin.");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const invite = (
        await c.query(
          "SELECT * FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
          [digest(req.params.token)],
        )
      ).rows[0];
      if (!invite) {
        await c.query("ROLLBACK");
        return res.status(409).send("Davet kullanılmış veya geçersiz.");
      }
      const existing = (
        await c.query(
          "SELECT m.family_id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=$1",
          [invite.email],
        )
      ).rows;
      if (existing.some((m) => m.family_id !== invite.family_id)) {
        await c.query("ROLLBACK");
        return res
          .status(409)
          .send("Başka bir aileye kayıtlı hesap. Yöneticiyle görüşün.");
      }
      const u = (
        await c.query(
          "INSERT INTO users(email,name) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=excluded.email RETURNING id",
          [invite.email, name],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO memberships(user_id,family_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [u.id, invite.family_id, invite.role],
      );
      await c.query("UPDATE invitations SET used_at=now() WHERE id=$1", [
        invite.id,
      ]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/giris");
  }),
);
router.post(
  "/cikis-yap",
  wrap(async (req, res) => {
    await new Promise((ok, fail) =>
      req.session.destroy((e) => (e ? fail(e) : ok())),
    );
    res.clearCookie(
      require("./config/runtime").production
        ? "ataberk.family.sid"
        : "ataberk.dev.sid",
    );
    res.redirect("/");
  }),
);
router.get(["/cikis-yap", "/admin/cikis"], (req, res) =>
  res.render("family/logout", { title: "Çıkış" }),
);
module.exports = router;
