const express = require("express"),
  fs = require("fs/promises"),
  path = require("path"),
  crypto = require("crypto"),
  multer = require("multer"),
  sharp = require("sharp");
const { runtime } = require("./config/runtime"),
  { pool } = require("./db"),
  { sendMail } = require("./mailer");
const {
  wrap,
  requireUser,
  requireAdmin,
  albumPredicate,
  albumAccess,
  mediaAccess,
  audit,
  digest,
  randomToken,
} = require("./security");
const router = express.Router(),
  privateDir = path.join(runtime, "private-media");
const storage = require("./storage");
const id = (v) =>
  /^\d+$/.test(String(v)) && Number(v) > 0 && Number.isSafeInteger(Number(v))
    ? Number(v)
    : 0;
const text = (v, max = 200) =>
  String(v || "")
    .trim()
    .slice(0, max);
const acl = albumPredicate();
async function albums(user) {
  return require("./enhancements").listAlbums(user);
}
async function mediaList(user, extra = "", params = []) {
  return (
    await pool.query(
      `SELECT m.*,CASE WHEN EXISTS(SELECT 1 FROM media poster WHERE poster.id=m.poster_media_id AND poster.album_id=m.album_id AND poster.type='image' AND poster.deleted_at IS NULL) THEN m.poster_media_id END poster_id,a.title album_title FROM media m JOIN albums a ON a.id=m.album_id WHERE m.deleted_at IS NULL AND ${acl} ${extra} ORDER BY m.created_at DESC`,
      [user.id, ...params],
    )
  ).rows;
}
router.get(
  "/",
  wrap(async (req, res) =>
    res.render("family/home", {
      title: "Küçük anlar, kocaman bir dünya",
      ...(await require("./enhancements").dashboard(req.user)),
    }),
  ),
);
router.get(
  "/albumler",
  requireUser,
  wrap(async (req, res) =>
    res.render("family/albums", {
      title: "Aile albümleri",
      albums: await albums(req.user),
    }),
  ),
);
router.get(
  "/album/:id",
  requireUser,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.params.id));
    if (!album) return res.sendStatus(404);
    res.render("family/gallery", {
      title: album.title,
      description: album.description,
      items: await mediaList(req.user, "AND a.id=$2", [album.id]),
      album,
    });
  }),
);
router.get(
  ["/fotograflar", "/videolar"],
  requireUser,
  wrap(async (req, res) => {
    const video = req.path === "/videolar";
    res.render("family/gallery", {
      title: video ? "Video galerisi" : "Fotoğraflar",
      description: "Yalnız size açılan albümlerdeki aile anıları.",
      items: await mediaList(req.user, "AND m.type=$2", [
        video ? "video" : "image",
      ]),
    });
  }),
);
router.get(
  "/ara",
  requireUser,
  wrap(async (req, res) => {
    const q = text(req.query.q, 100);
    res.render("family/gallery", {
      title: "Anılarda ara",
      description: q
        ? `“${q}” için sonuçlar`
        : "Bir başlık veya açıklama arayın.",
      items: q
        ? await mediaList(
            req.user,
            "AND (m.title ILIKE $2 OR m.description ILIKE $2 OR a.title ILIKE $2)",
            ["%" + q + "%"],
          )
        : [],
    });
  }),
);
router.get(
  "/kategori/:slug",
  requireUser,
  wrap(async (req, res) => {
    res.render("family/gallery", {
      title: "Kategori",
      description: "Erişebildiğiniz içerikler",
      items: await mediaList(
        req.user,
        "AND m.category_id=(SELECT id FROM categories WHERE slug=$2)",
        [text(req.params.slug)],
      ),
    });
  }),
);
router.get(
  "/aile-medya/:id",
  requireUser,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    await pool.query("UPDATE media SET views=views+1 WHERE id=$1", [media.id]);
    const comments = (
      await pool.query(
        "SELECT c.*,u.name author FROM comments c JOIN users u ON u.id=c.user_id WHERE media_id=$1 ORDER BY created_at",
        [media.id],
      )
    ).rows;
    const isFavorite = !!(
      await pool.query(
        "SELECT 1 FROM favorites WHERE user_id=$1 AND media_id=$2",
        [req.user.id, media.id],
      )
    ).rowCount;
    const people = (
      await pool.query(
        "SELECT u.id,u.name FROM media_people p JOIN users u ON u.id=p.user_id WHERE p.media_id=$1 ORDER BY u.name",
        [media.id],
      )
    ).rows;
    const voices = (
      await pool.query(
        "SELECT v.id,v.user_id,v.caption,v.duration,v.created_at,u.name author FROM voice_notes v JOIN users u ON u.id=v.user_id WHERE v.media_id=$1 AND v.deleted_at IS NULL ORDER BY v.id",
        [media.id],
      )
    ).rows;
    res.render("family/media", {
      title: media.title,
      media,
      comments,
      isFavorite,
      people,
      voices,
    });
  }),
);
async function deliver(req, res, download = false) {
  if (!req.user) return res.sendStatus(401);
  const media = await mediaAccess(req.user, id(req.params.id));
  if (!media) return res.sendStatus(404);
  if (!/^[a-f0-9-]{36}$/.test(media.storage_key)) return res.sendStatus(404);
  res.set({
    "Content-Type": media.mime,
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="family-${media.id}.${media.mime.split("/")[1].replace("jpeg", "jpg")}"`,
  });
  if (download)
    await pool.query("UPDATE media SET downloads=downloads+1 WHERE id=$1", [
      media.id,
    ]);
  await storage.serve(req, res, "private-media", media.storage_key, media.mime);
}
router.get(
  "/private/media/:id",
  wrap((req, res) => deliver(req, res)),
);
router.get(
  "/aile-api/indir/:id",
  wrap((req, res) => deliver(req, res, true)),
);
router.post(
  "/aile-api/yorum/:id",
  requireUser,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    const content = text(req.body.content, 501);
    if (!content || content.length > 500) return res.sendStatus(400);
    await pool.query(
      "INSERT INTO comments(media_id,user_id,content) VALUES($1,$2,$3)",
      [media.id, req.user.id, content],
    );
    res.redirect("/aile-medya/" + media.id);
  }),
);
router.get(
  "/aile-api/reaksiyon/:id",
  requireUser,
  wrap(async (req, res) => {
    if (!(await mediaAccess(req.user, id(req.params.id))))
      return res.sendStatus(404);
    const rows = (
      await pool.query(
        "SELECT emoji,count(*)::int count FROM reactions WHERE media_id=$1 GROUP BY emoji",
        [id(req.params.id)],
      )
    ).rows;
    const own = (
      await pool.query(
        "SELECT emoji FROM reactions WHERE media_id=$1 AND user_id=$2",
        [id(req.params.id), req.user.id],
      )
    ).rows[0];
    res.json({
      counts: Object.fromEntries(rows.map((r) => [r.emoji, r.count])),
      userEmoji: own?.emoji || null,
    });
  }),
);
router.post(
  "/aile-api/reaksiyon/:id",
  requireUser,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id)),
      emoji = req.body.emoji;
    if (!media) return res.sendStatus(404);
    if (!["❤️", "😍", "🔥", "👏"].includes(emoji)) return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock($1,$2)", [
        media.id,
        req.user.id,
      ]);
      const old = (
        await c.query(
          "SELECT emoji FROM reactions WHERE media_id=$1 AND user_id=$2",
          [media.id, req.user.id],
        )
      ).rows[0];
      if (old?.emoji === emoji)
        await c.query(
          "DELETE FROM reactions WHERE media_id=$1 AND user_id=$2",
          [media.id, req.user.id],
        );
      else
        await c.query(
          "INSERT INTO reactions(media_id,user_id,emoji) VALUES($1,$2,$3) ON CONFLICT(media_id,user_id) DO UPDATE SET emoji=$3",
          [media.id, req.user.id, emoji],
        );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/aile-medya/" + media.id);
  }),
);
router.get(
  "/anilar",
  requireUser,
  wrap(async (req, res) => {
    const memories = (
      await pool.query(
        `SELECT t.*,a.title album_title FROM memories t JOIN albums a ON a.id=t.album_id WHERE t.deleted_at IS NULL AND ${acl} ORDER BY t.occurred_on DESC`,
        [req.user.id],
      )
    ).rows;
    res.render("family/timeline", { title: "Anı zaman çizelgesi", memories });
  }),
);
router.get(
  "/ani/:id",
  requireUser,
  wrap(async (req, res) => {
    const memory = (
      await pool.query(
        `SELECT t.*,a.title album_title FROM memories t JOIN albums a ON a.id=t.album_id WHERE t.id=$2 AND t.deleted_at IS NULL AND ${acl}`,
        [req.user.id, id(req.params.id)],
      )
    ).rows[0];
    if (!memory) return res.sendStatus(404);
    const items = await mediaList(
      req.user,
      "AND m.id IN(SELECT media_id FROM memory_media WHERE memory_id=$2)",
      [memory.id],
    );
    res.render("family/memory", { title: memory.title, memory, items });
  }),
);
router.get(
  "/aile",
  requireUser,
  wrap(async (req, res) => {
    const members = (
      await pool.query(
        "SELECT u.id,u.name,u.avatar_key,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE family_id=$1 AND u.active ORDER BY u.name",
        [req.user.family_id],
      )
    ).rows;
    res.render("family/members", { title: "Bizim aile", members });
  }),
);
router.get(
  "/admin",
  requireAdmin,
  wrap(async (req, res) => {
    const list = await albums(req.user),
      members = (
        await pool.query(
          "SELECT u.id,u.name,u.email,u.active,u.super_admin,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE family_id=$1 ORDER BY u.name",
          [req.user.family_id],
        )
      ).rows;
    const logs = (
      await pool.query(
        "SELECT l.*,u.name actor FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE l.family_id=$1 ORDER BY l.id DESC LIMIT 100",
        [req.user.family_id],
      )
    ).rows;
    const items = await mediaList(req.user),
      permissions = (
        await pool.query(
          "SELECT p.* FROM album_permissions p JOIN albums a ON a.id=p.album_id WHERE a.family_id=$1",
          [req.user.family_id],
        )
      ).rows;
    const memories = (
      await pool.query(
        "SELECT t.* FROM memories t JOIN albums a ON a.id=t.album_id WHERE a.family_id=$1 AND t.deleted_at IS NULL ORDER BY occurred_on DESC",
        [req.user.family_id],
      )
    ).rows;
    const archivedMemories = (
      await pool.query(
        "SELECT t.* FROM memories t JOIN albums a ON a.id=t.album_id WHERE a.family_id=$1 AND t.deleted_at IS NOT NULL ORDER BY t.deleted_at DESC",
        [req.user.family_id],
      )
    ).rows;
    res.render("family/admin", {
      title: "Aile yönetimi",
      albums: list,
      members,
      logs,
      items,
      permissions,
      memories,
      archivedMemories,
    });
  }),
);
router.get(
  [
    "/admin/yukle",
    "/admin/kategoriler",
    "/admin/yorumlar",
    "/admin/duzenle/:id",
  ],
  requireAdmin,
  (req, res) => res.redirect("/admin"),
);
router.post(
  "/admin/albumler",
  requireAdmin,
  wrap(async (req, res) => {
    const title = text(req.body.title);
    if (!title) return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const a = (
        await c.query(
          "INSERT INTO albums(family_id,title,description) VALUES($1,$2,$3) RETURNING id",
          [req.user.family_id, title, text(req.body.description, 2000)],
        )
      ).rows[0];
      await audit(req.user, "album.create", a.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/albumler/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const a = await albumAccess(req.user, id(req.params.id));
    if (!a) return res.sendStatus(404);
    if (!text(req.body.title)) return res.sendStatus(400);
    await pool.query("UPDATE albums SET title=$1,description=$2 WHERE id=$3", [
      text(req.body.title),
      text(req.body.description, 2000),
      a.id,
    ]);
    await audit(req.user, "album.update", a.id);
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/davet",
  requireAdmin,
  wrap(async (req, res) => {
    const email = text(req.body.email, 254).toLowerCase(),
      role = req.body.role;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !["member", "family_admin"].includes(role)
    )
      return res.sendStatus(400);
    const token = randomToken(),
      inviteId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO invitations(id,family_id,email,role,token_hash,expires_at,created_by) VALUES($1,$2,$3,$4,$5,now()+interval '48 hours',$6)",
      [inviteId, req.user.family_id, email, role, digest(token), req.user.id],
    );
    await audit(req.user, "invitation.create", inviteId);
    await sendMail({
      to: email,
      kind: "invitation",
      url:
        (require("./config/runtime").origin || "http://127.0.0.1:4317") +
        "/davet/" +
        token,
    });
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/izin",
  requireAdmin,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.body.album_id));
    const member = (
      await pool.query(
        "SELECT * FROM memberships WHERE user_id=$1 AND family_id=$2",
        [id(req.body.user_id), req.user.family_id],
      )
    ).rows[0];
    if (!album || !member) return res.sendStatus(404);
    if (req.body.allowed === "yes")
      await pool.query(
        "INSERT INTO album_permissions(album_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [album.id, id(req.body.user_id)],
      );
    else
      await pool.query(
        "DELETE FROM album_permissions WHERE album_id=$1 AND user_id=$2",
        [album.id, id(req.body.user_id)],
      );
    await audit(
      req.user,
      "album.permission",
      `${album.id}:${id(req.body.user_id)}:${req.body.allowed === "yes"}`,
    );
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/uyeler/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const target = id(req.params.id),
      role = req.body.role,
      active = req.body.active === "yes";
    if (target === req.user.id || !["member", "family_admin"].includes(role))
      return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const member = (
        await c.query(
          "SELECT u.super_admin FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=$1 AND m.family_id=$2 FOR UPDATE",
          [target, req.user.family_id],
        )
      ).rows[0];
      if (!member || member.super_admin) {
        await c.query("ROLLBACK");
        return res.sendStatus(403);
      }
      await c.query(
        "UPDATE memberships SET role=$1 WHERE user_id=$2 AND family_id=$3",
        [role, target, req.user.family_id],
      );
      await c.query("UPDATE users SET active=$1 WHERE id=$2", [active, target]);
      await c.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [
        String(target),
      ]);
      await audit(req.user, "member.update", target, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/anilar",
  requireAdmin,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.body.album_id)),
      date = text(req.body.occurred_on, 10);
    if (!album || !text(req.body.title) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const memory = (
        await c.query(
          "INSERT INTO memories(album_id,title,description,occurred_on,kind) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            album.id,
            text(req.body.title),
            text(req.body.description, 4000),
            date,
            req.body.kind === "first" ? "first" : "story",
          ],
        )
      ).rows[0];
      const ids = [req.body.media_ids || []].flat().map(id).filter(Boolean);
      for (const mid of ids) {
        const valid = (
          await c.query(
            "SELECT id FROM media WHERE id=$1 AND album_id=$2 AND deleted_at IS NULL",
            [mid, album.id],
          )
        ).rows[0];
        if (!valid)
          throw Object.assign(Error("Invalid memory media"), { code: "23514" });
        await c.query(
          "INSERT INTO memory_media(memory_id,media_id) VALUES($1,$2)",
          [memory.id, mid],
        );
      }
      await audit(req.user, "memory.create", memory.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/anilar");
  }),
);
router.post(
  "/admin/anilar/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const memory = (
      await pool.query(
        "SELECT t.* FROM memories t JOIN albums a ON a.id=t.album_id WHERE t.id=$1 AND a.family_id=$2 AND t.deleted_at IS NULL",
        [id(req.params.id), req.user.family_id],
      )
    ).rows[0];
    if (!memory) return res.sendStatus(404);
    if (
      !text(req.body.title) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body.occurred_on))
    )
      return res.sendStatus(400);
    await pool.query(
      "UPDATE memories SET title=$1,description=$2,occurred_on=$3,kind=$5 WHERE id=$4",
      [
        text(req.body.title),
        text(req.body.description, 4000),
        req.body.occurred_on,
        memory.id,
        req.body.kind === undefined
          ? memory.kind
          : req.body.kind === "first"
            ? "first"
            : "story",
      ],
    );
    await audit(req.user, "memory.update", memory.id);
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/ani-kaldir/:id",
  requireAdmin,
  wrap(async (req, res) => {
    if (req.body.confirm !== "SİL") return res.sendStatus(400);
    const r = await pool.query(
      "UPDATE memories t SET deleted_at=now() FROM albums a WHERE t.album_id=a.id AND t.id=$1 AND a.family_id=$2 AND t.deleted_at IS NULL RETURNING t.id",
      [id(req.params.id), req.user.family_id],
    );
    if (!r.rowCount) return res.sendStatus(404);
    await audit(req.user, "memory.soft_delete", r.rows[0].id);
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/ani-geri-al/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const r = await pool.query(
      "UPDATE memories t SET deleted_at=NULL FROM albums a WHERE t.album_id=a.id AND t.id=$1 AND a.family_id=$2 AND t.deleted_at IS NOT NULL RETURNING t.id",
      [id(req.params.id), req.user.family_id],
    );
    if (!r.rowCount) return res.sendStatus(404);
    await audit(req.user, "memory.restore", r.rows[0].id);
    res.redirect("/admin");
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 10, fields: 8, parts: 18 },
}).array("file", 10);
function sniff(b) {
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.readUInt32BE(16) * b.readUInt32BE(20) <= 40000000
  )
    return "image/png";
  if (
    b.length >= 4 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b[b.length - 2] === 255 &&
    b[b.length - 1] === 217
  )
    return "image/jpeg";
  if (
    b.length >= 16 &&
    b.toString("ascii", 4, 8) === "ftyp" &&
    ["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1"].includes(
      b.toString("ascii", 8, 12),
    )
  )
    return "video/mp4";
  return null;
}
router.post(
  "/admin/yukle",
  requireAdmin,
  (req, res, next) => {
    if (!req.get("x-csrf-token")) return res.sendStatus(403);
    if (
      !Number.isFinite(Number(req.get("content-length"))) ||
      Number(req.get("content-length")) > 61 * 1024 * 1024
    )
      return res.status(413).send("Yükleme boyut sınırı.");
    next();
  },
  upload,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.body.album_id));
    if (!album) return res.sendStatus(404);
    if (
      !req.files?.length ||
      req.files.reduce((s, f) => s + f.size, 0) > 60 * 1024 * 1024
    )
      return res.status(400).send("Toplam yükleme en fazla 60 MB olabilir.");
    const parsed = req.files.map((f) => ({ ...f, detected: sniff(f.buffer) }));
    if (parsed.some((f) => !f.detected))
      return res
        .status(400)
        .send("Yalnız geçerli PNG, JPEG ve MP4 dosyaları desteklenir.");
    try {
      for (const f of parsed) {
        if (f.detected.startsWith("image/")) {
          const image = sharp(f.buffer, {
            limitInputPixels: 40000000,
            failOn: "warning",
          });
          const meta = await image.metadata();
          if (
            !meta.width ||
            !meta.height ||
            meta.width * meta.height > 40000000
          )
            throw Error("Invalid dimensions");
          f.buffer = await image
            .rotate()
            .toFormat(f.detected === "image/png" ? "png" : "jpeg")
            .toBuffer();
        } else {
          let offset = 0,
            moov = false,
            mdat = false;
          while (offset + 8 <= f.buffer.length) {
            const size = f.buffer.readUInt32BE(offset),
              type = f.buffer.toString("ascii", offset + 4, offset + 8);
            if (size < 8 || offset + size > f.buffer.length)
              throw Error("Invalid MP4 box");
            if (type === "moov") moov = true;
            if (type === "mdat" && size > 8) mdat = true;
            offset += size;
          }
          if (!moov || !mdat || offset !== f.buffer.length)
            throw Error("Invalid MP4 structure");
        }
      }
    } catch {
      return res.status(400).send("Dosya içeriği doğrulanamadı.");
    }
    const written = [],
      c = await pool.connect();
    try {
      await c.query("BEGIN");
      for (const f of parsed) {
        const key = crypto.randomUUID();
        await storage.put("private-media", key, f.buffer, f.detected);
        written.push({ key, mime: f.detected });
        const m = (
          await c.query(
            "INSERT INTO media(album_id,title,description,type,storage_key,mime,original_name) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            [
              album.id,
              text(req.body.title) || "Yeni aile anısı",
              text(req.body.description, 2000),
              f.detected.startsWith("video/") ? "video" : "image",
              key,
              f.detected,
              text(f.originalname, 160),
            ],
          )
        ).rows[0];
        await audit(req.user, "media.upload", m.id, c);
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      for (const f of written)
        await storage.rollback("private-media", f.key, f.mime).catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/duzenle/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const m = await mediaAccess(req.user, id(req.params.id));
    if (!m) return res.sendStatus(404);
    if (!text(req.body.title)) return res.sendStatus(400);
    await pool.query("UPDATE media SET title=$1,description=$2 WHERE id=$3", [
      text(req.body.title),
      text(req.body.description, 2000),
      m.id,
    ]);
    await audit(req.user, "media.update", m.id);
    res.redirect("/admin");
  }),
);
router.get(
  "/admin/sil/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    res.render("family/delete", { title: "Silmeyi onayla", media });
  }),
);
router.post(
  "/admin/sil/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const m = await mediaAccess(req.user, id(req.params.id));
    if (!m) return res.sendStatus(404);
    if (req.body.confirm !== "SİL") return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE media SET deleted_at=now() WHERE id=$1", [m.id]);
      await audit(req.user, "media.soft_delete", m.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/geri-al/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const m = (
      await pool.query(
        "SELECT m.* FROM media m JOIN albums a ON a.id=m.album_id WHERE m.id=$1 AND a.family_id=$2 AND m.deleted_at IS NOT NULL",
        [id(req.params.id), req.user.family_id],
      )
    ).rows[0];
    if (!m) return res.sendStatus(404);
    await pool.query("UPDATE media SET deleted_at=NULL WHERE id=$1", [m.id]);
    await audit(req.user, "media.restore", m.id);
    res.redirect("/admin");
  }),
);
router.post(
  "/admin/yorumlar/sil/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const c = (
      await pool.query("SELECT * FROM comments WHERE id=$1", [
        id(req.params.id),
      ])
    ).rows[0];
    if (!c || !(await mediaAccess(req.user, c.media_id)))
      return res.sendStatus(404);
    await pool.query("DELETE FROM comments WHERE id=$1", [c.id]);
    await audit(req.user, "comment.delete", c.id);
    res.redirect("/admin");
  }),
);
module.exports = router;
module.exports.sniff = sniff;
