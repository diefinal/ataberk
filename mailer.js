const fs = require("fs/promises"),
  path = require("path"),
  crypto = require("crypto"),
  config = require("./config/runtime"),
  { runtime } = config;
async function sendMail(message) {
  if (config.production) {
    if (
      !config.mail.enabled &&
      message.to.toLowerCase() !== config.mail.testRecipient.toLowerCase()
    )
      throw Error("Production mail is restricted to test recipient");
    const html = message.kind === "otp" ? undefined : message.html;
    const text =
      message.kind === "otp"
        ? `Giriş kodunuz: ${message.code}. Kod 10 dakika geçerlidir.`
        : message.kind === "invitation"
          ? `Ataberk'in Dünyası aile davetiniz: ${message.url}\nBu bağlantı 48 saat geçerlidir.`
          : message.text;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.mail.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: [message.to],
        subject: message.subject || "Ataberk'in Dünyası giriş kodunuz",
        text,
        html,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error("Mail provider rejected delivery");
    return;
  }
  const dir = path.join(runtime, "outbox");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${Date.now()}-${crypto.randomUUID()}.json`),
    JSON.stringify({
      ...message,
      transport: "local-only",
      createdAt: new Date().toISOString(),
    }),
    { flag: "wx" },
  );
}
module.exports = {
  sendMail,
  sendOtp: (email, code) => sendMail({ to: email, kind: "otp", code }),
};
