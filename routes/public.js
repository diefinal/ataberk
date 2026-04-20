const express = require('express');
const router = express.Router();
const { prepare } = require('../db');

router.get('/', async (req, res) => {
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  const recentMedia = await prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    ORDER BY m.created_at DESC LIMIT 12
  `).all();
  const justLoggedIn = req.session.justLoggedIn || false;
  req.session.justLoggedIn = false;
  res.render('index', { categories, recentMedia, session: req.session, justLoggedIn });
});

router.get('/kategori/:slug', async (req, res) => {
  const category = await prepare('SELECT * FROM categories WHERE slug = $1').get([req.params.slug]);
  if (!category) return res.redirect('/');
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  const mediaList = await prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.category_id = $1 ORDER BY m.created_at DESC
  `).all([category.id]);
  res.render('category', { category, categories, mediaList, session: req.session });
});

router.get('/medya/:id', async (req, res) => {
  const media = await prepare(`
    SELECT m.*, c.name as category_name, c.slug as category_slug
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.id = $1
  `).get([req.params.id]);
  if (!media) return res.redirect('/');

  await prepare('UPDATE media SET views = views + 1 WHERE id = $1').run([media.id]);

  const comments = await prepare('SELECT * FROM comments WHERE media_id = $1 ORDER BY created_at DESC').all([media.id]);
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  const related = await prepare(`
    SELECT * FROM media WHERE category_id = $1 AND id != $2 ORDER BY created_at DESC LIMIT 6
  `).all([media.category_id, media.id]);

  res.render('media', { media, comments, categories, related, session: req.session });
});

router.get('/fotograflar', async (req, res) => {
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  const mediaList = await prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.type = 'image' ORDER BY m.created_at DESC
  `).all();
  res.render('photos', { categories, mediaList, session: req.session });
});

router.get('/videolar', async (req, res) => {
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  const mediaList = await prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.type = 'video' ORDER BY m.created_at DESC
  `).all();
  res.render('videos', { categories, mediaList, session: req.session });
});

router.get('/ara', async (req, res) => {
  const q = req.query.q?.trim();
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  if (!q) return res.render('search', { categories, results: [], q: '', session: req.session });
  const results = await prepare(`
    SELECT m.*, c.name as category_name 
    FROM media m LEFT JOIN categories c ON m.category_id = c.id 
    WHERE m.title ILIKE $1 OR m.description ILIKE $2 OR c.name ILIKE $3
    ORDER BY m.created_at DESC
  `).all([`%${q}%`, `%${q}%`, `%${q}%`]);
  res.render('search', { categories, results, q, session: req.session });
});

module.exports = router;
