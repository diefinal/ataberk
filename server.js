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
  req.session.justLoggedIn = true;
  delete req.session.pendingEmail;
  res.redirect('/');
});

app.get('/cikis-yap', (req, res) => {
  req.session.verified = false;
  req.session.visitorEmail = null;
  res.redirect('/giris');
});

app.use('/admin', require('./routes/admin')); // auth middleware'den önce
app.use('/youtube', requireAuth, require('./routes/youtube'));
app.use('/haberler', require('./routes/news')); // auth gerekmez
app.use('/oyunlar', require('./routes/games')); // auth gerekmez
app.use('/taksi', require('./routes/taksi')); // auth gerekmez
app.use('/', requireAuth, require('./routes/public'));
app.use('/api', requireAuth, require('./routes/api'));

// Taksi Sıra Takip Arka Plan Servisi (Çoklu Kullanıcı Uyumlu)
async function startTaksiMonitor() {
  const taksiState = require('./routes/taksi-state');
  
  async function checkQueue() {
    try {
      const data = await taksiState.fetchQueueData();
      const currentSehirici = parseInt(data.sehirici, 10);
      const currentSehirdisi = parseInt(data.sehirdisi, 10);
      const sehiriciDongu = parseInt(data.sehirici_dongu, 10) || 0;
      const sehirdisiDongu = parseInt(data.sehirdisi_dongu, 10) || 0;
      
      const lastState = taksiState.lastSeenState;
      let hasChanges = false;

      // 1. Şehiriçi Değişim Kontrolü
      if (!isNaN(currentSehirici) && (lastState.sehirici.number !== currentSehirici || lastState.sehirici.dongu !== sehiriciDongu)) {
        console.log(`[Taksi Sunucu - Şehiriçi] Değişim: ${lastState.sehirici.number || 'Yok'} -> ${currentSehirici}`);
        lastState.sehirici.number = currentSehirici;
        lastState.sehirici.dongu = sehiriciDongu;
        hasChanges = true;

        // Aboneleri tara ve bildir
        taksiState.activeSubscriptions.forEach(async (sub) => {
          if (sub.sehiriciEnabled && currentSehirici >= sub.sehiriciRangeStart && currentSehirici <= sub.sehiriciRangeEnd) {
            if (sub.lastSehiriciVal !== currentSehirici) {
              sub.lastSehiriciVal = currentSehirici;
              sub.lastUpdated = Date.now();
              const msg = `Şehiriçi sırası ${currentSehirici} oldu! (${sub.sehiriciRangeStart}-${sub.sehiriciRangeEnd} aralığı).`;
              console.log(`[ALARM] [Şehiriçi] Sent to ${sub.ntfyTopic}: ${msg}`);
              await taksiState.sendPushNotification(sub.ntfyTopic, msg, '🚨 ŞEHİRİÇİ SIRA UYARISI', 'taxi,warning,rotating_light');
            }
          }
        });
      }

      // 2. Şehirdışı Değişim Kontrolü
      if (!isNaN(currentSehirdisi) && (lastState.sehirdisi.number !== currentSehirdisi || lastState.sehirdisi.dongu !== sehirdisiDongu)) {
        console.log(`[Taksi Sunucu - Şehirdışı] Değişim: ${lastState.sehirdisi.number || 'Yok'} -> ${currentSehirdisi}`);
        lastState.sehirdisi.number = currentSehirdisi;
        lastState.sehirdisi.dongu = sehirdisiDongu;
        hasChanges = true;

        // Aboneleri tara ve bildir
        taksiState.activeSubscriptions.forEach(async (sub) => {
          if (sub.sehirdisiEnabled && currentSehirdisi >= sub.sehirdisiRangeStart && currentSehirdisi <= sub.sehirdisiRangeEnd) {
            if (sub.lastSehirdisiVal !== currentSehirdisi) {
              sub.lastSehirdisiVal = currentSehirdisi;
              sub.lastUpdated = Date.now();
              const msg = `Şehirdışı sırası ${currentSehirdisi} oldu! (${sub.sehirdisiRangeStart}-${sub.sehirdisiRangeEnd} aralığı).`;
              console.log(`[ALARM] [Şehirdışı] Sent to ${sub.ntfyTopic}: ${msg}`);
              await taksiState.sendPushNotification(sub.ntfyTopic, msg, '🚨 ŞEHİRDIŞI SIRA UYARISI', 'taxi,warning,bullettrain_side');
            }
          }
        });
      }

      if (hasChanges) {
        taksiState.saveSubscriptions();
      }

    } catch (err) {
      console.error('[Taksi Sunucu] Hata:', err.message);
    }
    
    // Her 10 saniyede bir kontrol et
    setTimeout(checkQueue, 10000);
  }

  // Takibi başlat
  checkQueue();
}

// DB başlat, sonra sunucuyu aç
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Adres: http://localhost:${PORT}`);
    startTaksiMonitor(); // Taksi takip motorunu başlat
  });
}).catch(err => {
  console.error('DB başlatma hatası:', err);
  process.exit(1);
});
