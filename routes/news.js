const express = require('express');
const router = express.Router();
const Parser = require('rss-parser');
const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0' },
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure'],
    ]
  }
});

const FEEDS = [
  { name: 'Sözcü', url: 'https://www.sozcu.com.tr/rss/son-dakika.xml', color: '#d62828', icon: '📰' },
  { name: 'Hürriyet Spor', url: 'https://www.hurriyet.com.tr/rss/spor', color: '#2196f3', icon: '⚽' },
  { name: 'Milliyet Spor', url: 'https://www.milliyet.com.tr/rss/rssNew/spor', color: '#ff6b35', icon: '🏆' },
];

// Cache — 10 dakikada bir güncelle
let cache = {};
let lastFetch = {};

async function getFeed(feed) {
  const now = Date.now();
  if (cache[feed.name] && now - lastFetch[feed.name] < 10 * 60 * 1000) {
    return cache[feed.name];
  }
  try {
    const result = await parser.parseURL(feed.url);
    const items = result.items.slice(0, 15).map(item => {
      // Resmi farklı alanlardan bulmaya çalış
      let image = null;
      if (item.enclosure?.url) image = item.enclosure.url;
      else if (item.mediaContent?.['$']?.url) image = item.mediaContent['$'].url;
      else if (item.mediaThumbnail?.['$']?.url) image = item.mediaThumbnail['$'].url;
      else if (item['media:content']?.['$']?.url) image = item['media:content']['$'].url;
      else if (item['media:thumbnail']?.['$']?.url) image = item['media:thumbnail']['$'].url;
      // content içinden resim çek
      if (!image && item.content) {
        const match = item.content.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match) image = match[1];
      }

      return {
        title: item.title,
        link: item.link,
        date: item.pubDate ? new Date(item.pubDate) : new Date(),
        image,
        summary: item.contentSnippet?.substring(0, 150) || ''
      };
    });
    cache[feed.name] = items;
    lastFetch[feed.name] = now;
    return items;
  } catch (e) {
    console.error(`RSS hatası (${feed.name}):`, e.message);
    return cache[feed.name] || [];
  }
}

router.get('/', async (req, res) => {
  const { prepare } = require('../db');
  const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
  const activeTab = req.query.kaynak || 'Sözcü';

  const allFeeds = await Promise.all(FEEDS.map(async f => ({
    ...f,
    items: await getFeed(f)
  })));

  const activeFeed = allFeeds.find(f => f.name === activeTab) || allFeeds[0];

  res.render('news', {
    feeds: allFeeds,
    activeFeed,
    categories,
    session: req.session
  });
});

module.exports = router;
