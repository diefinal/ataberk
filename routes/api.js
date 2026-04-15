const express = require('express');
const router = express.Router();
const { prepare } = require('../db');

const EMOJIS = ['❤️', '😍', '🔥', '👏'];

// Yorum ekle
router.post('/yorum/:mediaId', (req, res) => {
  const { author, content } = req.body;
  if (!author || !content) return res.status(400).json({ error: 'Eksik bilgi' });
  if (content.length > 500) return res.status(400).json({ error: 'Yorum çok uzun' });
  prepare('INSERT INTO comments (media_id, author, content) VALUES (?, ?, ?)').run(
    [req.params.mediaId, author.trim(), content.trim()]
  );
  res.json({ success: true });
});

// Reaksiyon ekle/değiştir/kaldır
router.post('/reaksiyon/:mediaId', (req, res) => {
  const { emoji } = req.body;
  const email = req.session.visitorEmail || req.session.user?.username;
  if (!email) return res.status(401).json({ error: 'Giriş gerekli' });
  if (!EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Geçersiz reaksiyon' });

  const existing = prepare('SELECT * FROM reactions WHERE media_id = ? AND email = ?').get([req.params.mediaId, email]);
  if (existing) {
    if (existing.emoji === emoji) {
      prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
    } else {
      prepare('UPDATE reactions SET emoji = ? WHERE id = ?').run([emoji, existing.id]);
    }
  } else {
    prepare('INSERT INTO reactions (media_id, email, emoji) VALUES (?, ?, ?)').run([req.params.mediaId, email, emoji]);
  }

  const counts = {};
  EMOJIS.forEach(e => { counts[e] = 0; });
  const rows = prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE media_id = ? GROUP BY emoji').all(req.params.mediaId);
  rows.forEach(r => { counts[r.emoji] = r.count; });
  const userEmoji = prepare('SELECT emoji FROM reactions WHERE media_id = ? AND email = ?').get([req.params.mediaId, email]);
  res.json({ success: true, counts, userEmoji: userEmoji?.emoji || null });
});

// Reaksiyonları getir
router.get('/reaksiyon/:mediaId', (req, res) => {
  const email = req.session.visitorEmail || req.session.user?.username;
  const counts = {};
  EMOJIS.forEach(e => { counts[e] = 0; });
  const rows = prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE media_id = ? GROUP BY emoji').all(req.params.mediaId);
  rows.forEach(r => { counts[r.emoji] = r.count; });
  const userEmoji = email ? prepare('SELECT emoji FROM reactions WHERE media_id = ? AND email = ?').get([req.params.mediaId, email]) : null;
  res.json({ counts, userEmoji: userEmoji?.emoji || null });
});

// İndirme
router.get('/indir/:id', (req, res) => {
  const media = prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).send('Bulunamadı');
  prepare('UPDATE media SET downloads = downloads + 1 WHERE id = ?').run(media.id);
  const url = media.filename.replace('/upload/', '/upload/fl_attachment/');
  res.redirect(url);
});

module.exports = router;
