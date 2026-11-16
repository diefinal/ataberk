const express = require("express"),
  { pool } = require("./db");
const {
  wrap,
  requireUser,
  requireAdmin,
  albumPredicate,
  albumAccess,
  mediaAccess,
  audit,
  limited,
} = require("./security");
const router = express.Router(),
  acl = albumPredicate();
const id = (v) =>
  /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : 0;
const coverSql = `coalesce((SELECT m.id FROM media m WHERE m.id=a.cover_media_id AND m.album_id=a.id AND m.type='image' AND m.deleted_at IS NULL),(SELECT m.id FROM media m WHERE m.album_id=a.id AND m.type='image' AND m.deleted_at IS NULL ORDER BY m.created_at DESC,m.id DESC LIMIT 1))`;
async function listAlbums(user) {
  return (
    await pool.query(
      `SELECT a.*,${coverSql} cover_id,(SELECT count(*) FROM media m WHERE m.album_id=a.id AND m.deleted_at IS NULL)::int media_count FROM albums a WHERE ${acl} ORDER BY a.created_at DESC,a.id DESC`,
      [user.id],
    )
  ).rows;
}
async function notesFor(user) {
  return (
    await pool.query(
      `SELECT n.*,u.name author,a.title album_title FROM family_notes n JOIN users u ON u.id=n.user_id JOIN albums a ON a.id=n.album_id WHERE n.deleted_at IS NULL AND ${acl} ORDER BY n.created_at DESC,n.id DESC LIMIT 50`,
      [user.id],
    )
  ).rows;
}
async function dashboard(user, now = new Date()) {
  const dateLabel = now.toLocaleDateString("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Istanbul",
  });
  if (!user) return { dateLabel, overview: null };
  const date = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  const [albums, latest, memories, notes, counts] = await Promise.all([
    listAlbums(user),
    pool.query(
      `SELECT m.*,CASE WHEN EXISTS(SELECT 1 FROM media poster WHERE poster.id=m.poster_media_id AND poster.album_id=m.album_id AND poster.type='image' AND poster.deleted_at IS NULL) THEN m.poster_media_id END poster_id,a.title album_title FROM media m JOIN albums a ON a.id=m.album_id WHERE m.deleted_at IS NULL AND ${acl} ORDER BY m.created_at DESC,m.id DESC LIMIT 4`,
      [user.id],
    ),
    pool.query(
      `SELECT t.*,a.title album_title,to_char(t.occurred_on,'YYYY-MM-DD') day_key FROM memories t JOIN albums a ON a.id=t.album_id WHERE t.deleted_at IS NULL AND ${acl} ORDER BY t.occurred_on DESC,t.id DESC`,
      [user.id],
    ),
    notesFor(user),
    pool.query(
      `SELECT count(*)::int total,count(*) FILTER(WHERE m.type='video')::int videos FROM media m JOIN albums a ON a.id=m.album_id WHERE m.deleted_at IS NULL AND ${acl}`,
      [user.id],
    ),
  ]);
  const onThisDay = memories.rows.filter(
    (m) =>
      m.day_key.slice(5) === date.slice(5) &&
      m.day_key.slice(0, 4) < date.slice(0, 4),
  );
  return {
    dateLabel,
    overview: {
      albums: albums.slice(0, 3),
      albumCount: albums.length,
      latest: latest.rows,
      memories: memories.rows.slice(0, 3),
      firsts: memories.rows.filter((m) => m.kind === "first").slice(0, 3),
      onThisDay,
      notes: notes.slice(0, 3),
      ...counts.rows[0],
      featured:
        (
          await pool.query(
            `SELECT a.*,${coverSql} cover_id FROM families f JOIN albums a ON a.id=f.featured_album_id WHERE f.id=$2 AND ${acl}`,
            [user.id, user.family_id],
          )
        ).rows[0] || null,
    },
  };
}
router.get(
  "/ilkler",
  requireUser,
  wrap(async (req, res) => {
    const memories = (
      await pool.query(
        `SELECT t.*,a.title album_title FROM memories t JOIN albums a ON a.id=t.album_id WHERE t.deleted_at IS NULL AND t.kind='first' AND ${acl} ORDER BY t.occurred_on,t.id`,
        [req.user.id],
      )
    ).rows;
    res.render("family/firsts", { title: "Ataberk’in ilkleri", memories });
  }),
);
router.get(
  "/favoriler",
  requireUser,
  wrap(async (req, res) => {
    const items = (
      await pool.query(
        `SELECT m.*,CASE WHEN EXISTS(SELECT 1 FROM media poster WHERE poster.id=m.poster_media_id AND poster.album_id=m.album_id AND poster.type='image' AND poster.deleted_at IS NULL) THEN m.poster_media_id END poster_id,a.title album_title FROM favorites f JOIN media m ON m.id=f.media_id JOIN albums a ON a.id=m.album_id WHERE f.user_id=$1 AND m.deleted_at IS NULL AND ${acl} ORDER BY f.created_at DESC`,
        [req.user.id],
      )
    ).rows;
    res.render("family/gallery", {
      title: "Kalbimdeki anılar",
      description:
        "Sadece senin için işaretlediğin fotoğraf ve videolar. Albüm iznin kalktığında burada da görünmezler.",
      items,
    });
  }),
);
router.post(
  "/api/favori/:id",
  requireUser,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock($1,$2)", [
        req.user.id,
        -media.id,
      ]);
      const deleted = await c.query(
        "DELETE FROM favorites WHERE user_id=$1 AND media_id=$2",
        [req.user.id, media.id],
      );
      if (!deleted.rowCount)
        await c.query("INSERT INTO favorites(user_id,media_id) VALUES($1,$2)", [
          req.user.id,
          media.id,
        ]);
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
  "/notlar",
  requireUser,
  wrap(async (req, res) =>
    res.render("family/notes", {
      title: "Aileden küçük notlar",
      notes: await notesFor(req.user),
      albums: await listAlbums(req.user),
    }),
  ),
);
router.post(
  "/notlar",
  requireUser,
  wrap(async (req, res) => {
    if (await limited("family-note:" + req.user.id, 15, 60))
      return res.sendStatus(429);
    const album = await albumAccess(req.user, id(req.body.album_id)),
      content = String(req.body.content || "").trim();
    if (!album) return res.sendStatus(404);
    if (!content || content.length > 1000) return res.sendStatus(400);
    await pool.query(
      "INSERT INTO family_notes(album_id,user_id,content) VALUES($1,$2,$3)",
      [album.id, req.user.id, content],
    );
    res.redirect("/notlar");
  }),
);
router.post(
  "/notlar/:id/kaldir",
  requireUser,
  wrap(async (req, res) => {
    const note = (
      await pool.query(
        "SELECT * FROM family_notes WHERE id=$1 AND deleted_at IS NULL",
        [id(req.params.id)],
      )
    ).rows[0];
    if (!note || !(await albumAccess(req.user, note.album_id)))
      return res.sendStatus(404);
    if (
      note.user_id !== req.user.id &&
      req.user.role !== "family_admin" &&
      !req.user.super_admin
    )
      return res.sendStatus(403);
    if (req.body.confirm !== "KALDIR") return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE family_notes SET deleted_at=now() WHERE id=$1", [
        note.id,
      ]);
      await audit(req.user, "note.soft_delete", note.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/notlar");
  }),
);
router.post(
  "/admin/album-kapagi/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.params.id));
    if (!album) return res.sendStatus(404);
    const mid = req.body.media_id ? id(req.body.media_id) : null;
    if (mid !== null) {
      const m = await mediaAccess(req.user, mid);
      if (!m || m.album_id !== album.id || m.type !== "image")
        return res.sendStatus(400);
    }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("UPDATE albums SET cover_media_id=$1 WHERE id=$2", [
        mid,
        album.id,
      ]);
      await audit(req.user, "album.cover", album.id, c);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/admin#album-covers");
  }),
);
module.exports = { router, dashboard, listAlbums };
