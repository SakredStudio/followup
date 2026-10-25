// Cache-first shell: installed phones only pick up a new release when this name changes. BUMP ON EVERY DEPLOY.
const CACHE_NAME = 'followup-buddy-v4';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './i18n/en.json',
  './i18n/hi.json',
  './i18n/hinglish.json',
  './lib/i18n.js',
  './lib/billing.js',
  './lib/format.js',
  './lib/phone.js',
  './lib/seed.js',
  './lib/store.js',
  './lib/categorize.js',
  './lib/channels.js',
  './lib/notify.js',
  './lib/pipeline.js',
  './lib/stats.js',
  './lib/templates.js',
  './lib/share-target.js',
  './lib/snooze.js',
  './lib/festivals.js',
  './lib/catalogue.js',
  './lib/photos.js',
  './lib/cloud.js',
  './lib/merge.js',
  './fonts/fonts.css',
  './fonts/JetBrainsMono-400-latin.woff2',
  './fonts/JetBrainsMono-400-latin-ext.woff2',
  './fonts/JetBrainsMono-500-latin.woff2',
  './fonts/JetBrainsMono-500-latin-ext.woff2',
  './fonts/PlusJakartaSans-400-latin.woff2',
  './fonts/PlusJakartaSans-400-latin-ext.woff2',
  './fonts/PlusJakartaSans-500-latin.woff2',
  './fonts/PlusJakartaSans-500-latin-ext.woff2',
  './fonts/PlusJakartaSans-600-latin.woff2',
  './fonts/PlusJakartaSans-600-latin-ext.woff2',
  './fonts/PlusJakartaSans-700-latin.woff2',
  './fonts/PlusJakartaSans-700-latin-ext.woff2',
  './fonts/PlusJakartaSans-800-latin.woff2',
  './fonts/PlusJakartaSans-800-latin-ext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Daily digest via Periodic Background Sync (installed Chromium/TWA only). The SW cannot read
// localStorage, so app.js writes a tiny counts snapshot into the 'fub-digest' cache on every change.
const DIGEST_CACHE = 'fub-digest';
const DIGEST_URL = '/__fub_digest.json';
const DIGEST_TEXT = {
  en: { title: (n) => (n === 1 ? '1 lead to follow up today ☀️' : `${n} leads to follow up today ☀️`), overdue: (n) => `${n} overdue`, more: (n) => `+${n} more` },
  hi: { title: (n) => `आज ${n} लीड्स को फ़ॉलो-अप करना है ☀️`, overdue: (n) => `${n} बकाया`, more: (n) => `+${n} और` },
  hinglish: { title: (n) => `Aaj ${n} leads ko follow-up karna hai ☀️`, overdue: (n) => `${n} overdue`, more: (n) => `+${n} aur` }
};

async function showDigestNotification() {
  const cache = await caches.open(DIGEST_CACHE);
  const res = await cache.match(DIGEST_URL);
  if (!res) return;
  const snap = await res.json();
  const total = Number(snap.todayCount || 0) + Number(snap.overdueCount || 0);
  if (total === 0) return;
  const L = DIGEST_TEXT[snap.lang] || DIGEST_TEXT.en;
  const names = Array.isArray(snap.names) ? snap.names : [];
  const extra = total > names.length && names.length > 0 ? ` ${L.more(total - names.length)}` : '';
  const parts = [];
  if (names.length) parts.push(`${names.join(' · ')}${extra}`);
  if (Number(snap.overdueCount) > 0) parts.push(`⚠ ${L.overdue(Number(snap.overdueCount))}`);
  await self.registration.showNotification(L.title(total), {
    body: parts.join(' · '),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'daily-digest',
    renotify: true,
    data: { url: './' }
  });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'daily-digest') return;
  // Only speak during the day: quiet hours (default 21:00–09:00) are enforced by the snapshot's
  // `quiet` field, mirrored from Settings.
  event.waitUntil(
    (async () => {
      const hour = new Date().getHours();
      const cache = await caches.open(DIGEST_CACHE);
      const res = await cache.match(DIGEST_URL);
      const snap = res ? await res.json() : null;
      const q = (snap && snap.quiet) || { start: 21, end: 9 };
      const quiet = q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
      if (quiet) return;
      await showDigestNotification();
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
