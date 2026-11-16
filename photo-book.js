const PDFDocument = require("pdfkit"),
  fs = require("fs"),
  path = require("path"),
  { runtime } = require("./config/runtime");
// No external assets: only authorized local images supplied by the route.
async function buildBook(album, items) {
  const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      autoFirstPage: false,
      info: {
        Title: album.title,
        Author: "Ataberk'in Dünyası",
        Subject: "Özel aile anı kitapçığı",
      },
    }),
    chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const font =
      require("./config/runtime").font ||
      path.join(process.env.WINDIR || "C:/Windows", "Fonts", "segoeui.ttf"),
    bold =
      require("./config/runtime").boldFont ||
      path.join(process.env.WINDIR || "C:/Windows", "Fonts", "segoeuib.ttf");
  if (!fs.existsSync(font) || !fs.existsSync(bold))
    throw Error("Local Unicode PDF fonts unavailable");
  doc.registerFont("body", font);
  doc.registerFont("bold", bold);
  const W = 595.28,
    H = 841.89;
  let page = 0;
  function base(color = "#FAF7F1") {
    doc.addPage();
    page++;
    doc.rect(0, 0, W, H).fill(color);
    doc
      .fillColor("#233E3C")
      .font("body")
      .fontSize(9)
      .text("ATABERK'İN DÜNYASI", 42, 35, { lineBreak: false });
    doc
      .moveTo(42, 62)
      .lineTo(W - 42, 62)
      .strokeColor("#CFD6CB")
      .stroke();
    doc
      .fontSize(9)
      .text("Aileye özel anı kitapçığı", 42, H - 40, { lineBreak: false });
    doc.text(String(page), W - 60, H - 40, { lineBreak: false });
  }
  base("#A9CBE4");
  doc.font("body").fontSize(11).text("BİRLİKTE BİRİKTİRDİKLERİMİZ", 42, 135);
  doc
    .font("bold")
    .fontSize(39)
    .text(album.title, 42, 190, { width: W - 84, height: 150, ellipsis: true });
  doc
    .font("body")
    .fontSize(15)
    .text(album.description || "Küçük anlar, kocaman bir dünya.", 42, 365, {
      width: W - 84,
      height: 130,
      ellipsis: true,
    });
  doc
    .fontSize(12)
    .text(`${items.length} fotoğraf · Sevgiyle saklandı`, 42, 650);
  doc
    .fontSize(10)
    .text(
      "Bu kitapçık özel aile içeriği içerir. Paylaşmadan önce aile izinlerini gözetin.",
      42,
      700,
      { width: W - 84 },
    );
  for (const item of items) {
    base();
    doc
      .font("bold")
      .fontSize(24)
      .text(item.title, 42, 86, { width: W - 84, height: 65, ellipsis: true });
    const file = await require("./storage").read(
      "private-media",
      item.storage_key,
      item.mime,
    );
    if (!/^[a-f0-9-]{36}$/.test(item.storage_key))
      throw Error("Invalid private media key");
    doc.image(file, 42, 165, {
      fit: [W - 84, 350],
      align: "center",
      valign: "center",
    });
    const details = [
      item.taken_on
        ? new Date(item.taken_on).toLocaleDateString("tr-TR", {
            timeZone: "Europe/Istanbul",
          })
        : "",
      item.place_text,
      item.people_names,
    ]
      .filter(Boolean)
      .join(" · ");
    doc
      .font("body")
      .fontSize(10)
      .fillColor("#53675F")
      .text(details || "Bir aile anısı", 42, 548, {
        width: W - 84,
        height: 45,
        ellipsis: true,
      });
    doc
      .fontSize(13)
      .fillColor("#233E3C")
      .text(
        item.description || "Bu anın güzelliği fotoğrafında saklı.",
        42,
        612,
        { width: W - 84, height: 115, ellipsis: true },
      );
  }
  doc.end();
  return done;
}
module.exports = { buildBook };
