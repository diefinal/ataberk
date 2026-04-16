const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { prepare } = require('../db');
const { uploadFile, deleteFile } = require('../cloudinary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|webm/;
    const ext = allowed.test(file.originalname.toLowerCase().split('.').pop());
    if (ext) cb(null, true);
    else cb(new Error('Desteklenmeyen dosya formatı'));
  }
});

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.is_admin) return next();
  res.redirect('/admin/giris');
};

router.get('/giris', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

router.post('/giris', async (req, res) => {
  const { username, password } = req.body;
  const user = await prepare('SELECT * FROM users WHERE username = $1').get([username]);
  if (user && bcrypt.compareSync(password, user.password) && user.is_admin) {
    req.session.user = user;
    return res.redirect('/admin');
  }
  res.render('admin/login', { error: 'Kullanıcı adı veya şifre hatalı' });
});

router.get('/cikis', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

router.get('/', isAdmin, async (req, res) => {
  const stats = {
    images: (await prepare("SELECT COUNT(*) as count FROM media WHERE type='image'").get([])).count,
    videos: (await prepare("SELECT COUNT(*) as count FROM media WHERE type='video'").get([])).count,
    comments: (await prepare("SELECT COUNT(*) as count FROM comments").get([])).count,
    categories: (await prepare("SELECT COUNT(*) as count FROM categories").get([])).count,
  };
  const recentMedia = await prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 10').all();
  res.render('admin/dashboard', { stats, recentMedia, session: req.session });
});

router.get('/yukle', isAdmin, async (req, res) => {
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/upload', { categories, session: req.session, error: null });
});

router.post('/yukle', isAdmin, upload.array('file', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/upload', { categories, session: req.session, error: 'Dosya seçilmedi' });
  }
  try {
    const { title, description, category_id } = req.body;
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const result = await uploadFile(file.buffer, file.mimetype, file.originalname);
      const fileTitle = req.files.length === 1 ? title : `${title} ${i + 1}`;
      await prepare('INSERT INTO media (title, description, type, filename, category_id) VALUES ($1, $2, $3, $4, $5)').run(
        [fileTitle, description, type, result.url, category_id || null]
      );
    }
    res.redirect('/admin');
  } catch (e) {
    console.error('Upload hatası:', e.message);
    const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
    res.render('admin/upload', { categories, session: req.session, error: 'Yükleme başarısız: ' + e.message });
  }
});

router.get('/duzenle/:id', isAdmin, async (req, res) => {
  const media = await prepare('SELECT * FROM media WHERE id = $1').get([req.params.id]);
  if (!media) return res.redirect('/admin');
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/edit', { media, categories, session: req.session, error: null });
});

router.post('/duzenle/:id', isAdmin, async (req, res) => {
  const { title, description, category_id } = req.body;
  await prepare('UPDATE media SET title = $1, description = $2, category_id = $3 WHERE id = $4').run(
    [title, description, category_id || null, req.params.id]
  );
  res.redirect('/admin');
});

router.post('/sil/:id', isAdmin, async (req, res) => {
  const media = await prepare('SELECT * FROM media WHERE id = $1').get([req.params.id]);
  if (media) {
    try {
      const url = media.filename;
      const parts = url.split('/');
      const fileWithExt = parts[parts.length - 1];
      const file = fileWithExt.split('.')[0];
      const folder = parts[parts.length - 2];
      const public_id = folder + '/' + file;
      await deleteFile(public_id, media.type === 'video' ? 'video' : 'image');
    } catch (e) {}
    await prepare('DELETE FROM media WHERE id = $1').run([media.id]);
  }
  res.redirect('/admin');
});

router.get('/kategoriler', isAdmin, async (req, res) => {
  const categories = await prepare(`
    SELECT c.*, COUNT(m.id) as media_count 
    FROM categories c LEFT JOIN media m ON c.id = m.category_id 
    GROUP BY c.id ORDER BY c.name
  `).all();
  res.render('admin/categories', { categories, session: req.session, error: null });
});

router.post('/kategoriler/ekle', isAdmin, async (req, res) => {
  const { name, description } = req.body;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  try {
    await prepare('INSERT INTO categories (name, slug, description) VALUES ($1, $2, $3)').run([name, slug, description]);
  } catch (e) {}
  res.redirect('/admin/kategoriler');
});

router.post('/kategoriler/sil/:id', isAdmin, async (req, res) => {
  await prepare('DELETE FROM categories WHERE id = $1').run([req.params.id]);
  res.redirect('/admin/kategoriler');
});

router.get('/yorumlar', isAdmin, async (req, res) => {
  const comments = await prepare(`
    SELECT c.*, m.title as media_title, m.id as media_id 
    FROM comments c JOIN media m ON c.media_id = m.id 
    ORDER BY c.created_at DESC
  `).all();
  res.render('admin/comments', { comments, session: req.session });
});

router.post('/yorumlar/sil/:id', isAdmin, async (req, res) => {
  await prepare('DELETE FROM comments WHERE id = $1').run([req.params.id]);
  res.redirect('/admin/yorumlar');
});

module.exports = router;
