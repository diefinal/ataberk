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

// Secret spots configuration
const VISUAL_SECRETS = [
  { x: 63.5, y: 63.0 }, // SQL (laptop screen)
  { x: 22.0, y: 73.0 }, // Emzik (pacifier)
  { x: 75.0, y: 86.0 }  // Degrade Şart (bottom green text)
];
const VISUAL_TOLERANCE = 8.5; // %8.5 tolerance radius

router.post('/gorsel-giris', (req, res) => {
  const { clicks } = req.body;
  if (!clicks || !Array.isArray(clicks) || clicks.length !== 3) {
    return res.status(400).json({ success: false, message: 'Geçersiz tıklama verisi.' });
  }

  let isValid = true;
  for (let i = 0; i < 3; i++) {
    const click = clicks[i];
    const secret = VISUAL_SECRETS[i];
    
    // Euclidean distance calculation
    const dist = Math.sqrt(Math.pow(click.x - secret.x, 2) + Math.pow(click.y - secret.y, 2));
    if (dist > VISUAL_TOLERANCE) {
      isValid = false;
      break;
    }
  }

  if (isValid) {
    req.session.verified = true;
    req.session.visitorEmail = 'visual-user@ataberktasci.com';
    req.session.justLoggedIn = true;
    return res.json({ success: true });
  } else {
    return res.json({ success: false, message: 'Hatalı tıklama sırası veya yanlış noktalar. Tekrar deneyin.' });
  }
});

module.exports = router;

