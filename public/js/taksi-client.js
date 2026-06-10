// Client State
let clientId = null;
let lastQueueData = {
  sehirici: null,
  sehirdisi: null,
  sehiriciDongu: null,
  sehirdisiDongu: null
};

// Queue changes log history
let queueLogs = [];
let changeTimestamps = []; // to calculate average speed

// DOM Elements
const connBadge = document.getElementById('connBadge');
const ntfyTopicInput = document.getElementById('ntfyTopicInput');
const btnTestPush = document.getElementById('btnTestPush');
const sehiriciToggle = document.getElementById('sehiriciToggle');
const sehiriciStart = document.getElementById('sehiriciStart');
const sehiriciEnd = document.getElementById('sehiriciEnd');
const sehirdisiToggle = document.getElementById('sehirdisiToggle');
const sehirdisiStart = document.getElementById('sehirdisiStart');
const sehirdisiEnd = document.getElementById('sehirdisiEnd');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const btnClearLogs = document.getElementById('btnClearLogs');
const logWindow = document.getElementById('logWindow');
const sehiriciVal = document.getElementById('sehiriciVal');
const sehiriciBadge = document.getElementById('sehiriciBadge');
const sehirdisiVal = document.getElementById('sehirdisiVal');
const sehirdisiBadge = document.getElementById('sehirdisiBadge');
const duyuruVal = document.getElementById('duyuruVal');
const updateCountdown = document.getElementById('updateCountdown');
const statSpeed = document.getElementById('statSpeed');
const statTotal = document.getElementById('statTotal');
const sehiriciBox = document.getElementById('sehiriciBox');
const sehirdisiBox = document.getElementById('sehirdisiBox');
const sehiriciRangeConfig = document.getElementById('sehiriciRangeConfig');
const sehirdisiRangeConfig = document.getElementById('sehirdisiRangeConfig');

// Get client config object from inputs
function getClientConfig() {
  return {
    clientId: clientId,
    ntfyTopic: ntfyTopicInput.value.trim(),
    sehiriciEnabled: sehiriciToggle.checked,
    sehiriciRangeStart: parseInt(sehiriciStart.value, 10),
    sehiriciRangeEnd: parseInt(sehiriciEnd.value, 10),
    sehirdisiEnabled: sehirdisiToggle.checked,
    sehirdisiRangeStart: parseInt(sehirdisiStart.value, 10),
    sehirdisiRangeEnd: parseInt(sehirdisiEnd.value, 10)
  };
}

// Initialize App
async function init() {
  // 1. Generate or load persistent Client ID
  clientId = localStorage.getItem('taksi_client_id');
  if (!clientId) {
    clientId = 'client_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('taksi_client_id', clientId);
  }

  bindEvents();
  loadLocalSettings();
  
  // 2. Register subscription on the server if topic exists
  if (ntfyTopicInput.value.trim() !== '') {
    await sendSubscriptionToServer(false); // register silently without alert
  }

  startPolling();
}

// Bind UI Events
function bindEvents() {
  // Toggle controls disabled status when switch toggles
  sehiriciToggle.addEventListener('change', () => {
    if (sehiriciToggle.checked) {
      sehiriciRangeConfig.classList.remove('disabled');
      sehiriciStart.disabled = false;
      sehiriciEnd.disabled = false;
    } else {
      sehiriciRangeConfig.classList.add('disabled');
      sehiriciStart.disabled = true;
      sehiriciEnd.disabled = true;
    }
  });

  sehirdisiToggle.addEventListener('change', () => {
    if (sehirdisiToggle.checked) {
      sehirdisiRangeConfig.classList.remove('disabled');
      sehirdisiStart.disabled = false;
      sehirdisiEnd.disabled = false;
    } else {
      sehirdisiRangeConfig.classList.add('disabled');
      sehirdisiStart.disabled = true;
      sehirdisiEnd.disabled = true;
    }
  });

  // Save settings
  btnSaveSettings.addEventListener('click', () => sendSubscriptionToServer(true));

  // Test notification
  btnTestPush.addEventListener('click', sendTestPush);

  // Clear logs
  btnClearLogs.addEventListener('click', clearLogs);
}

// Load settings from localStorage
function loadLocalSettings() {
  try {
    const saved = localStorage.getItem('taksi_settings');
    if (saved) {
      const config = JSON.parse(saved);
      
      // Update UI fields
      ntfyTopicInput.value = config.ntfyTopic || '';
      
      sehiriciToggle.checked = config.sehiriciEnabled !== false;
      sehiriciStart.value = config.sehiriciRangeStart || 105;
      sehiriciEnd.value = config.sehiriciRangeEnd || 115;
      
      sehirdisiToggle.checked = config.sehirdisiEnabled === true;
      sehirdisiStart.value = config.sehirdisiRangeStart || 105;
      sehirdisiEnd.value = config.sehirdisiRangeEnd || 115;
      
      addLog('Yerel ayarlar tarayıcıdan yüklendi.', 'success');
    } else {
      // Set defaults if no saved settings
      sehiriciToggle.checked = true;
      sehiriciStart.value = 105;
      sehiriciEnd.value = 115;
      sehirdisiToggle.checked = false;
      sehirdisiStart.value = 105;
      sehirdisiEnd.value = 115;
      addLog('Varsayılan ayarlar yüklendi.', 'system');
    }
    
    // Trigger toggle updates
    sehiriciToggle.dispatchEvent(new Event('change'));
    sehirdisiToggle.dispatchEvent(new Event('change'));
  } catch (err) {
    addLog('Yerel ayarlar yüklenirken hata: ' + err.message, 'alarm');
  }
}

// Save settings to localStorage and register to server
async function sendSubscriptionToServer(showAlert = true) {
  const config = getClientConfig();

  if (config.sehiriciEnabled && (isNaN(config.sehiriciRangeStart) || isNaN(config.sehiriciRangeEnd))) {
    alert('Şehiriçi sıra aralığı sayısal değerler olmalıdır.');
    return;
  }
  
  if (config.sehirdisiEnabled && (isNaN(config.sehirdisiRangeStart) || isNaN(config.sehirdisiRangeEnd))) {
    alert('Şehirdışı sıra aralığı sayısal değerler olmalıdır.');
    return;
  }

  if (!config.ntfyTopic || config.ntfyTopic.trim() === '') {
    if (showAlert) alert('Lütfen bildirim göndermek için bir ntfy Konu Adı girin.');
    return;
  }

  if (showAlert) {
    btnSaveSettings.disabled = true;
    btnSaveSettings.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Alarm Kuruluyor...';
  }

  try {
    const res = await fetch('/taksi/api/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    const data = await res.json();
    if (data.success) {
      // Save locally to persistent store
      localStorage.setItem('taksi_settings', JSON.stringify(config));
      addLog(`Alarm ayarları güncellendi ve sunucu takibi başlatıldı (Topic: ${config.ntfyTopic}).`, 'success');
      if (showAlert) alert('Alarm başarıyla kuruldu! Sıra belirlediğiniz aralığa girdiğinde telefonunuza bildirim gönderilecektir.');
    } else {
      addLog('Sunucu kayıt hatası: ' + data.error, 'alarm');
      if (showAlert) alert('Hata: ' + data.error);
    }
  } catch (err) {
    addLog('Sunucu bağlantı hatası: ' + err.message, 'alarm');
    if (showAlert) alert('Bağlantı hatası: Sunucu ile iletişim kurulamadı.');
  } finally {
    if (showAlert) {
      btnSaveSettings.disabled = false;
      btnSaveSettings.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Alarmı Kur ve Takibi Başlat';
    }
  }
}

// Send test push notification
async function sendTestPush() {
  const topic = ntfyTopicInput.value.trim();
  if (!topic) {
    alert('Lütfen önce bir ntfy konu adı girin.');
    return;
  }

  btnTestPush.disabled = true;
  btnTestPush.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const res = await fetch('/taksi/api/test-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ topic })
    });
    const data = await res.json();
    if (data.success) {
      addLog(`[${topic}] kanalına test bildirimi gönderildi.`, 'success');
      alert('Telefonunuza test bildirimi gönderildi! Lütfen ntfy uygulamanızı kontrol edin.');
    } else {
      addLog('Test bildirimi hatası: ' + data.error, 'alarm');
      alert('Hata: ' + data.error);
    }
  } catch (err) {
    addLog('Test bildirimi gönderilirken bağlantı hatası: ' + err.message, 'alarm');
    alert('Bağlantı Hatası: ' + err.message);
  } finally {
    btnTestPush.disabled = false;
    btnTestPush.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Test Et';
  }
}

// Start polling for queue data
function startPolling() {
  let timeLeft = 5;
  
  async function poll() {
    try {
      updateCountdown.innerText = 'Güncelleniyor...';
      const res = await fetch('/taksi/api/queue');
      const result = await res.json();
      
      if (result.success && result.data) {
        processQueueData(result.data);
        updateConnectionStatus(true);
      } else {
        addLog('Sıra verisi çekilemedi: ' + (result.error || 'Bilinmeyen Hata'), 'alarm');
        updateConnectionStatus(false);
      }
    } catch (err) {
      addLog('Sıra verisi çekilirken bağlantı koptu: ' + err.message, 'alarm');
      updateConnectionStatus(false);
    }
    timeLeft = 10; // server checks every 10s, frontend polls every 10s
  }

  // Initial poll
  poll();

  // Countdown timer
  setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      poll();
    } else {
      updateCountdown.innerText = `${timeLeft} sn içinde güncellenecek`;
    }
  }, 1000);
}

// Process fetched queue data
function processQueueData(data) {
  const currentSehirici = parseInt(data.sehirici, 10);
  const currentSehirdisi = parseInt(data.sehirdisi, 10);
  const sehiriciDongu = parseInt(data.sehirici_dongu, 10) || 0;
  const sehirdisiDongu = parseInt(data.sehirdisi_dongu, 10) || 0;

  // Render values
  sehiriciVal.innerText = isNaN(currentSehirici) ? 'Sıra Yok' : currentSehirici;
  sehirdisiVal.innerText = isNaN(currentSehirdisi) ? 'Sıra Yok' : currentSehirdisi;
  
  duyuruVal.innerHTML = data.duyuru || '<p class="text-muted">Duyuru bulunmuyor.</p>';

  // Render badges
  setBadge('sehiriciBadge', sehiriciDongu);
  setBadge('sehirdisiBadge', sehirdisiDongu);

  // Read config from local fields to check ranges
  const config = getClientConfig();

  // Active styles based on UI configuration
  if (config.sehiriciEnabled) {
    sehiriciBox.classList.add('monitoring-active');
    // If inside range, trigger visual alarm
    if (currentSehirici >= config.sehiriciRangeStart && currentSehirici <= config.sehiriciRangeEnd) {
      sehiriciBox.classList.add('alarm-triggered');
    } else {
      sehiriciBox.classList.remove('alarm-triggered');
    }
  } else {
    sehiriciBox.classList.remove('monitoring-active', 'alarm-triggered');
  }

  if (config.sehirdisiEnabled) {
    sehirdisiBox.classList.add('monitoring-active');
    // If inside range, trigger visual alarm
    if (currentSehirdisi >= config.sehirdisiRangeStart && currentSehirdisi <= config.sehirdisiRangeEnd) {
      sehirdisiBox.classList.add('alarm-triggered');
    } else {
      sehirdisiBox.classList.remove('alarm-triggered');
    }
  } else {
    sehirdisiBox.classList.remove('monitoring-active', 'alarm-triggered');
  }

  // Detect and Log Changes
  let changeOccurred = false;

  // Şehiriçi change detection
  if (lastQueueData.sehirici !== null && !isNaN(currentSehirici)) {
    if (lastQueueData.sehirici !== currentSehirici || lastQueueData.sehiriciDongu !== sehiriciDongu) {
      const msg = `Şehiriçi sırası değişti: ${lastQueueData.sehirici} ➔ ${currentSehirici} (Döngü: ${sehiriciDongu})`;
      addLog(msg, 'change');
      changeOccurred = true;

      // Log if within range
      if (config.sehiriciEnabled && currentSehirici >= config.sehiriciRangeStart && currentSehirici <= config.sehiriciRangeEnd) {
        addLog(`🚨 BİLDİRİM: Şehiriçi sırası alarm aralığında! Telefonunuza push bildirimi gönderildi.`, 'alarm');
      }
    }
  }

  // Şehirdışı change detection
  if (lastQueueData.sehirdisi !== null && !isNaN(currentSehirdisi)) {
    if (lastQueueData.sehirdisi !== currentSehirdisi || lastQueueData.sehirdisiDongu !== sehirdisiDongu) {
      const msg = `Şehirdışı sırası değişti: ${lastQueueData.sehirdisi} ➔ ${currentSehirdisi} (Döngü: ${sehirdisiDongu})`;
      addLog(msg, 'change');
      changeOccurred = true;

      // Log if within range
      if (config.sehirdisiEnabled && currentSehirdisi >= config.sehirdisiRangeStart && currentSehirdisi <= config.sehirdisiRangeEnd) {
        addLog(`🚨 BİLDİRİM: Şehirdışı sırası alarm aralığında! Telefonunuza push bildirimi gönderildi.`, 'alarm');
      }
    }
  }

  // Update speed stats if change occurred
  if (changeOccurred) {
    const now = Date.now();
    changeTimestamps.push(now);
    
    // Keep only last 10 changes for running average
    if (changeTimestamps.length > 10) changeTimestamps.shift();
    
    calculateSpeed();
    
    // Increment total changes counter
    const currentTotal = parseInt(statTotal.innerText, 10) || 0;
    statTotal.innerText = currentTotal + 1;
  }

  // Update last seen data
  lastQueueData.sehirici = currentSehirici;
  lastQueueData.sehirdisi = currentSehirdisi;
  lastQueueData.sehiriciDongu = sehiriciDongu;
  lastQueueData.sehirdisiDongu = sehirdisiDongu;
}

// Set queue badge text
function setBadge(elementId, donguCount) {
  const el = document.getElementById(elementId);
  if (donguCount > 0) {
    el.innerHTML = `🔄 Sıra <strong style="color:inherit">${donguCount}</strong> kez döndü`;
  } else {
    el.innerHTML = `⏳ Bugün henüz dönmedi`;
  }
}

// Calculate queue advancement speed
function calculateSpeed() {
  if (changeTimestamps.length < 2) {
    statSpeed.innerText = 'Hesaplanıyor...';
    return;
  }

  let totalDiff = 0;
  for (let i = 1; i < changeTimestamps.length; i++) {
    totalDiff += (changeTimestamps[i] - changeTimestamps[i-1]);
  }
  
  const avgMs = totalDiff / (changeTimestamps.length - 1);
  const avgSeconds = Math.round(avgMs / 1000);
  
  if (avgSeconds >= 60) {
    const mins = Math.floor(avgSeconds / 60);
    const secs = avgSeconds % 60;
    statSpeed.innerText = `${mins} dk ${secs} sn / araç`;
  } else {
    statSpeed.innerText = `${avgSeconds} sn / araç`;
  }
}

// Update connection status badge
function updateConnectionStatus(isConnected) {
  if (isConnected) {
    connBadge.classList.remove('disconnected');
    connBadge.querySelector('.badge-text').innerText = 'Sunucu Bağlantısı Aktif';
  } else {
    connBadge.classList.add('disconnected');
    connBadge.querySelector('.badge-text').innerText = 'Bağlantı Kesildi!';
  }
}

// Add log entry to the window
function addLog(text, type = 'system') {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];
  
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `[${timeStr}] ${text}`;
  
  logWindow.appendChild(entry);
  logWindow.scrollTop = logWindow.scrollHeight;
  
  // Save in memory array
  queueLogs.push({ time: timeStr, text, type });
  if (queueLogs.length > 50) queueLogs.shift();
}

// Clear all logs
function clearLogs() {
  logWindow.innerHTML = '<div class="log-entry system">Log geçmişi temizlendi.</div>';
  queueLogs = [];
  changeTimestamps = [];
  statSpeed.innerText = 'Hesaplanıyor...';
  statTotal.innerText = '0';
}

// Run initialization
document.addEventListener('DOMContentLoaded', init);
