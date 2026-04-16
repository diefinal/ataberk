require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads klasörü oluştur
const uploadDirs = ['uploads/images', 'uploads/videos', 'uploads/thumbnails'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ataberktasci-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.user) return next(); // admin her zaman geçer
  if (req.session.verified) return next();
  res.redirect('/giris');
};

// Routes
const authRouter = require('./routes/auth');
app.use('/giris', authRouter);

app.post('/dogrula', async (req, res) => {
  const { code } = req.body;
  const email = req.session.pendingEmail;
  if (!email) return res.redirect('/giris');

  const { prepare } = require('./db');
  const record = await prepare('SELECT * FROM otp_codes WHERE email = $1 AND used = 0 ORDER BY id DESC LIMIT 1').get([email]);

  if (!record) return res.render('auth/login', { error: 'Kod bulunamadı. Tekrar deneyin.', step: 'code' });
  if (Date.now() > record.expires_at) return res.render('auth/login', { error: 'Kodun süresi doldu.', step: 'email' });
  if (record.code !== code.trim()) return res.render('auth/login', { error: 'Hatalı kod.', step: 'code' });

  await prepare('UPDATE otp_codes SET used = 1 WHERE id = $1').run([record.id]);
  req.session.verified = true;
  req.session.visitorEmail = email;
  delete req.session.pendingEmail;
  res.redirect('/');
});

app.get('/cikis-yap', (req, res) => {
  req.session.verified = false;
  req.session.visitorEmail = null;
  res.redirect('/giris');
});

app.use('/admin', require('./routes/admin')); // auth middleware'den önce
app.use('/', requireAuth, require('./routes/public'));
app.use('/api', requireAuth, require('./routes/api'));

// DB başlat, sonra sunucuyu aç
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Adres: http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB başlatma hatası:', err);
  process.exit(1);
});
