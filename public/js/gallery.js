(() => {
  const triggers = [...document.querySelectorAll("[data-gallery-open]")],
    dialog = document.querySelector(".gallery-dialog");
  if (!dialog || !triggers.length) return;
  const stage = dialog.querySelector(".gallery-stage"),
    title = dialog.querySelector(".gallery-title"),
    counter = dialog.querySelector(".gallery-counter"),
    prev = dialog.querySelector("[data-gallery-prev]"),
    next = dialog.querySelector("[data-gallery-next]"),
    zoom = dialog.querySelector("[data-gallery-zoom]");
  let index = 0,
    origin,
    startX = 0;
  function clear() {
    const video = stage.querySelector("video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    stage.replaceChildren();
    stage.classList.remove("zoomed");
    zoom.textContent = "Yakınlaştır";
  }
  function show(i) {
    index = (i + triggers.length) % triggers.length;
    clear();
    const source = triggers[index].dataset,
      media = document.createElement(source.type === "video" ? "video" : "img");
    media.src = source.src;
    if (source.type === "video") {
      media.controls = true;
      media.preload = "metadata";
      if (source.poster) media.poster = source.poster;
    } else media.alt = source.title;
    media.addEventListener("error", () => {
      const warning = document.createElement("p");
      warning.textContent = "Bu anı açılamadı. Erişim iznin değişmiş olabilir.";
      stage.replaceChildren(warning);
    });
    stage.append(media);
    title.textContent = source.title;
    counter.textContent = `${index + 1} / ${triggers.length}`;
    prev.disabled = next.disabled = triggers.length === 1;
    zoom.hidden = source.type === "video";
    dialog.querySelector(".gallery-detail").href = "/medya/" + source.id;
  }
  triggers.forEach((button, i) =>
    button.addEventListener("click", () => {
      origin = button;
      show(i);
      dialog.showModal();
    }),
  );
  prev.addEventListener("click", () => show(index - 1));
  next.addEventListener("click", () => show(index + 1));
  dialog
    .querySelector("[data-gallery-close]")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    clear();
    origin?.focus();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      show(index - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      show(index + 1);
    }
  });
  zoom.addEventListener("click", () => {
    const active = stage.classList.toggle("zoomed");
    zoom.textContent = active ? "Sığdır" : "Yakınlaştır";
  });
  stage.addEventListener("pointerdown", (e) => (startX = e.clientX));
  stage.addEventListener("pointerup", (e) => {
    if (stage.querySelector("video") || stage.classList.contains("zoomed"))
      return;
    const d = e.clientX - startX;
    if (Math.abs(d) > 45) show(index + (d < 0 ? 1 : -1));
  });
})();
