/* =======================================================================
   DOGINARY — SERVICE WORKER
   -----------------------------------------------------------------------
   Strategi:
   - App-skal (HTML/CSS/JS/ikoner/typsnitt): cache-first, med nätverket
     som fallback och tyst bakgrundsuppdatering av cachen (stale-while-
     revalidate) så att en ändrad fil ändå plockas upp inom kort.
   - Sidnavigering (HTML): network-first, så du alltid får senaste
     versionen av sidan när du har nät — med cache som fallback, och
     offline.html som sista utväg om inget av det finns.
   - Data/API (Supabase, SMHI, Open-Meteo m.fl.): network-only/
     network-first. Väder- och kontodata ska ALDRIG serveras inaktuell
     från cache som om den vore aktuell — men vi cachar ändå det senaste
     lyckade svaret som en ren offline-reserv, tydligt bara som sådan.

   Versionshantering: höj CACHE_VERSION vid varje release som ändrar
   någon cachad fil. Gamla cachar städas bort i "activate".
   ======================================================================= */

const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `doginary-shell-${CACHE_VERSION}`;
const DATA_CACHE = `doginary-data-${CACHE_VERSION}`;
const CURRENT_CACHES = [APP_SHELL_CACHE, DATA_CACHE];

// Appens "skal" — sidorna + delade CSS/JS-filer + ikoner. Lägg till nya
// sidor/filer här när de tillkommer.
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/logga.html',
  '/insikter.html',
  '/guidelines.html',
  '/health.html',
  '/offline.html',
  '/styles.css',
  '/app.js',
  '/doginary-auth.js',
  '/doginary-auth-ui.css',
  '/doginary-data.js',
  '/pwa.js',
  '/manifest.json',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/icon-144.png',
  '/icons/icon-152.png',
  '/icons/icon-192.png',
  '/icons/icon-384.png',
  '/icons/icon-512.png',
  '/icons/icon-192-maskable.png',
  '/icons/icon-512-maskable.png',
  '/icons/apple-touch-icon.png',
  '/assets/icon.png',
  '/assets/preview.jpg',
  '/assets/title-doginary.png',
  '/assets/title-doginary-blue.png'
];

// Domäner vars anrop ALDRIG ska cache-first:as (data som måste vara
// färsk — konto/auth och väderdata).
const NETWORK_FIRST_HOSTS = [
  'supabase.co',
  'supabase.in',
  'api.open-meteo.com',
  'opendata-download-metfcst.smhi.se',
  'opendata.smhi.se'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_FILES.map(url => new Request(url, { cache: 'reload' }))))
      .catch(err => console.warn('[SW] Kunde inte förcacha hela app-skalet:', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => !CURRENT_CACHES.includes(key)).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Tillåter sidan att be en väntande service worker aktivera sig direkt
// (för en "Ny version tillgänglig — uppdatera"-banner, se pwa.js).
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

function isDataHost(url) {
  return NETWORK_FIRST_HOSTS.some(host => url.hostname.endsWith(host));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST/PATCH (t.ex. Supabase-writes) rör vi inte
  const url = new URL(req.url);

  // 1. Sidnavigering (HTML) — network-first med offline.html som sista fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(APP_SHELL_CACHE).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then(cached => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // 2. Data-API:er (Supabase/väder) — network-first, cache bara som
  // ren offline-reserv (används aldrig om nätverket svarar).
  if (isDataHost(url)) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then(cache => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3. Övriga same-origin statiska filer (CSS/JS/bilder/typsnitt) —
  // cache-first + stale-while-revalidate i bakgrunden.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(APP_SHELL_CACHE).then(cache => cache.put(req, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // 4. Tredjeparts-tillgångar (typsnitt från CDN m.m.) — cache-first,
  // nätverk som fallback, men skriv inte till cache om svaret är opakt
  // och vi inte kan avgöra att det lyckades.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(res => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(APP_SHELL_CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});

/* =======================================================================
   PUSH NOTIFICATIONS — förberedelse, skickar INGA notiser ännu.
   Redo för framtida funktioner: vaccinationspåminnelser, medicin-
   påminnelser, vädervarningar, promenadpåminnelser. Aktiveras genom att
   koppla på en riktig push-backend (t.ex. Supabase Edge Function + VAPID)
   och faktiskt anropa pushManager.subscribe() någonstans i appen — se
   requestNotificationPermission()/registerPushSubscription() i pwa.js.
   ======================================================================= */
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch (e) { payload = { title: 'Doginary', body: event.data.text() }; }

  const title = payload.title || 'Doginary';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    data: payload.data || {},
    tag: payload.tag || 'doginary-generic'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
