(() => {
  const canvas = document.getElementById("drawing-pad");
  if (!canvas) return;
  const ctx = canvas.getContext("2d"),
    history = [];
  let drawing = false;
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const remember = () => {
    history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (history.length > 10) history.shift();
  };
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    };
  };
  canvas.addEventListener("pointerdown", (e) => {
    remember();
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.strokeStyle = document.getElementById("draw-color").value;
    ctx.lineWidth = Number(document.getElementById("draw-size").value);
    ctx.lineCap = "round";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const finish = () => {
    drawing = false;
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  document.getElementById("draw-undo").addEventListener("click", () => {
    if (history.length) ctx.putImageData(history.pop(), 0, 0);
  });
  document.getElementById("draw-clear").addEventListener("click", () => {
    remember();
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
  document.getElementById("draw-save").addEventListener("click", () =>
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "benim-renkli-dunyam.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }),
  );
  const symbols = [
    "☀",
    "⛵",
    "✿",
    "★",
    "☁",
    "☂",
    "♞",
    "♫",
    "☕",
    "☾",
    "✈",
    "❄",
  ];
  document.getElementById("roll-story").addEventListener("click", () => {
    const chosen = [...symbols].sort(() => Math.random() - 0.5).slice(0, 3);
    document
      .querySelectorAll("#story-dice span")
      .forEach((el, i) => (el.textContent = chosen[i]));
  });
  const prompts = [
    "Üç farklı renkte bir bahçe çiz. İçine henüz kimsenin görmediği bir çiçek ekle.",
    "Evin içinde yuvarlak beş nesne bul. Sonra onları küçük bir resimde bir araya getir.",
    "Birlikte hayali bir gezegen tasarla. Orada yaşayan bir karaktere isim ver.",
    "Sırayla birer cümle ekleyerek sonu mutlu biten bir masal anlat.",
    "Gözlerini kapatıp üç ses dinle. Sonra bu seslerin resmini yap.",
  ];
  let p = 0;
  document.getElementById("next-activity").addEventListener("click", () => {
    p = (p + 1) % prompts.length;
    document.getElementById("activity-prompt").textContent = prompts[p];
  });
})();
