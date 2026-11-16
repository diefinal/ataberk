const fs = require("fs"),
  path = require("path"),
  { chromium } = require("playwright");
function browserOptions() {
  const bundled = chromium.executablePath();
  if (fs.existsSync(bundled)) return { headless: true };
  const local = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (fs.existsSync(local)) {
    for (const folder of fs
      .readdirSync(local)
      .filter((n) => /^chromium-\d+$/.test(n))
      .sort()
      .reverse()) {
      for (const file of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"]) {
        const candidate = path.join(local, folder, file);
        if (fs.existsSync(candidate))
          return { headless: true, executablePath: candidate };
      }
    }
  }
  throw Error("Install local Playwright Chromium before browser QA");
}
module.exports = { browserOptions };
