const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { prepare } = require('../db');

router.post('/yorum/:mediaId', (req, res) => {
  const { author, content } = req.body;
  if (!author || !content) return res.status(400).json({ error: 'Eksik bilgi' });
  if (content.length > 500) return res.status(400).json({ error: 'Yorum çok uzun' });

  prepare('INSERT INTO comments (media_id, author, content) VALUES (?, ?, ?)').run(
    [req.params.mediaId, author.trim(), content.trim()]
  );
  res.json({ success: true });
});

router.get('/indir/:id', (req, res) => {
  const media = prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.status(404).send('Bulunamadı');

  prepare('UPDATE media SET downloads = downloads + 1 WHERE id = ?').run(media.id);

  const filePath = path.join(__dirname, '../uploads', media.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Dosya bulunamadı');

  res.download(filePath, path.basename(media.filename));
});

module.exports = router;
