const express = require('express');
const router = express.Router();
const { prepare } = require('../db');

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

// İndirme - Cloudinary URL'ine yönlendir
router.get('/indir/:id', (req, res) => {
  const media = prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).send('Bulunamadı');
  prepare('UPDATE media SET downloads = downloads + 1 WHERE id = ?').run(media.id);
  // Cloudinary URL'ine yönlendir (fl_attachment ile indirme zorla)
  const url = media.filename.replace('/upload/', '/upload/fl_attachment/');
  res.redirect(url);
});

module.exports = router;
