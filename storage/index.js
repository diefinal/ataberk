const fs = require("fs/promises"),
  path = require("path");
const config = require("../config/runtime");
let cloud;
function localPath(kind, key) {
  if (
    !["private-media", "avatars", "voice-notes"].includes(kind) ||
    !/^[a-f0-9-]{36}$/.test(key)
  )
    throw Error("Invalid private storage key");
  return path.join(config.runtime, kind, key);
}
function cloudStore() {
  return (cloud ||= require("./cloudinary").createCloudStorage({
    credentials: config.cloudinary,
  }));
}
async function put(kind, key, bytes, mime) {
  if (config.production) return cloudStore().put(kind, key, bytes, mime);
  const dest = localPath(kind, key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes, { flag: "wx" });
}
async function read(kind, key, mime) {
  return config.production
    ? cloudStore().read(kind, key, mime)
    : fs.readFile(localPath(kind, key));
}
async function rollback(kind, key, mime) {
  return config.production
    ? cloudStore().rollback(kind, key, mime)
    : fs.unlink(localPath(kind, key));
}
async function serve(req, res, kind, key, mime) {
  if (!config.production)
    return new Promise((resolve) =>
      res.sendFile(localPath(kind, key), { acceptRanges: true }, (e) => {
        if (e && !res.headersSent) res.sendStatus(404);
        resolve();
      }),
    );
  const bytes = await read(kind, key, mime),
    range = req.get("range");
  res.set({
    "Cache-Control": "private, no-store",
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
  });
  if (!range) {
    res.set("Content-Length", String(bytes.length));
    return res.end(req.method === "HEAD" ? undefined : bytes);
  }
  const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start, end;
  if (parsed && (parsed[1] || parsed[2])) {
    start = parsed[1]
      ? Number(parsed[1])
      : Math.max(0, bytes.length - Number(parsed[2]));
    end = parsed[1]
      ? parsed[2]
        ? Number(parsed[2])
        : bytes.length - 1
      : bytes.length - 1;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= bytes.length ||
    end < start
  ) {
    res.set("Content-Range", `bytes */${bytes.length}`);
    return res.sendStatus(416);
  }
  end = Math.min(end, bytes.length - 1);
  res
    .status(206)
    .set({
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      "Content-Length": String(end - start + 1),
    })
    .end(req.method === "HEAD" ? undefined : bytes.subarray(start, end + 1));
}
module.exports = { put, read, rollback, serve };
