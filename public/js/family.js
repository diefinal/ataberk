document.querySelector(".menu-toggle")?.addEventListener("click", function () {
  const expanded = this.getAttribute("aria-expanded") !== "true";
  this.setAttribute("aria-expanded", String(expanded));
  document.getElementById("main-nav").classList.toggle("open", expanded);
});
document.querySelectorAll("[data-upload]").forEach((form) =>
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const status = this.querySelector("[data-upload-status]"),
      button = this.querySelector("button");
    const files = this.querySelector("[type=file]").files;
    if (
      files.length > 10 ||
      Array.from(files).some((f) => f.size > 30 * 1024 * 1024) ||
      Array.from(files).reduce((s, f) => s + f.size, 0) > 60 * 1024 * 1024
    ) {
      status.textContent = "Dosya sayısı veya boyut sınırı aşıldı.";
      return;
    }
    button.disabled = true;
    status.textContent = "Anılar güvenli biçimde yükleniyor…";
    try {
      const r = await fetch(this.action, {
        method: "POST",
        headers: {
          "x-csrf-token": document.querySelector("[name=csrf-token]").content,
        },
        body: new FormData(this),
      });
      if (!r.ok)
        throw Error(
          "Yükleme tamamlanamadı. Dosya türünü, boyutunu ve albüm iznini kontrol edin.",
        );
      location.assign(this.dataset.success || "/admin");
    } catch (e) {
      status.textContent = e.message;
      button.disabled = false;
    }
  }),
);
document.querySelectorAll("[data-reactions]").forEach(async (el) => {
  try {
    const response = await fetch("/aile-api/reaksiyon/" + el.dataset.reactions);
    if (!response.ok) return;
    const data = await response.json();
    el.textContent =
      Object.entries(data.counts)
        .map(([emoji, n]) => emoji + " " + n)
        .join("  ") +
      (data.userEmoji ? " · Senin tepkin: " + data.userEmoji : "");
  } catch {
    el.textContent = "Tepkiler şu anda yüklenemedi.";
  }
});
// Manual story selector: no autoplay, no private data in public copy.
document.querySelectorAll("[data-story]").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll("[data-story]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    const caption = document.querySelector("[data-story-caption]");
    if (caption) caption.textContent = button.dataset.story;
    const status = document.querySelector(".story-caption-status");
    if (status) status.textContent = button.dataset.story;
  }),
);
