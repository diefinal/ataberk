const express = require('express');
const router = express.Router();
const { prepare } = require('../db');

router.get('/', (req, res) => {
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  const recentMedia = prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    ORDER BY m.created_at DESC LIMIT 12
  `).all();
  res.render('index', { categories, recentMedia, session: req.session });
});

router.get('/kategori/:slug', (req, res) => {
  const category = prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return res.redirect('/');
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  const mediaList = prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.category_id = ? ORDER BY m.created_at DESC
  `).all(category.id);
  res.render('category', { category, categories, mediaList, session: req.session });
});

router.get('/medya/:id', (req, res) => {
  const media = prepare(`
    SELECT m.*, c.name as category_name, c.slug as category_slug
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.id = ?
  `).get(req.params.id);
  if (!media) return res.redirect('/');

  prepare('UPDATE media SET views = views + 1 WHERE id = ?').run(media.id);

  const comments = prepare('SELECT * FROM comments WHERE media_id = ? ORDER BY created_at DESC').all(media.id);
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  const related = prepare(`
    SELECT * FROM media WHERE category_id = ? AND id != ? ORDER BY created_at DESC LIMIT 6
  `).all([media.category_id, media.id]);

  res.render('media', { media, comments, categories, related, session: req.session });
});

router.get('/fotograflar', (req, res) => {
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  const mediaList = prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.type = 'image' ORDER BY m.created_at DESC
  `).all();
  res.render('photos', { categories, mediaList, session: req.session });
});

router.get('/videolar', (req, res) => {
  const categories = prepare('SELECT * FROM categories ORDER BY name').all();
  const mediaList = prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.type = 'video' ORDER BY m.created_at DESC
  `).all();
  res.render('videos', { categories, mediaList, session: req.session });
});

module.exports = router;
