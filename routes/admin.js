const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { prepare } = require('../db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.mimetype.startsWith('video/') ? 'uploads/videos' : 'uploads/images';
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|mkv|webm/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
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

router.post('/yukle', isAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    const categories = prepare('SELECT * FROM categories ORDER BY name').all();
    return res.render('admin/upload', { categories, session: req.session, error: 'Dosya seçilmedi' });
  }
  const { title, description, category_id } = req.body;
  const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  const filename = (type === 'video' ? 'videos/' : 'images/') + req.file.filename;

  prepare('INSERT INTO media (title, description, type, filename, category_id) VALUES (?, ?, ?, ?, ?)').run(
    [title, description, type, filename, category_id || null]
  );
  res.redirect('/admin');
});

router.post('/sil/:id', isAdmin, (req, res) => {
  const media = prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (media) {
    const filePath = path.join(__dirname, '../uploads', media.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
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
