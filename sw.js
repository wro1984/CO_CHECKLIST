/* Checklist VLAN — service worker (escopo /CO_CHECKLIST/).
 * Outros apps moram no mesmo endereço (wro1984.github.io): este só mexe nos caches que começam com "co-checklist-v".
 * O dados.json NÃO passa por aqui: vem do Worker da Cloudflare (outro endereço) e o app guarda a cópia cifrada sozinho. */
const VERSION = '1.1.0';
const CACHE = 'co-checklist-v' + VERSION;
const CORE = ['./', 'index.html', 'app.js', 'cripto.js', 'logica.js', 'grafico.js', 'cartao.js', 'push.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

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
// Aviso do MAPI (push), mesmo com o app fechado: {t: título, b: texto, tag: agrupa/atualiza, u: endereço ao tocar}.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { b: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.t || 'Checklist VLAN'), {
    body: String(d.b || ''), tag: String(d.tag || 'ck-push'), renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { u: './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const escopo = self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if (c.url.startsWith(escopo) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(escopo);
  }));
});
