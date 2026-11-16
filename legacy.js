// Keep existing modules and old IDs on their original, unchanged service.
const express = require("express");
const LEGACY_ORIGIN = "https://ataberktasci.onrender.com";
const prefixes = [
  "/youtube",
  "/taksi",
  "/api",
  "/medya",
  "/kategori",
  "/arama",
  "/uploads",
];
function destination(original) {
  if (
    typeof original !== "string" ||
    !original.startsWith("/") ||
    original.startsWith("//")
  )
    return null;
  let url, decoded;
  try {
    url = new URL(original, LEGACY_ORIGIN);
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (
    url.origin !== LEGACY_ORIGIN ||
    /[\x00-\x20\\]/.test(decoded) ||
    decoded.split("/").some((s) => s === "." || s === "..")
  )
    return null;
  return prefixes.some(
    (p) => url.pathname === p || url.pathname.startsWith(p + "/"),
  )
    ? url.href
    : null;
}
function createLegacyRouter() {
  const router = express.Router();
  router.get("/eski-site", (req, res) =>
    res.redirect(302, LEGACY_ORIGIN + "/"),
  );
  router.use((req, res, next) => {
    const url = destination(req.originalUrl);
    return url ? res.redirect(307, url) : next();
  });
  return router;
}
module.exports = { destination, createLegacyRouter, LEGACY_ORIGIN };
