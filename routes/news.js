const express = require("express");
const Parser = require("rss-parser");
const FEEDS = Object.freeze([
  {
    name: "Sözcü",
    url: "https://www.sozcu.com.tr/rss/son-dakika.xml",
    label: "Gündem",
    icon: "✦",
  },
  {
    name: "Hürriyet Spor",
    url: "https://www.hurriyet.com.tr/rss/spor",
    label: "Spor",
    icon: "↗",
  },
  {
    name: "Milliyet Spor",
    url: "https://www.milliyet.com.tr/rss/rssNew/spor",
    label: "Spor",
    icon: "◉",
  },
]);
const plain = (value, max) =>
  String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
function articleUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function normalizeItems(items) {
  return (items || [])
    .slice(0, 15)
    .map((item) => {
      const date = new Date(item.isoDate || item.pubDate || "invalid");
      return {
        title: plain(item.title, 240),
        link: articleUrl(item.link || item.atomLink?.$?.href),
        summary: plain(item.contentSnippet, 220),
        date: Number.isFinite(date.getTime()) ? date : null,
      };
    })
    .filter((item) => item.title && item.link);
}
async function fetchRss(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(7000),
    headers: { "User-Agent": "AtaberkFamilyNews/1.0" },
  });
  if (!response.ok || !response.body) throw Error("News source unavailable");
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw Error("News feed exceeds limit");
    chunks.push(chunk);
  }
  return new Parser({
    customFields: { item: [["atom:link", "atomLink"]] },
  }).parseString(Buffer.concat(chunks).toString("utf8"));
}
function createFeedService({ load = fetchRss, now = Date.now } = {}) {
  const cache = new Map(),
    pending = new Map();
  return async function getFeed(feed) {
    const saved = cache.get(feed.name);
    if (saved && now() < saved.retryAt) return saved;
    if (pending.has(feed.name)) return pending.get(feed.name);
    const job = (async () => {
      let result;
      try {
        const parsed = await load(feed.url);
        result = {
          items: normalizeItems(parsed.items),
          updatedAt: new Date(now()),
          stale: false,
          retryAt: now() + 600000,
        };
      } catch {
        result = {
          items: saved?.items || [],
          updatedAt: saved?.updatedAt || null,
          stale: true,
          retryAt: now() + 60000,
        };
      }
      cache.set(feed.name, result);
      return result;
    })();
    pending.set(feed.name, job);
    try {
      return await job;
    } finally {
      pending.delete(feed.name);
    }
  };
}
function createNewsRouter({ getFeed = createFeedService() } = {}) {
  const router = express.Router();
  router.get("/", async (req, res, next) => {
    try {
      const feed = FEEDS.find((f) => f.name === req.query.kaynak) || FEEDS[0];
      const result = await getFeed(feed);
      res.render("news", {
        title: "Haberler",
        news: true,
        feeds: FEEDS,
        activeFeed: feed,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
module.exports = {
  FEEDS,
  articleUrl,
  normalizeItems,
  createFeedService,
  createNewsRouter,
};
