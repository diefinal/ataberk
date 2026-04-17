const express = require('express');
const router = express.Router();

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_HANDLE = process.env.YOUTUBE_CHANNEL; // @diefinal

// Kanal ID'sini handle'dan al
async function getChannelId() {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${CHANNEL_HANDLE.replace('@','')}&key=${API_KEY}`
  );
  const data = await res.json();
  return data.items?.[0]?.id;
}

// Videoları getir
async function getVideos(channelId, pageToken = '') {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=24&order=date&type=video${pageToken ? '&pageToken=' + pageToken : ''}&key=${API_KEY}`;
  const res = await fetch(url);
  return res.json();
}

// YouTube sayfası
router.get('/', async (req, res) => {
  try {
    const { prepare } = require('../db');
    const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
    const pageToken = req.query.page || '';
    const channelId = await getChannelId();
    if (!channelId) throw new Error('Kanal bulunamadı');
    const data = await getVideos(channelId, pageToken);
    const videos = data.items || [];
    res.render('youtube', {
      videos,
      nextPage: data.nextPageToken || null,
      prevPage: data.prevPageToken || null,
      categories,
      session: req.session
    });
  } catch (e) {
    console.error('YouTube hatası:', e.message);
    const { prepare } = require('../db');
    const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
    res.render('youtube', { videos: [], nextPage: null, prevPage: null, categories, session: req.session, error: e.message });
  }
});

// Video detay
router.get('/video/:id', async (req, res) => {
  try {
    const { prepare } = require('../db');
    const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
    const res2 = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${req.params.id}&key=${API_KEY}`
    );
    const data = await res2.json();
    const video = data.items?.[0];
    if (!video) return res.redirect('/youtube');
    res.render('youtube-video', { video, categories, session: req.session });
  } catch (e) {
    res.redirect('/youtube');
  }
});

module.exports = router;
