const fs = require('fs');
const path = require('path');

let activeSubscriptions = [];

// Load subscriptions from JSON file to survive server restarts
const SUBS_FILE = path.join(__dirname, '../taksi-subscriptions.json');
if (fs.existsSync(SUBS_FILE)) {
  try {
    activeSubscriptions = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf-8'));
    console.log(`Loaded ${activeSubscriptions.length} taxi subscriptions.`);
  } catch (err) {
    console.error('Error loading subscriptions:', err.message);
  }
}

function saveSubscriptions() {
  try {
    fs.writeFileSync(SUBS_FILE, JSON.stringify(module.exports.activeSubscriptions, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving subscriptions:', err.message);
  }
}

// Clean up expired subscriptions (no updates for 12 hours)
function cleanExpiredSubscriptions() {
  const now = Date.now();
  const twelveHours = 12 * 60 * 60 * 1000;
  const initialCount = module.exports.activeSubscriptions.length;
  module.exports.activeSubscriptions = module.exports.activeSubscriptions.filter(sub => (now - sub.lastUpdated) < twelveHours);
  if (module.exports.activeSubscriptions.length !== initialCount) {
    console.log(`Cleaned up ${initialCount - module.exports.activeSubscriptions.length} expired taxi subscriptions.`);
    saveSubscriptions();
  }
}

// Run cleanup every hour
setInterval(cleanExpiredSubscriptions, 60 * 60 * 1000);

async function fetchQueueData() {
  const url = 'https://www.antalyaairporttaxi.net/sira/updateData.php';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://www.antalyaairporttaxi.net/sira/'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP error! status: ${res.status}`);
  }
  return await res.json();
}

async function sendPushNotification(topic, message, title = 'Taksi Sıra Takip', tags = 'taxi,warning') {
  if (!topic || topic.trim() === '') return;
  const url = `https://ntfy.sh/${topic.trim()}`;
  const encodedTitle = '=?utf-8?B?' + Buffer.from(title).toString('base64') + '?=';
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: message,
      headers: {
        'Title': encodedTitle,
        'Priority': '5',
        'Tags': tags,
        'Click': 'https://www.antalyaairporttaxi.net/sira/',
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
    console.log(`Push notification sent to [${topic}]. Status: ${res.status}`);
  } catch (err) {
    console.error(`Error sending push notification to [${topic}]:`, err.message);
  }
}

module.exports = {
  activeSubscriptions,
  saveSubscriptions,
  fetchQueueData,
  sendPushNotification,
  latestQueueData: null,
  lastSeenState: {
    sehirici: { number: null, dongu: null },
    sehirdisi: { number: null, dongu: null }
  }
};
