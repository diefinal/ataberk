const express = require('express');
const router = express.Router();
const { prepare } = require('../db');
const state = require('./taksi-state');

// GET /taksi -> Render main dashboard page
router.get('/', async (req, res) => {
  try {
    const categories = await prepare('SELECT * FROM categories ORDER BY name').all();
    res.render('taksi', { categories, session: req.session });
  } catch (err) {
    console.error('Error loading categories for taksi page:', err.message);
    res.render('taksi', { categories: [], session: req.session });
  }
});

// GET /taksi/api/queue -> Proxy queue data (fallback to bridge data if blocked)
router.get('/api/queue', async (req, res) => {
  try {
    // Try to fetch live data directly (works locally on PC)
    const data = await state.fetchQueueData();
    // Update local state just in case
    state.latestQueueData = data;
    return res.json({ success: true, data });
  } catch (err) {
    // If direct fetch fails (e.g. blocked on cloud server), fallback to pushed bridge data
    if (state.latestQueueData) {
      return res.json({ success: true, data: state.latestQueueData });
    }
    res.status(500).json({ success: false, error: 'Sıra verisi çekilemedi ve kayıtlı yedek veri bulunamadı.' });
  }
});

// POST /taksi/api/push-data -> Securely receive queue data from local PC bridge
router.post('/api/push-data', async (req, res) => {
  try {
    const { token, data } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (!token || token !== adminPassword) {
      return res.status(401).json({ success: false, error: 'Yetkisiz erişim: Geçersiz token.' });
    }

    if (!data || !data.sehirici || !data.sehirdisi) {
      return res.status(400).json({ success: false, error: 'Geçersiz veri formatı.' });
    }

    // Update global state
    state.latestQueueData = data;
    console.log(`[Taksi Köprü] Yeni veri alındı: Şehiriçi: ${data.sehirici}, Şehirdışı: ${data.sehirdisi}`);

    // Process subscriptions immediately
    const currentSehirici = parseInt(data.sehirici, 10);
    const currentSehirdisi = parseInt(data.sehirdisi, 10);
    const sehiriciDongu = parseInt(data.sehirici_dongu, 10) || 0;
    const sehirdisiDongu = parseInt(data.sehirdisi_dongu, 10) || 0;
    
    const lastState = state.lastSeenState;
    let hasChanges = false;

    // 1. Şehiriçi Değişim Kontrolü
    if (!isNaN(currentSehirici) && (lastState.sehirici.number !== currentSehirici || lastState.sehirici.dongu !== sehiriciDongu)) {
      console.log(`[Taksi Köprü - Şehiriçi] Değişim: ${lastState.sehirici.number || 'Yok'} -> ${currentSehirici}`);
      lastState.sehirici.number = currentSehirici;
      lastState.sehirici.dongu = sehiriciDongu;
      hasChanges = true;

      // Aboneleri tara ve bildir
      state.activeSubscriptions.forEach(async (sub) => {
        if (sub.sehiriciEnabled && currentSehirici >= sub.sehiriciRangeStart && currentSehirici <= sub.sehiriciRangeEnd) {
          if (sub.lastSehiriciVal !== currentSehirici) {
            sub.lastSehiriciVal = currentSehirici;
            sub.lastUpdated = Date.now();
            const msg = `Şehiriçi sırası ${currentSehirici} oldu! (${sub.sehiriciRangeStart}-${sub.sehiriciRangeEnd} aralığı).`;
            console.log(`[ALARM] [Şehiriçi] Sent to ${sub.ntfyTopic}: ${msg}`);
            await state.sendPushNotification(sub.ntfyTopic, msg, '🚨 ŞEHİRİÇİ SIRA UYARISI', 'taxi,warning,rotating_light');
          }
        }
      });
    }

    // 2. Şehirdışı Değişim Kontrolü
    if (!isNaN(currentSehirdisi) && (lastState.sehirdisi.number !== currentSehirdisi || lastState.sehirdisi.dongu !== sehirdisiDongu)) {
      console.log(`[Taksi Köprü - Şehirdışı] Değişim: ${lastState.sehirdisi.number || 'Yok'} -> ${currentSehirdisi}`);
      lastState.sehirdisi.number = currentSehirdisi;
      lastState.sehirdisi.dongu = sehirdisiDongu;
      hasChanges = true;

      // Aboneleri tara ve bildir
      state.activeSubscriptions.forEach(async (sub) => {
        if (sub.sehirdisiEnabled && currentSehirdisi >= sub.sehirdisiRangeStart && currentSehirdisi <= sub.sehirdisiRangeEnd) {
          if (sub.lastSehirdisiVal !== currentSehirdisi) {
            sub.lastSehirdisiVal = currentSehirdisi;
            sub.lastUpdated = Date.now();
            const msg = `Şehirdışı sırası ${currentSehirdisi} oldu! (${sub.sehirdisiRangeStart}-${sub.sehirdisiRangeEnd} aralığı).`;
            console.log(`[ALARM] [Şehirdışı] Sent to ${sub.ntfyTopic}: ${msg}`);
            await state.sendPushNotification(sub.ntfyTopic, msg, '🚨 ŞEHİRDIŞI SIRA UYARISI', 'taxi,warning,bullettrain_side');
          }
        }
      });
    }

    if (hasChanges) {
      state.saveSubscriptions();
    }

    res.json({ success: true, message: 'Veri başarıyla işlendi.' });
  } catch (err) {
    console.error('[Taksi Köprü] Hata:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /taksi/api/subscribe -> Register or update a taxi driver alert subscription
router.post('/api/subscribe', (req, res) => {
  try {
    const {
      clientId, // unique persistent ID generated by client browser localStorage
      ntfyTopic,
      sehiriciEnabled,
      sehiriciRangeStart,
      sehiriciRangeEnd,
      sehirdisiEnabled,
      sehirdisiRangeStart,
      sehirdisiRangeEnd
    } = req.body;

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId zorunludur.' });
    }

    if (!ntfyTopic || ntfyTopic.trim() === '') {
      return res.status(400).json({ success: false, error: 'ntfy konu adı boş olamaz.' });
    }

    // Find if subscription already exists for this client
    let sub = state.activeSubscriptions.find(s => s.clientId === clientId);
    
    if (sub) {
      // Update existing
      sub.ntfyTopic = String(ntfyTopic).trim();
      sub.sehiriciEnabled = Boolean(sehiriciEnabled);
      sub.sehiriciRangeStart = parseInt(sehiriciRangeStart, 10);
      sub.sehiriciRangeEnd = parseInt(sehiriciRangeEnd, 10);
      sub.sehirdisiEnabled = Boolean(sehirdisiEnabled);
      sub.sehirdisiRangeStart = parseInt(sehirdisiRangeStart, 10);
      sub.sehirdisiRangeEnd = parseInt(sehirdisiRangeEnd, 10);
      sub.lastUpdated = Date.now();
      
      // Reset sent status for sehirici if range changed
      if (sub.lastSehiriciVal !== undefined) delete sub.lastSehiriciVal;
      if (sub.lastSehirdisiVal !== undefined) delete sub.lastSehirdisiVal;
      
      console.log(`[Taksi] Abonelik güncellendi: Client: ${clientId}, Topic: ${sub.ntfyTopic}`);
    } else {
      // Create new
      sub = {
        clientId,
        ntfyTopic: String(ntfyTopic).trim(),
        sehiriciEnabled: Boolean(sehiriciEnabled),
        sehiriciRangeStart: parseInt(sehiriciRangeStart, 10),
        sehiriciRangeEnd: parseInt(sehiriciRangeEnd, 10),
        sehirdisiEnabled: Boolean(sehirdisiEnabled),
        sehirdisiRangeStart: parseInt(sehirdisiRangeStart, 10),
        sehirdisiRangeEnd: parseInt(sehirdisiRangeEnd, 10),
        lastUpdated: Date.now()
      };
      state.activeSubscriptions.push(sub);
      console.log(`[Taksi] Yeni abonelik eklendi: Client: ${clientId}, Topic: ${sub.ntfyTopic}`);
    }

    state.saveSubscriptions();
    res.json({ success: true, message: 'Takip başarıyla başlatıldı!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /taksi/api/test-push -> Trigger immediate test push notification
router.post('/api/test-push', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic || topic.trim() === '') {
      return res.status(400).json({ success: false, error: 'Lütfen geçerli bir ntfy kanal adı girin.' });
    }

    const testMsg = `Deneme Bildirimi: Telefon bağlantınız başarıyla kuruldu! Sıra takip uyarısı bu kanaldan gelecektir.`;
    await state.sendPushNotification(topic, testMsg, '🔔 Test Uyarısı', 'white_check_mark,tada');
    
    res.json({ success: true, message: 'Test bildirimi telefona gönderildi!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
