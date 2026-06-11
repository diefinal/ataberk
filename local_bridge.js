require('dotenv').config();
const fs = require('fs');
const path = require('path');

const LIVE_SERVER = process.env.LIVE_SERVER_URL || 'https://ataberktasci.com.tr';
const TOKEN = process.env.ADMIN_PASSWORD || 'admin123';
const INTERVAL = 10000; // 10 seconds

console.log('===================================================');
console.log('  TAKSİ HİBRİT VERİ KÖPRÜSÜ ÇALIŞIYOR (YEREL PC)   ');
console.log('===================================================');
console.log(`  Hedef Sunucu : ${LIVE_SERVER}`);
console.log(`  Veri sıklığı : ${INTERVAL / 1000} saniye`);
console.log('---------------------------------------------------');

async function fetchQueueData() {
  const url = 'https://www.antalyaairporttaxi.net/sira/updateData.php';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.antalyaairporttaxi.net/sira/'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP status: ${res.status}`);
  }
  return await res.json();
}

async function pushDataToServer(data) {
  const url = `${LIVE_SERVER}/taksi/api/push-data`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token: TOKEN,
      data: data
    })
  });
  
  if (!res.ok) {
    throw new Error(`HTTP status: ${res.status}`);
  }
  return await res.json();
}

async function loop() {
  try {
    const data = await fetchQueueData();
    console.log(`[${new Date().toLocaleTimeString()}] Sıra çekildi -> Şehiriçi: ${data.sehirici}, Şehirdışı: ${data.sehirdisi}`);
    
    const resData = await pushDataToServer(data);
    if (resData.success) {
      console.log(`[BAŞARILI] Veri canlıya aktarıldı.`);
    } else {
      console.error(`[HATA] Sunucu veriyi reddetti:`, resData.error);
    }
  } catch (err) {
    console.error(`[HATA] Köprü hatası:`, err.message);
  }
  
  setTimeout(loop, INTERVAL);
}

// Start loop
loop();
