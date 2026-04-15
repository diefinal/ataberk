const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { prepare } = require('../db');
const { uploadFile, deleteFile } = require('../cloudinary');

// Multer - memory storage (Cloudinary'e göndereceğiz)
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

router.post('/giris', (req, res) => {
  const { username, password } = req.body;
  const user = prepare('SELECT * FROM users WHERE username = ?').get(username);
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

router.get('/', isAdmin, (req, res) => {
  const stats = {
    images: prepare("SELECT COUNT(*) as count FROM media WHERE type='image'").get().count,
    videos: prepare("SELECT COUNT(*) as count FROM media WHERE type='video'").get().count,
    comments: prepare("SELECT COUNT(*) as count FROM comments").get().count,
    categories: prepare("SELECT COUNT(*) as count FROM categories").get().count,
  };
  const recentMedia = prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 10').all();
  res.render('admin/dashboard', { stats, recentMedia, session: req.session });
});

router.get('/yukle', isAdmin, (req, res) => {
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/upload', { categories, session: req.session, error: null });
});

router.post('/yukle', isAdmin, upload.array('file', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    const categories = prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/upload', { categories, session: req.session, error: 'Dosya seçilmedi' });
  }
  try {
    const { title, description, category_id } = req.body;
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const type = file.mimetype.startsWith('video/') ? 'video' : 'image';
      const result = await uploadFile(file.buffer, file.mimetype, file.originalname);
      const fileTitle = req.files.length === 1 ? title : `${title} ${i + 1}`;
      prepare('INSERT INTO media (title, description, type, filename, category_id) VALUES (?, ?, ?, ?, ?)').run(
        [fileTitle, description, type, result.url, category_id || null]
      );
    }
    res.redirect('/admin');
  } catch (e) {
    console.error('Upload hatası:', e.message);
    const categories = prepare('SELECT * FROM categories ORDER BY name').all();
    res.render('admin/upload', { categories, session: req.session, error: 'Yükleme başarısız: ' + e.message });
  }
});

// İçerik düzenle
router.get('/duzenle/:id', isAdmin, (req, res) => {
  const media = prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!media) return res.redirect('/admin');
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/edit', { media, categories, session: req.session, error: null });
});

router.post('/duzenle/:id', isAdmin, (req, res) => {
  const { title, description, category_id } = req.body;
  prepare('UPDATE media SET title = ?, description = ?, category_id = ? WHERE id = ?').run(
    [title, description, category_id || null, req.params.id]
  );
  res.redirect('/admin');
});

router.post('/sil/:id', isAdmin, async (req, res) => {
  const media = prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (media) {
    // Cloudinary'den sil (URL'den public_id çıkar)
    try {
      const url = media.filename;
      const parts = url.split('/');
      const fileWithExt = parts[parts.length - 1];
      const file = fileWithExt.split('.')[0];
      const folder = parts[parts.length - 2];
      const public_id = folder + '/' + file;
      await deleteFile(public_id, media.type === 'video' ? 'video' : 'image');
    } catch (e) {}
    prepare('DELETE FROM media WHERE id = ?').run(media.id);
  }
  res.redirect('/admin');
});

router.get('/kategoriler', isAdmin, (req, res) => {
  const categories = prepare(`
    SELECT c.*, COUNT(m.id) as media_count 
    FROM categories c LEFT JOIN media m ON c.id = m.category_id 
    GROUP BY c.id ORDER BY c.name
  `).all();
  res.render('admin/categories', { categories, session: req.session, error: null });
});

router.post('/kategoriler/ekle', isAdmin, (req, res) => {
  const { name, description } = req.body;
  const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  try {
    prepare('INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)').run([name, slug, description]);
  } catch (e) {}
  res.redirect('/admin/kategoriler');
});

router.post('/kategoriler/sil/:id', isAdmin, (req, res) => {
  prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin/kategoriler');
});

router.get('/yorumlar', isAdmin, (req, res) => {
  const comments = prepare(`
    SELECT c.*, m.title as media_title, m.id as media_id 
    FROM comments c JOIN media m ON c.media_id = m.id 
    ORDER BY c.created_at DESC
  `).all();
  res.render('admin/comments', { comments, session: req.session });
});

router.post('/yorumlar/sil/:id', isAdmin, (req, res) => {
  prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.redirect('/admin/yorumlar');
});

module.exports = router;
