const express = require('express');
const router = express.Router();
const { prepare } = require('../db');

const EMOJIS = ['❤️', '😍', '🔥', '👏'];

router.post('/yorum/:mediaId', async (req, res) => {
  const { author, content } = req.body;
  if (!author || !content) return res.status(400).json({ error: 'Eksik bilgi' });
  if (content.length > 500) return res.status(400).json({ error: 'Yorum çok uzun' });
  await prepare('INSERT INTO comments (media_id, author, content) VALUES ($1, $2, $3)').run(
    [req.params.mediaId, author.trim(), content.trim()]
  );
  res.json({ success: true });
});

router.post('/reaksiyon/:mediaId', async (req, res) => {
  const { emoji } = req.body;
  const email = req.session.visitorEmail || req.session.user?.username;
  if (!email) return res.status(401).json({ error: 'Giriş gerekli' });
  if (!EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Geçersiz reaksiyon' });

  const existing = await prepare('SELECT * FROM reactions WHERE media_id = $1 AND email = $2').get([req.params.mediaId, email]);
  if (existing) {
    if (existing.emoji === emoji) {
      await prepare('DELETE FROM reactions WHERE id = $1').run([existing.id]);
    } else {
      await prepare('UPDATE reactions SET emoji = $1 WHERE id = $2').run([emoji, existing.id]);
    }
  } else {
    await prepare('INSERT INTO reactions (media_id, email, emoji) VALUES ($1, $2, $3)').run([req.params.mediaId, email, emoji]);
  }

  const counts = {};
  EMOJIS.forEach(e => { counts[e] = 0; });
  const rows = await prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE media_id = $1 GROUP BY emoji').all([req.params.mediaId]);
  rows.forEach(r => { counts[r.emoji] = parseInt(r.count); });
  const userEmoji = await prepare('SELECT emoji FROM reactions WHERE media_id = $1 AND email = $2').get([req.params.mediaId, email]);
  res.json({ success: true, counts, userEmoji: userEmoji?.emoji || null });
});

router.get('/reaksiyon/:mediaId', async (req, res) => {
  const email = req.session.visitorEmail || req.session.user?.username;
  const counts = {};
  EMOJIS.forEach(e => { counts[e] = 0; });
  const rows = await prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE media_id = $1 GROUP BY emoji').all([req.params.mediaId]);
  rows.forEach(r => { counts[r.emoji] = parseInt(r.count); });
  const userEmoji = email ? await prepare('SELECT emoji FROM reactions WHERE media_id = $1 AND email = $2').get([req.params.mediaId, email]) : null;
  res.json({ counts, userEmoji: userEmoji?.emoji || null });
});

router.get('/indir/:id', async (req, res) => {
  const media = await prepare('SELECT * FROM media WHERE id = $1').get([req.params.id]);
  if (!media) return res.status(404).send('Bulunamadı');
  await prepare('UPDATE media SET downloads = downloads + 1 WHERE id = $1').run([media.id]);
  const url = media.filename.replace('/upload/', '/upload/fl_attachment/');
  res.redirect(url);
});

module.exports = router;
