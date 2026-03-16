/**
 * CalmLedger Service Worker v2
 * Handles: offline caching, push notifications, notification scheduling
 */

const CACHE_NAME = 'calmledger-v5';
// Never cache index.html — always fetch fresh from network so deploys take effect immediately
const STATIC_ASSETS = ['/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always bypass SW for API calls, auth, and analytics
  if (url.includes('/api/') || url.includes('anthropic.com') || url.includes('supabase')) return;

  // Always fetch index.html fresh from network — never serve from cache
  // This ensures every deploy is picked up immediately without bumping SW version
  const isHtmlNav = e.request.mode === 'navigate' ||
    url.endsWith('/') || url.endsWith('/index.html') ||
    (!url.includes('.') && !url.includes('/api/'));
  if (isHtmlNav) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets (icons, manifest) — cache first
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});

// ── Notification schedule ──
let notifSchedule = null;
let scheduledTimers = [];

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATIONS') {
    notifSchedule = e.data.schedule;
    scheduledTimers.forEach(t => clearTimeout(t));
    scheduledTimers = [];
    setupDailyNotifications();
  }
  if (e.data?.type === 'LATE_NIGHT_ALERT') {
    showNotif('Late night detected 🌙', {
      body: "It's late. Tired traders sell at bottoms 3x more often. Consider closing your charts.",
      tag: 'late-night', data: { action: 'dashboard' }
    });
  }
});

function setupDailyNotifications() {
  if (!notifSchedule) return;
  const sched = [
    { cfg: notifSchedule.morningCheckin, tag: 'morning-checkin', action: 'checkin' },
    { cfg: notifSchedule.eveningReflect,  tag: 'evening-reflect', action: 'journal'  },
  ];
  sched.forEach(({ cfg, tag, action }) => {
    if (!cfg) return;
    const ms = msUntilNext(cfg.hour, cfg.minute);
    const t = setTimeout(() => {
      showNotif(cfg.title, { body: cfg.body, tag, data: { action } });
      const daily = setTimeout(() => setupDailyNotifications(), 86400000);
      scheduledTimers.push(daily);
    }, ms);
    scheduledTimers.push(t);
  });
  if (notifSchedule.weeklyReport) {
    const cfg = notifSchedule.weeklyReport;
    const ms = msUntilNextWeekday(0, cfg.hour, cfg.minute);
    const t = setTimeout(() => showNotif(cfg.title, { body: cfg.body, tag: 'weekly', data: { action: 'progress' } }), ms);
    scheduledTimers.push(t);
  }
}

function showNotif(title, opts = {}) {
  return self.registration.showNotification(title, {
    icon: '/icon-192.png', badge: '/icon-192.png',
    vibrate: [100, 50, 100], ...opts
  });
}

function msUntilNext(hour, minute) {
  const now = new Date(), t = new Date();
  t.setHours(hour, minute, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t - now;
}

function msUntilNextWeekday(day, hour, minute) {
  const now = new Date(), t = new Date();
  t.setHours(hour, minute, 0, 0);
  const ahead = (day - now.getDay() + 7) % 7 || 7;
  t.setDate(t.getDate() + ahead);
  return t - now;
}

self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const p = e.data.json();
    e.waitUntil(showNotif(p.title || 'CalmLedger', { body: p.body || '', tag: p.tag, data: p.data }));
  } catch { e.waitUntil(showNotif('CalmLedger', { body: e.data.text() })); }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.notification.data?.action;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.postMessage({ type: 'NOTIFICATION_CLICK', action }); return; }
      return clients.openWindow('/');
    })
  );
});