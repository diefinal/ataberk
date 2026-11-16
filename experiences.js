const express = require("express"),
  multer = require("multer"),
  sharp = require("sharp"),
  crypto = require("crypto"),
  fs = require("fs/promises"),
  path = require("path");
const { pool } = require("./db"),
  { runtime, secret } = require("./config/runtime"),
  { buildBook } = require("./photo-book");
const {
  wrap,
  requireUser,
  requireAdmin,
  albumAccess,
  mediaAccess,
  albumPredicate,
  audit,
  limited,
} = require("./security");
const { listAlbums } = require("./enhancements");
const router = express.Router(),
  acl = albumPredicate();
const storage = require("./storage");
const id = (v) =>
  /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : 0;
const text = (v, n = 200) =>
  String(v || "")
    .trim()
    .slice(0, n);
const day = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const key = crypto
  .createHash("sha256")
  .update("ataberk-time-capsule-v1:" + secret)
  .digest();
function seal(body) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv(
      "aes-256-gcm",
      require("./config/vault").vaultKey(),
      iv,
    ),
    encrypted = Buffer.concat([cipher.update(body, "utf8"), cipher.final()]);
  return [
    "v2",
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(".");
}
function unseal(value) {
  const v2 = value.startsWith("v2."),
    [iv, tag, body] = (v2 ? value.slice(3) : value)
      .split(".")
      .map((x) => Buffer.from(x, "hex")),
    cipher = crypto.createDecipheriv(
      "aes-256-gcm",
      v2 ? require("./config/vault").vaultKey() : key,
      iv,
    );
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 8, parts: 16 },
}).array("file", 8);
function multipart(req, res, next) {
  if (!req.get("x-csrf-token")) return res.sendStatus(403);
  const size = Number(req.get("content-length"));
  if (!Number.isFinite(size) || size > 32 * 1024 * 1024)
    return res.sendStatus(413);
  next();
}
async function image(buffer, avatar = false) {
  const img = sharp(buffer, { limitInputPixels: 40000000, failOn: "warning" }),
    meta = await img.metadata();
  if (!["jpeg", "png"].includes(meta.format) || !meta.width || !meta.height)
    throw Error("Only valid JPEG/PNG images");
  return avatar
    ? img.rotate().resize(256, 256, { fit: "cover" }).png().toBuffer()
    : img.rotate().toFormat(meta.format).toBuffer();
}
async function familyPeople(user) {
  return (
    await pool.query(
      "SELECT u.id,u.name,u.avatar_key FROM users u JOIN memberships z ON z.user_id=u.id WHERE z.family_id=$1 AND u.active ORDER BY u.name",
      [user.family_id],
    )
  ).rows;
}
router.get(
  "/profil",
  requireUser,
  wrap(async (req, res) =>
    res.render("family/profile", { title: "Benim köşem" }),
  ),
);
router.post(
  "/profil",
  requireUser,
  wrap(async (req, res) => {
    const name = text(req.body.name, 80),
      theme = req.body.theme;
    if (!name || !["system", "light", "dark"].includes(theme))
      return res.sendStatus(400);
    await pool.query("UPDATE users SET name=$1,theme=$2 WHERE id=$3", [
      name,
      theme,
      req.user.id,
    ]);
    res.redirect("/profil");
  }),
);
router.post(
  "/api/tema",
  requireUser,
  wrap(async (req, res) => {
    if (!["system", "light", "dark"].includes(req.body.theme))
      return res.sendStatus(400);
    await pool.query("UPDATE users SET theme=$1 WHERE id=$2", [
      req.body.theme,
      req.user.id,
    ]);
    res.json({ theme: req.body.theme });
  }),
);
router.post(
  "/profil/gorsel",
  requireUser,
  multipart,
  upload,
  wrap(async (req, res) => {
    if (req.files?.length !== 1) return res.sendStatus(400);
    let bytes;
    try {
      bytes = await image(req.files[0].buffer, true);
    } catch {
      return res.status(400).send("Geçerli JPEG veya PNG seçin.");
    }
    const k = crypto.randomUUID();
    await storage.put("avatars", k, bytes, "image/png");
    await pool.query("UPDATE users SET avatar_key=$1 WHERE id=$2", [
      k,
      req.user.id,
    ]);
    res.redirect("/profil");
  }),
);
router.get(
  "/private/avatar/:id",
  requireUser,
  wrap(async (req, res) => {
    const u = (
      await pool.query(
        "SELECT u.avatar_key FROM users u JOIN memberships z ON z.user_id=u.id WHERE u.id=$1 AND z.family_id=$2 AND u.active",
        [id(req.params.id), req.user.family_id],
      )
    ).rows[0];
    if (!u?.avatar_key) return res.sendStatus(404);
    res.type("png").set("Cache-Control", "private, no-store");
    await storage.serve(req, res, "avatars", u.avatar_key, "image/png");
  }),
);
router.get(
  "/katkilar",
  requireUser,
  wrap(async (req, res) => {
    const submissions = (
      await pool.query(
        `SELECT s.id,s.title,s.status,s.created_at,a.title album_title FROM submissions s JOIN albums a ON a.id=s.album_id WHERE s.user_id=$1 AND ${acl} ORDER BY s.id DESC`,
        [req.user.id],
      )
    ).rows;
    res.render("family/contributions", {
      title: "Birlikte tamamlayalım",
      albums: await listAlbums(req.user),
      submissions,
    });
  }),
);
router.post(
  "/katkilar",
  requireUser,
  multipart,
  upload,
  wrap(async (req, res) => {
    if (await limited("contribution:" + req.user.id, 12, 3600))
      return res.sendStatus(429);
    const album = await albumAccess(req.user, id(req.body.album_id));
    if (!album) return res.sendStatus(404);
    if (
      !text(req.body.title) ||
      !req.files?.length ||
      req.files.reduce((n, f) => n + f.size, 0) > 30 * 1024 * 1024
    )
      return res.sendStatus(400);
    let images;
    try {
      images = await Promise.all(req.files.map((f) => image(f.buffer)));
    } catch {
      return res
        .status(400)
        .send("Yalnız geçerli JPEG veya PNG fotoğrafları seçin.");
    }
    const c = await pool.connect(),
      written = [];
    try {
      await c.query("BEGIN");
      for (let i = 0; i < images.length; i++) {
        const k = crypto.randomUUID(),
          mime = images[i][0] === 137 ? "image/png" : "image/jpeg";
        await storage.put("private-media", k, images[i], mime);
        written.push({ key: k, mime });
        await c.query(
          "INSERT INTO submissions(album_id,user_id,title,description,storage_key,mime) VALUES($1,$2,$3,$4,$5,$6)",
          [
            album.id,
            req.user.id,
            text(req.body.title),
            text(req.body.description, 2000),
            k,
            images[i][0] === 137 ? "image/png" : "image/jpeg",
          ],
        );
      }
      await audit(req.user, "contribution.submit", album.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      for (const p of written)
        await storage.rollback("private-media", p.key, p.mime).catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/katkilar");
  }),
);
router.get(
  "/private/submission/:id",
  requireUser,
  wrap(async (req, res) => {
    const s = (
      await pool.query(
        "SELECT * FROM submissions WHERE id=$1 AND status<>'rejected'",
        [id(req.params.id)],
      )
    ).rows[0];
    if (!s || !(await albumAccess(req.user, s.album_id)))
      return res.sendStatus(404);
    if (
      s.user_id !== req.user.id &&
      req.user.role !== "family_admin" &&
      !req.user.super_admin
    )
      return res.sendStatus(404);
    res.type(s.mime).set("Cache-Control", "private, no-store");
    await storage.serve(req, res, "private-media", s.storage_key, s.mime);
  }),
);
router.get(
  "/admin/katkilar",
  requireAdmin,
  wrap(async (req, res) => {
    const submissions = (
      await pool.query(
        "SELECT s.*,a.title album_title,u.name author FROM submissions s JOIN albums a ON a.id=s.album_id JOIN users u ON u.id=s.user_id WHERE a.family_id=$1 AND s.status='pending' ORDER BY s.id",
        [req.user.family_id],
      )
    ).rows;
    res.render("family/review", {
      title: "Aile katkılarını incele",
      submissions,
    });
  }),
);
router.post(
  "/admin/katkilar/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const decision = req.body.decision;
    if (
      !["approve", "reject"].includes(decision) ||
      req.body.confirm !== "ONAYLIYORUM"
    )
      return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const s = (
        await c.query(
          "SELECT s.* FROM submissions s JOIN albums a ON a.id=s.album_id WHERE s.id=$1 AND a.family_id=$2 FOR UPDATE OF s",
          [id(req.params.id), req.user.family_id],
        )
      ).rows[0];
      if (!s) {
        await c.query("ROLLBACK");
        return res.sendStatus(404);
      }
      if (s.status !== "pending") {
        await c.query("ROLLBACK");
        return res.sendStatus(409);
      }
      let mid = null;
      if (decision === "approve")
        mid = (
          await c.query(
            "INSERT INTO media(album_id,title,description,type,storage_key,mime,original_name) VALUES($1,$2,$3,'image',$4,$5,'aile-katkisi') RETURNING id",
            [s.album_id, s.title, s.description, s.storage_key, s.mime],
          )
        ).rows[0].id;
      await c.query(
        "UPDATE submissions SET status=$1,media_id=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$4",
        [
          decision === "approve" ? "approved" : "rejected",
          mid,
          req.user.id,
          s.id,
        ],
      );
      await audit(req.user, "contribution." + decision, s.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/admin/katkilar");
  }),
);
router.get(
  "/medya/:id/hikaye",
  requireAdmin,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    const people = await familyPeople(req.user),
      tagged = (
        await pool.query("SELECT user_id FROM media_people WHERE media_id=$1", [
          media.id,
        ])
      ).rows.map((r) => r.user_id),
      posters = (
        await pool.query(
          "SELECT id,title FROM media WHERE album_id=$1 AND type='image' AND deleted_at IS NULL ORDER BY id",
          [media.album_id],
        )
      ).rows;
    res.render("family/story-edit", {
      title: "Fotoğrafın hikâyesi",
      media,
      people,
      tagged,
      posters,
    });
  }),
);
router.post(
  "/medya/:id/hikaye",
  requireAdmin,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    const date = req.body.taken_on || null,
      place = String(req.body.place_text || "").trim(),
      people = [...new Set([req.body.people || []].flat().map(id))],
      poster = req.body.poster_media_id ? id(req.body.poster_media_id) : null;
    if (
      (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
      place.length > 160 ||
      people.length > 50 ||
      people.includes(0)
    )
      return res.sendStatus(400);
    const members = await familyPeople(req.user);
    if (people.some((p) => !members.some((m) => m.id === p)))
      return res.sendStatus(400);
    if (poster) {
      const p = await mediaAccess(req.user, poster);
      if (
        media.type !== "video" ||
        !p ||
        p.type !== "image" ||
        p.album_id !== media.album_id
      )
        return res.sendStatus(400);
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "UPDATE media SET taken_on=$1,place_text=$2,poster_media_id=$3 WHERE id=$4",
        [date, place, poster, media.id],
      );
      await c.query("DELETE FROM media_people WHERE media_id=$1", [media.id]);
      for (const p of people)
        await c.query(
          "INSERT INTO media_people(media_id,user_id) VALUES($1,$2)",
          [media.id, p],
        );
      await audit(req.user, "media.story", media.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/medya/" + media.id);
  }),
);
router.get(
  "/kapsuller",
  requireUser,
  wrap(async (req, res) => {
    const capsules = (
      await pool.query(
        `SELECT t.id,t.title,t.opens_on,t.user_id,u.name author,a.title album_title,(t.opens_on <= (now() AT TIME ZONE 'Europe/Istanbul')::date) unlocked FROM time_capsules t JOIN albums a ON a.id=t.album_id JOIN users u ON u.id=t.user_id WHERE t.deleted_at IS NULL AND ${acl} ORDER BY t.opens_on,t.id`,
        [req.user.id],
      )
    ).rows;
    res.render("family/capsules", {
      title: "Zaman kapsülleri",
      capsules,
      albums: await listAlbums(req.user),
      today: day(),
    });
  }),
);
router.post(
  "/kapsuller",
  requireUser,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.body.album_id)),
      date = String(req.body.opens_on || ""),
      title = text(req.body.title),
      body = String(req.body.body || "").trim();
    if (!album) return res.sendStatus(404);
    if (
      !title ||
      !body ||
      body.length > 6000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date < day() ||
      Number(date.slice(0, 4)) > new Date().getFullYear() + 100
    )
      return res.sendStatus(400);
    if (await limited("capsule:" + req.user.id, 10, 3600))
      return res.sendStatus(429);
    await pool.query(
      "INSERT INTO time_capsules(album_id,user_id,title,sealed_body,opens_on) VALUES($1,$2,$3,$4,$5)",
      [album.id, req.user.id, title, seal(body), date],
    );
    res.redirect("/kapsuller");
  }),
);
router.get(
  "/kapsul/:id",
  requireUser,
  wrap(async (req, res) => {
    const capsule = (
      await pool.query(
        `SELECT t.id,t.title,t.opens_on,t.user_id,u.name author,a.title album_title,t.sealed_body FROM time_capsules t JOIN albums a ON a.id=t.album_id JOIN users u ON u.id=t.user_id WHERE t.id=$2 AND t.deleted_at IS NULL AND t.opens_on <= (now() AT TIME ZONE 'Europe/Istanbul')::date AND ${acl}`,
        [req.user.id, id(req.params.id)],
      )
    ).rows[0];
    if (!capsule)
      return res
        .status(404)
        .send("Kapsül henüz açılmadı veya erişim izniniz yok.");
    const body = unseal(capsule.sealed_body);
    delete capsule.sealed_body;
    res.render("family/capsule", { title: capsule.title, capsule, body });
  }),
);
router.post(
  "/kapsul/:id/kaldir",
  requireUser,
  wrap(async (req, res) => {
    const c = (
      await pool.query(
        `SELECT t.id,t.user_id FROM time_capsules t JOIN albums a ON a.id=t.album_id WHERE t.id=$2 AND t.deleted_at IS NULL AND ${acl}`,
        [req.user.id, id(req.params.id)],
      )
    ).rows[0];
    if (!c) return res.sendStatus(404);
    if (
      c.user_id !== req.user.id &&
      req.user.role !== "family_admin" &&
      !req.user.super_admin
    )
      return res.sendStatus(403);
    if (req.body.confirm !== "KALDIR") return res.sendStatus(400);
    await pool.query("UPDATE time_capsules SET deleted_at=now() WHERE id=$1", [
      c.id,
    ]);
    await audit(req.user, "capsule.soft_delete", c.id);
    res.redirect("/kapsuller");
  }),
);
router.get(
  "/album/:id/kitapcik",
  requireUser,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.params.id));
    if (!album) return res.sendStatus(404);
    const items = (
      await pool.query(
        "SELECT id,title FROM media WHERE album_id=$1 AND type='image' AND deleted_at IS NULL ORDER BY created_at,id",
        [album.id],
      )
    ).rows;
    res.render("family/book", { title: "Anı kitapçığı", album, items });
  }),
);
router.post(
  "/album/:id/kitapcik",
  requireUser,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.params.id));
    if (!album) return res.sendStatus(404);
    if (await limited("book:" + req.user.id, 5, 600))
      return res.sendStatus(429);
    const ids = [...new Set([req.body.media_ids || []].flat().map(id))];
    if (!ids.length || ids.length > 20 || ids.includes(0))
      return res.status(400).send("1 ile 20 arasında fotoğraf seçin.");
    const items = (
      await pool.query(
        "SELECT m.*, (SELECT string_agg(u.name,', ' ORDER BY u.name) FROM media_people p JOIN users u ON u.id=p.user_id WHERE p.media_id=m.id) people_names FROM media m WHERE m.id=ANY($1::int[]) AND m.album_id=$2 AND m.type='image' AND m.deleted_at IS NULL ORDER BY m.taken_on NULLS LAST,m.created_at,m.id",
        [ids, album.id],
      )
    ).rows;
    if (items.length !== ids.length) return res.sendStatus(404);
    const bytes = await buildBook(album, items);
    res
      .set({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="aile-ani-kitapcigi.pdf"',
        "Cache-Control": "private, no-store",
      })
      .send(bytes);
  }),
);
router.get(
  "/admin/vitrin",
  requireAdmin,
  wrap(async (req, res) => {
    const f = (
      await pool.query("SELECT featured_album_id FROM families WHERE id=$1", [
        req.user.family_id,
      ])
    ).rows[0];
    res.render("family/featured-edit", {
      title: "Ana sayfa vitrini",
      albums: await listAlbums(req.user),
      featured: f.featured_album_id,
    });
  }),
);
router.post(
  "/admin/vitrin",
  requireAdmin,
  wrap(async (req, res) => {
    const featured = req.body.album_id ? id(req.body.album_id) : null;
    if (featured && !(await albumAccess(req.user, featured)))
      return res.sendStatus(404);
    await pool.query("UPDATE families SET featured_album_id=$1 WHERE id=$2", [
      featured,
      req.user.family_id,
    ]);
    await audit(req.user, "family.featured", featured || "none");
    res.redirect("/admin/vitrin");
  }),
);
router.get("/kesif", (req, res) =>
  res.render("family/workshop", { title: "Keşif atölyesi" }),
);
module.exports = { router, seal, unseal };
