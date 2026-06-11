const express = require('express');
const router = express.Router();
const { prepare } = require('../db');
const { sendOtp } = require('../mailer');

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

router.get('/', (req, res) => {
  if (req.session.verified) return res.redirect('/');
  res.render('auth/login', { error: null, step: 'email' });
});

router.post('/', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.render('auth/login', { error: 'Geçerli bir e-posta girin', step: 'email' });
  }

  const code = generateCode();
  const expires = Date.now() + 10 * 60 * 1000;

  await prepare('DELETE FROM otp_codes WHERE email = $1').run([email.toLowerCase()]);
  await prepare('INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)').run(
    [email.toLowerCase(), code, expires]
  );

  try {
    await sendOtp(email, code);
    req.session.pendingEmail = email.toLowerCase();
    res.render('auth/login', { error: null, step: 'code' });
  } catch (e) {
    console.error('Mail hatası:', e.message);
    res.render('auth/login', { error: 'E-posta gönderilemedi. Lütfen tekrar deneyin.', step: 'email' });
  }
});

module.exports = router;
