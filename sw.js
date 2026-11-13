/* Checklist VLAN — service worker (escopo /CO_CHECKLIST/).
 * Outros apps moram no mesmo endereço (wro1984.github.io): este só mexe nos caches que começam com "co-checklist-v".
 * O dados.json NÃO passa por aqui: vem do Worker da Cloudflare (outro endereço) e o app guarda a cópia cifrada sozinho. */
const VERSION = '1.0.0';
const CACHE = 'co-checklist-v' + VERSION;
const CORE = ['./', 'index.html', 'app.js', 'cripto.js', 'logica.js', 'grafico.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('co-checklist-v') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const escopo = new URL(self.registration.scope).pathname;
  if (e.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(escopo)) return;
  // rede primeiro (o app sempre atualizado); sem rede, a última cópia
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true, cacheName: CACHE })
    .then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html', { cacheName: CACHE }) : Response.error()))));
});
