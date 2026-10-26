/* Service worker för lil'bakery Faktura: appen fungerar offline när den väl laddats en gång.
   Ändra VERSION när filerna ändras, så hämtar installerade appar den nya versionen. */
const VERSION = '2026-10-26.1';
const SHELL = 'faktura-shell-' + VERSION;
const FONTS = 'faktura-fonts';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './calc.js', './pdf.js', './sync.js', './import.js',
  './vendor/jspdf.umd.min.js', './vendor/jszip.min.js',
  './vendor/fonts/Nunito-Regular.ttf', './vendor/fonts/Nunito-ExtraBold.ttf', './vendor/fonts/Sacramento-Regular.ttf',
  './img/logo.png', './img/cupcake.png', './img/wordmark.png',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'
];
// Testerna och gamla Excel-filer ska aldrig hamna i cachen.
const NEVER_CACHE = /\/(tests|Resources)\//i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('faktura-') && k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Google-skriptet (Drive och e-post) går alltid direkt till nätet.
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('.googleusercontent.com')) return;
  if (url.origin === self.location.origin) {
    if (NEVER_CACHE.test(url.pathname)) return;
    event.respondWith(cacheFirst(req));
  } else if (url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (req.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || network;
}
