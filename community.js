const express = require("express"),
  multer = require("multer"),
  crypto = require("crypto"),
  fs = require("fs/promises"),
  path = require("path");
const { pool } = require("./db"),
  { runtime } = require("./config/runtime"),
  {
    wrap,
    requireUser,
    requireAdmin,
    albumPredicate,
    albumAccess,
    mediaAccess,
    audit,
    limited,
  } = require("./security"),
  { listAlbums } = require("./enhancements");
const router = express.Router(),
  acl = albumPredicate(),
  id = (v) =>
    /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) ? Number(v) : 0,
  text = (v, n = 200) =>
    String(v || "")
      .trim()
      .slice(0, n),
  today = () =>
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
const storage = require("./storage");
const regions = {
  marmara: {
    name: "Marmara",
    x: 130,
    y: 100,
    points: "40,40 210,30 235,130 125,160 50,125",
  },
  ege: {
    name: "Ege",
    x: 100,
    y: 235,
    points: "50,135 130,160 190,215 150,330 55,320 30,220",
  },
  akdeniz: {
    name: "Akdeniz",
    x: 280,
    y: 310,
    points: "155,270 285,250 450,290 430,355 300,360 145,330",
  },
  karadeniz: {
    name: "Karadeniz",
    x: 400,
    y: 95,
    points: "220,30 470,30 610,80 585,150 425,135 235,130",
  },
  icanadolu: {
    name: "İç Anadolu",
    x: 330,
    y: 210,
    points: "150,160 245,130 425,140 465,260 300,280 190,235",
  },
  dogu: {
    name: "Doğu Anadolu",
    x: 590,
    y: 200,
    points: "460,145 610,85 735,100 760,260 650,285 470,260",
  },
  guneydogu: {
    name: "Güneydoğu",
    x: 570,
    y: 315,
    points: "460,270 655,285 705,315 630,365 450,355",
  },
};
router.get(
  "/ara",
  requireUser,
  wrap(async (req, res) => {
    const q = text(req.query.q, 100),
      from = text(req.query.baslangic, 10),
      to = text(req.query.bitis, 10),
      type = req.query.tur || "",
      album = id(req.query.album),
      person = id(req.query.kisi),
      page = Math.max(1, Math.min(200, id(req.query.sayfa) || 1));
    if (
      (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) ||
      (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) ||
      (from && to && from > to) ||
      !["", "image", "video"].includes(type)
    )
      return res.sendStatus(400);
    const params = [req.user.id],
      parts = [`m.deleted_at IS NULL AND ${acl}`],
      add = (sql, value) => {
        params.push(value);
        parts.push(
          sql.split("@").join(String.fromCharCode(36) + params.length),
        );
      };
    if (q)
      add(
        "(m.title ILIKE @ OR m.description ILIKE @ OR a.title ILIKE @ OR m.place_text ILIKE @)",
        "%" + q + "%",
      );
    if (from)
      add(
        "coalesce(m.taken_on,(m.created_at AT TIME ZONE 'Europe/Istanbul')::date)>=@::date",
        from,
      );
    if (to)
      add(
        "coalesce(m.taken_on,(m.created_at AT TIME ZONE 'Europe/Istanbul')::date)<=@::date",
        to,
      );
    if (type) add("m.type=@", type);
    if (album) add("a.id=@", album);
    if (person)
      add(
        "EXISTS(SELECT 1 FROM media_people mp JOIN memberships mm ON mm.user_id=mp.user_id WHERE mp.media_id=m.id AND mp.user_id=@ AND mm.family_id=a.family_id)",
        person,
      );
    // Replace every repeated placeholder in the same predicate with its parameter.
    const condition = parts.join(" AND ");
    const items = (
      await pool.query(
        `SELECT m.*,a.title album_title,CASE WHEN EXISTS(SELECT 1 FROM media p WHERE p.id=m.poster_media_id AND p.album_id=m.album_id AND p.deleted_at IS NULL) THEN m.poster_media_id END poster_id FROM media m JOIN albums a ON a.id=m.album_id WHERE ${condition} ORDER BY coalesce(m.taken_on,(m.created_at AT TIME ZONE 'Europe/Istanbul')::date) DESC,m.id DESC LIMIT 25 OFFSET ${(page - 1) * 24}`,
        params,
      )
    ).rows;
    const more = items.length > 24;
    items.splice(24);
    const people = (
      await pool.query(
        "SELECT u.id,u.name FROM users u JOIN memberships z ON z.user_id=u.id WHERE z.family_id=$1 AND u.active ORDER BY u.name",
        [req.user.family_id],
      )
    ).rows;
    const query = new URLSearchParams({
      q,
      baslangic: from,
      bitis: to,
      tur: type,
      album: album || "",
      kisi: person || "",
      sayfa: page + 1,
    });
    res.render("family/search-advanced", {
      title: "Anılarda keşif",
      items,
      albums: await listAlbums(req.user),
      people,
      filters: { q, from, to, type, album, person },
      more,
      next: "/ara?" + query.toString(),
      page,
    });
  }),
);
router.get(
  "/takvim",
  requireUser,
  wrap(async (req, res) => {
    const month = String(req.query.ay || today().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.sendStatus(400);
    const rows = (
      await pool.query(
        `SELECT e.*,a.title album_title,u.name author,to_char(e.event_on,'YYYY-MM-DD') date_key FROM calendar_events e JOIN albums a ON a.id=e.album_id JOIN users u ON u.id=e.user_id WHERE e.deleted_at IS NULL AND ${acl} ORDER BY e.event_on,e.event_time NULLS LAST,e.id`,
        [req.user.id],
      )
    ).rows;
    const events = rows
      .filter(
        (e) =>
          (e.annually ? e.date_key.slice(5, 7) : e.date_key.slice(0, 7)) ===
          (e.annually ? month.slice(5) : month),
      )
      .map((e) => ({
        ...e,
        display_date: e.annually ? month + e.date_key.slice(7) : e.date_key,
      }))
      .filter(
        (e) =>
          new Date(e.display_date + "T12:00:00Z").toISOString().slice(0, 10) ===
          e.display_date,
      )
      .sort((a, b) => a.display_date.localeCompare(b.display_date));
    res.render("family/calendar", {
      title: "Aile takvimi",
      events,
      month,
      albums: await listAlbums(req.user),
    });
  }),
);
router.post(
  "/takvim",
  requireUser,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.body.album_id)),
      title = text(req.body.title),
      date = String(req.body.event_on || ""),
      time = req.body.event_time || null,
      kind = req.body.kind;
    if (!album) return res.sendStatus(404);
    if (
      !title ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) ||
      !["birthday", "meetup", "celebration"].includes(kind)
    )
      return res.sendStatus(400);
    if (await limited("calendar:" + req.user.id, 20, 3600))
      return res.sendStatus(429);
    await pool.query(
      "INSERT INTO calendar_events(album_id,user_id,title,event_on,event_time,kind,annually,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        album.id,
        req.user.id,
        title,
        date,
        time,
        kind,
        req.body.annually === "yes",
        text(req.body.description, 1000),
      ],
    );
    res.redirect("/takvim?ay=" + date.slice(0, 7));
  }),
);
router.post(
  "/takvim/:id/kaldir",
  requireUser,
  wrap(async (req, res) => {
    const e = (
      await pool.query(
        `SELECT e.* FROM calendar_events e JOIN albums a ON a.id=e.album_id WHERE e.id=$2 AND e.deleted_at IS NULL AND ${acl}`,
        [req.user.id, id(req.params.id)],
      )
    ).rows[0];
    if (!e) return res.sendStatus(404);
    if (
      e.user_id !== req.user.id &&
      req.user.role !== "family_admin" &&
      !req.user.super_admin
    )
      return res.sendStatus(403);
    if (req.body.confirm !== "KALDIR") return res.sendStatus(400);
    await pool.query(
      "UPDATE calendar_events SET deleted_at=now() WHERE id=$1",
      [e.id],
    );
    await audit(req.user, "calendar.soft_delete", e.id);
    res.redirect("/takvim");
  }),
);
router.post(
  "/profil/agac",
  requireUser,
  wrap(async (req, res) => {
    await pool.query("UPDATE users SET tree_visible=$1 WHERE id=$2", [
      req.body.visible === "yes",
      req.user.id,
    ]);
    res.redirect("/agac");
  }),
);
router.get(
  "/agac",
  requireUser,
  wrap(async (req, res) => {
    const people = (
      await pool.query(
        "SELECT u.id,u.name,u.avatar_key FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.family_id=$1 AND u.active AND u.tree_visible ORDER BY u.name",
        [req.user.family_id],
      )
    ).rows;
    const links = (
      await pool.query(
        "SELECT l.*,p.name parent_name,c.name child_name FROM family_links l JOIN users p ON p.id=l.parent_id JOIN users c ON c.id=l.child_id WHERE l.family_id=$1 AND l.deleted_at IS NULL AND p.tree_visible AND c.tree_visible AND p.active AND c.active",
        [req.user.family_id],
      )
    ).rows;
    res.render("family/tree", { title: "Aile ağacımız", people, links });
  }),
);
router.post(
  "/agac/bag",
  requireUser,
  wrap(async (req, res) => {
    const p = id(req.body.parent_id),
      c = id(req.body.child_id),
      kind = req.body.kind;
    if (!p || !c || p === c || !["parent", "partner"].includes(kind))
      return res.sendStatus(400);
    if (
      req.user.role !== "family_admin" &&
      !req.user.super_admin &&
      ![p, c].includes(req.user.id)
    )
      return res.sendStatus(403);
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock($1)", [
        req.user.family_id,
      ]);
      const users = (
        await connection.query(
          "SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=ANY($1::int[]) AND m.family_id=$2 AND u.active AND u.tree_visible",
          [[p, c], req.user.family_id],
        )
      ).rows;
      if (users.length !== 2) {
        await connection.query("ROLLBACK");
        return res.sendStatus(404);
      }
      if (
        kind === "parent" &&
        (
          await connection.query(
            "WITH RECURSIVE descendants(id) AS(SELECT child_id FROM family_links WHERE parent_id=$1 AND kind='parent' AND deleted_at IS NULL AND family_id=$3 UNION SELECT l.child_id FROM family_links l JOIN descendants d ON l.parent_id=d.id WHERE l.kind='parent' AND l.deleted_at IS NULL AND l.family_id=$3) SELECT 1 FROM descendants WHERE id=$2",
            [c, p, req.user.family_id],
          )
        ).rowCount
      ) {
        await connection.query("ROLLBACK");
        return res.status(400).send("Bu bağ aile ağacında döngü oluşturur.");
      }
      const left = kind === "partner" ? Math.min(p, c) : p,
        right = kind === "partner" ? Math.max(p, c) : c;
      await connection.query(
        "INSERT INTO family_links(family_id,parent_id,child_id,kind,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(family_id,parent_id,child_id,kind) DO UPDATE SET deleted_at=NULL",
        [req.user.family_id, left, right, kind, req.user.id],
      );
      await audit(req.user, "tree.link", left + ":" + right, connection);
      await connection.query("COMMIT");
    } catch (e) {
      await connection.query("ROLLBACK");
      throw e;
    } finally {
      connection.release();
    }
    res.redirect("/agac");
  }),
);
router.post(
  "/agac/bag/:id/kaldir",
  requireUser,
  wrap(async (req, res) => {
    const l = (
      await pool.query(
        "SELECT * FROM family_links WHERE id=$1 AND family_id=$2 AND deleted_at IS NULL",
        [id(req.params.id), req.user.family_id],
      )
    ).rows[0];
    if (!l) return res.sendStatus(404);
    if (
      l.created_by !== req.user.id &&
      req.user.role !== "family_admin" &&
      !req.user.super_admin
    )
      return res.sendStatus(403);
    if (req.body.confirm !== "KALDIR") return res.sendStatus(400);
    await pool.query("UPDATE family_links SET deleted_at=now() WHERE id=$1", [
      l.id,
    ]);
    res.redirect("/agac");
  }),
);
function wavInfo(b) {
  if (
    b.length < 44 ||
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE" ||
    b.readUInt32LE(4) + 8 !== b.length
  )
    throw Error("Geçerli PCM WAV seçin.");
  let offset = 12,
    format,
    data;
  while (offset + 8 <= b.length) {
    const size = b.readUInt32LE(offset + 4),
      name = b.toString("ascii", offset, offset + 4);
    if (offset + 8 + size > b.length) throw Error("Bozuk WAV");
    if (name === "fmt ") {
      if (size < 16) throw Error("Bozuk WAV");
      format = {
        pcm: b.readUInt16LE(offset + 8),
        channels: b.readUInt16LE(offset + 10),
        rate: b.readUInt32LE(offset + 12),
        byteRate: b.readUInt32LE(offset + 16),
        align: b.readUInt16LE(offset + 20),
        bits: b.readUInt16LE(offset + 22),
      };
    }
    if (name === "data") {
      if (data !== undefined) throw Error("Çift ses verisi");
      data = size;
    }
    offset += 8 + size + (size % 2);
  }
  if (offset !== b.length) throw Error("Bozuk WAV sınırı");
  if (
    !format ||
    format.pcm !== 1 ||
    format.channels !== 1 ||
    format.bits !== 16 ||
    format.rate < 8000 ||
    format.rate > 48000 ||
    format.align !== 2 ||
    format.byteRate !== format.rate * 2 ||
    !data ||
    data % 2
  )
    throw Error("Mono 16 bit PCM WAV gerekir.");
  const duration = data / format.byteRate;
  if (duration < 0.2 || duration > 60)
    throw Error("Ses 0,2–60 saniye arasında olmalı.");
  return { duration };
}
const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
}).single("audio");
router.post(
  "/medya/:id/ses",
  requireUser,
  (req, res, next) => {
    const size = Number(req.get("content-length"));
    if (!req.get("x-csrf-token")) return res.sendStatus(403);
    if (!Number.isFinite(size) || size > 7 * 1024 * 1024)
      return res.sendStatus(413);
    next();
  },
  voiceUpload,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    if (await limited("voice:" + req.user.id, 8, 3600))
      return res.sendStatus(429);
    if (!req.file) return res.sendStatus(400);
    let info;
    try {
      info = wavInfo(req.file.buffer);
    } catch (e) {
      return res.status(400).send(e.message);
    }
    const k = crypto.randomUUID();
    await storage.put("voice-notes", k, req.file.buffer, "audio/wav");
    try {
      await pool.query(
        "INSERT INTO voice_notes(media_id,user_id,storage_key,caption,duration) VALUES($1,$2,$3,$4,$5)",
        [media.id, req.user.id, k, text(req.body.caption), info.duration],
      );
    } catch (e) {
      await storage.rollback("voice-notes", k, "audio/wav");
      throw e;
    }
    res.redirect("/medya/" + media.id);
  }),
);
router.get(
  "/private/voice/:id",
  requireUser,
  wrap(async (req, res) => {
    const v = (
      await pool.query(
        `SELECT v.* FROM voice_notes v JOIN media m ON m.id=v.media_id JOIN albums a ON a.id=m.album_id WHERE v.id=$2 AND v.deleted_at IS NULL AND m.deleted_at IS NULL AND ${acl}`,
        [req.user.id, id(req.params.id)],
      )
    ).rows[0];
    if (!v) return res.sendStatus(404);
    res.type("audio/wav").set("Cache-Control", "private, no-store");
    await storage.serve(req, res, "voice-notes", v.storage_key, "audio/wav");
  }),
);
router.post(
  "/ses/:id/kaldir",
  requireUser,
  wrap(async (req, res) => {
    const v = (
      await pool.query(
        "SELECT * FROM voice_notes WHERE id=$1 AND deleted_at IS NULL",
        [id(req.params.id)],
      )
    ).rows[0];
    if (!v || !(await mediaAccess(req.user, v.media_id)))
      return res.sendStatus(404);
    if (
      v.user_id !== req.user.id &&
      req.user.role !== "family_admin" &&
      !req.user.super_admin
    )
      return res.sendStatus(403);
    if (req.body.confirm !== "KALDIR") return res.sendStatus(400);
    await pool.query("UPDATE voice_notes SET deleted_at=now() WHERE id=$1", [
      v.id,
    ]);
    await audit(req.user, "voice.soft_delete", v.id);
    res.redirect("/medya/" + v.media_id);
  }),
);
router.get(
  "/harita",
  requireUser,
  wrap(async (req, res) => {
    const selected = req.query.bolge || "";
    if (selected && !regions[selected]) return res.sendStatus(400);
    const places = (
      await pool.query(
        `SELECT m.*,a.title album_title,p.region,p.city FROM media_places p JOIN media m ON m.id=p.media_id JOIN albums a ON a.id=m.album_id WHERE m.deleted_at IS NULL AND ${acl} ORDER BY m.id DESC LIMIT 200`,
        [req.user.id],
      )
    ).rows;
    res.render("family/map", {
      title: "Anı haritamız",
      regions,
      places,
      selected,
      items: selected ? places.filter((p) => p.region === selected) : places,
    });
  }),
);
router.get(
  "/medya/:id/konum",
  requireAdmin,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    const place = (
      await pool.query("SELECT * FROM media_places WHERE media_id=$1", [
        media.id,
      ])
    ).rows[0];
    res.render("family/place-edit", {
      title: "Anının bölgesi",
      media,
      regions,
      place,
    });
  }),
);
router.post(
  "/medya/:id/konum",
  requireAdmin,
  wrap(async (req, res) => {
    const media = await mediaAccess(req.user, id(req.params.id));
    if (!media) return res.sendStatus(404);
    if (!req.body.region) {
      await pool.query("DELETE FROM media_places WHERE media_id=$1", [
        media.id,
      ]);
    } else {
      if (!regions[req.body.region] || String(req.body.city || "").length > 80)
        return res.sendStatus(400);
      await pool.query(
        "INSERT INTO media_places(media_id,region,city,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(media_id) DO UPDATE SET region=$2,city=$3,created_by=$4",
        [media.id, req.body.region, text(req.body.city, 80), req.user.id],
      );
    }
    await audit(req.user, "media.region", media.id);
    res.redirect("/harita");
  }),
);
async function challenge(user, cid) {
  return (
    await pool.query(
      `SELECT c.*,a.title album_title,(c.closed_at IS NULL AND c.ends_on >= (now() AT TIME ZONE 'Europe/Istanbul')::date) open FROM challenges c JOIN albums a ON a.id=c.album_id WHERE c.id=$2 AND ${acl}`,
      [user.id, cid],
    )
  ).rows[0];
}
router.get(
  "/etkinlikler",
  requireUser,
  wrap(async (req, res) => {
    const challenges = (
      await pool.query(
        `SELECT c.*,a.title album_title,(c.closed_at IS NULL AND c.ends_on >= (now() AT TIME ZONE 'Europe/Istanbul')::date) open FROM challenges c JOIN albums a ON a.id=c.album_id WHERE ${acl} ORDER BY c.id DESC`,
        [req.user.id],
      )
    ).rows;
    res.render("family/challenges", {
      title: "Ailece bir meydan okuma",
      challenges,
      albums: await listAlbums(req.user),
      today: today(),
    });
  }),
);
router.post(
  "/etkinlikler",
  requireAdmin,
  wrap(async (req, res) => {
    const album = await albumAccess(req.user, id(req.body.album_id)),
      kind = req.body.kind,
      date = String(req.body.ends_on || ""),
      title = text(req.body.title);
    if (!album) return res.sendStatus(404);
    if (
      !title ||
      !["photo", "drawing", "quiz"].includes(kind) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date < today()
    )
      return res.sendStatus(400);
    const options = [0, 1, 2, 3].map((i) => text(req.body["option" + i], 160)),
      correct = Number(req.body.correct_index);
    if (
      kind === "quiz" &&
      (!text(req.body.prompt, 500) ||
        options.some((o) => !o) ||
        new Set(options).size !== 4 ||
        !Number.isInteger(correct) ||
        correct < 0 ||
        correct > 3)
    )
      return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query(
          "INSERT INTO challenges(album_id,created_by,title,description,kind,ends_on) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [
            album.id,
            req.user.id,
            title,
            text(req.body.description, 1000),
            kind,
            date,
          ],
        )
      ).rows[0];
      if (kind === "quiz")
        await c.query(
          "INSERT INTO challenge_questions(challenge_id,prompt,options,correct_index) VALUES($1,$2,$3,$4)",
          [
            row.id,
            text(req.body.prompt, 500),
            JSON.stringify(options),
            correct,
          ],
        );
      await audit(req.user, "challenge.create", row.id, c);
      await c.query("COMMIT");
      res.redirect("/etkinlik/" + row.id);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }),
);
router.get(
  "/etkinlik/:id",
  requireUser,
  wrap(async (req, res) => {
    const event = await challenge(req.user, id(req.params.id));
    if (!event) return res.sendStatus(404);
    const entries = (
      await pool.query(
        "SELECT e.*,u.name author,m.title media_title,(SELECT count(*)::int FROM challenge_votes v WHERE v.entry_id=e.id) votes FROM challenge_entries e JOIN users u ON u.id=e.user_id JOIN media m ON m.id=e.media_id WHERE e.challenge_id=$1 AND e.deleted_at IS NULL AND m.deleted_at IS NULL AND m.album_id=$2 ORDER BY votes DESC,e.id",
        [event.id, event.album_id],
      )
    ).rows;
    const questions = (
      await pool.query(
        "SELECT q.id,q.prompt,q.options,a.chosen_index,CASE WHEN a.user_id IS NOT NULL THEN q.correct_index END correct_index FROM challenge_questions q LEFT JOIN challenge_attempts a ON a.question_id=q.id AND a.user_id=$2 WHERE q.challenge_id=$1",
        [event.id, req.user.id],
      )
    ).rows;
    const media = (
      await pool.query(
        "SELECT id,title FROM media WHERE album_id=$1 AND type='image' AND deleted_at IS NULL ORDER BY id DESC",
        [event.album_id],
      )
    ).rows;
    res.render("family/challenge", {
      title: event.title,
      event,
      entries,
      questions,
      media,
    });
  }),
);
router.post(
  "/etkinlik/:id/katil",
  requireUser,
  wrap(async (req, res) => {
    const event = await challenge(req.user, id(req.params.id));
    if (!event) return res.sendStatus(404);
    if (!event.open || event.kind === "quiz") return res.sendStatus(409);
    const m = await mediaAccess(req.user, id(req.body.media_id));
    if (!m || m.album_id !== event.album_id || m.type !== "image")
      return res.sendStatus(400);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const row = (
        await c.query(
          "INSERT INTO challenge_entries(challenge_id,user_id,media_id) VALUES($1,$2,$3) ON CONFLICT(challenge_id,user_id) DO UPDATE SET media_id=$3,deleted_at=NULL RETURNING id",
          [event.id, req.user.id, m.id],
        )
      ).rows[0];
      await c.query("DELETE FROM challenge_votes WHERE entry_id=$1", [row.id]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
    res.redirect("/etkinlik/" + event.id);
  }),
);
router.post(
  "/etkinlik/:id/oy",
  requireUser,
  wrap(async (req, res) => {
    const event = await challenge(req.user, id(req.params.id));
    if (!event) return res.sendStatus(404);
    if (!event.open) return res.sendStatus(409);
    const entry = (
      await pool.query(
        "SELECT e.* FROM challenge_entries e JOIN media m ON m.id=e.media_id WHERE e.id=$1 AND e.challenge_id=$2 AND e.deleted_at IS NULL AND m.deleted_at IS NULL AND m.album_id=$3",
        [id(req.body.entry_id), event.id, event.album_id],
      )
    ).rows[0];
    if (!entry || entry.user_id === req.user.id) return res.sendStatus(400);
    await pool.query(
      "INSERT INTO challenge_votes(challenge_id,user_id,entry_id) VALUES($1,$2,$3) ON CONFLICT(challenge_id,user_id) DO UPDATE SET entry_id=$3",
      [event.id, req.user.id, entry.id],
    );
    res.redirect("/etkinlik/" + event.id);
  }),
);
router.post(
  "/etkinlik/:id/cevap",
  requireUser,
  wrap(async (req, res) => {
    const event = await challenge(req.user, id(req.params.id));
    if (!event) return res.sendStatus(404);
    if (!event.open || event.kind !== "quiz") return res.sendStatus(409);
    const chosen = Number(req.body.answer);
    if (!Number.isInteger(chosen) || chosen < 0 || chosen > 3)
      return res.sendStatus(400);
    const result = await pool.query(
      "INSERT INTO challenge_attempts(question_id,user_id,chosen_index) SELECT id,$1,$2 FROM challenge_questions WHERE id=$3 AND challenge_id=$4 ON CONFLICT DO NOTHING",
      [req.user.id, chosen, id(req.body.question_id), event.id],
    );
    if (!result.rowCount) return res.sendStatus(409);
    res.redirect("/etkinlik/" + event.id);
  }),
);
router.post(
  "/etkinlik/:id/kapat",
  requireAdmin,
  wrap(async (req, res) => {
    const event = await challenge(req.user, id(req.params.id));
    if (!event) return res.sendStatus(404);
    if (req.body.confirm !== "KAPAT") return res.sendStatus(400);
    await pool.query("UPDATE challenges SET closed_at=now() WHERE id=$1", [
      event.id,
    ]);
    await audit(req.user, "challenge.close", event.id);
    res.redirect("/etkinlik/" + event.id);
  }),
);
router.get("/uygulama", (req, res) =>
  res.render("family/install", { title: "Dünyamız cebinde" }),
);
module.exports = { router, wavInfo, regions };
