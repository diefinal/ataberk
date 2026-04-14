const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendOtp(toEmail, code) {
  await resend.emails.send({
    from: 'Ataberktaşçı <noreply@ataberktasci.com.tr>',
    to: toEmail,
    subject: 'Giriş Doğrulama Kodunuz',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;">
        <div style="background:#111;padding:24px;text-align:center;">
          <h1 style="color:#fff;font-size:1.4rem;margin:0;">Ataberk<span style="color:#c8102e;">.</span>Taşçı</h1>
        </div>
        <div style="background:#f5f5f0;padding:32px;text-align:center;">
          <p style="color:#666;margin-bottom:24px;">Siteye giriş için doğrulama kodunuz:</p>
          <div style="background:#111;color:#fff;font-size:2.5rem;font-weight:900;letter-spacing:12px;padding:20px;display:inline-block;">
            ${code}
          </div>
          <p style="color:#999;font-size:0.85rem;margin-top:24px;">Bu kod 10 dakika geçerlidir.</p>
        </div>
      </div>
    `
  });
}

module.exports = { sendOtp };
