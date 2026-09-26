// Service worker della PWA: rende il sito installabile e utilizzabile offline
// per la parte statica (pagine, stile, icone). I dati Garmin/Withings in
// data/*.json restano invece "network-first" -- l'obiettivo del sito e'
// mostrare dati live, quindi la cache li serve solo se sei offline.
const SHELL_CACHE = 'piano-shell-v1';
const DATA_CACHE = 'piano-data-v1';

const SHELL_ASSETS = [
  '/index.html', '/corsa.html', '/nuoto.html', '/palestra.html',
  '/nutrizione.html', '/peso.html', '/callback.html', '/editor.html',
  '/style.css', '/nav.js', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-512-maskable.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POST (es. refresh-sync.php) passa dritto alla rete

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/data/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Shell statico: risposta immediata dalla cache se c'e', con aggiornamento
  // in background ad ogni richiesta (stale-while-revalidate) cosi' un
  // deploy nuovo si vede dalla visita successiva senza dover versionare
  // manualmente la cache ad ogni modifica.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
