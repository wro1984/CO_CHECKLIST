// O mesmo número de versão em app.js, cripto.js, sw.js e nos ?v= do index.html (senão o celular fica com arquivos
// de versões diferentes no cache).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ler = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('versões iguais', () => {
  const app = ler('app.js').match(/APP_VERSION = '([^']+)'/)[1];
  assert.strictEqual(ler('cripto.js').match(/VERSAO = '([^']+)'/)[1], app);
  assert.strictEqual(ler('sw.js').match(/VERSION = '([^']+)'/)[1], app);
  assert.strictEqual(ler('push.js').match(/VERSAO = '([^']+)'/)[1], app);
  const vs = [...ler('index.html').matchAll(/\?v=([0-9.]+)/g)].map(m => m[1]);
  assert.ok(vs.length >= 7);
  vs.forEach(v => assert.strictEqual(v, app));
});

test('todo arquivo do app está no CORE do service worker', () => {
  const core = ler('sw.js');
  for (const f of ['index.html', 'app.js', 'cripto.js', 'logica.js', 'grafico.js', 'cartao.js', 'push.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'])
    assert.ok(core.includes(`'${f}'`), f);
  for (const f of ['config.js', 'cripto.js', 'logica.js', 'grafico.js', 'cartao.js', 'push.js', 'app.js']) assert.ok(ler('index.html').includes(`src="${f}?v=`), f);
});

test('nada carregado de fora e o endereço dos dados bate com a CSP', () => {
  const html = ler('index.html');
  assert.ok(!/(src|href)="https?:/.test(html));
  const csp = html.match(/connect-src ([^;]+);/)[1];
  const fora = csp.match(/https:\/\/[^ ]+/g) || [];
  const cfg = ler('config.js').match(/dados: '(https:\/\/[^/']+)\/[^']*'/);
  assert.ok(cfg, 'config.js sem o endereço dos dados');
  // fora do próprio endereço: o Worker dos dados (o mesmo do config.js) e a caixa de entrada dos avisos (a mesma do push.js)
  assert.deepStrictEqual(fora, [cfg[1], require('../push.js').CAIXA]);
  assert.match(ler('config.js'), /\/checklist\/'/);              // pasta deste app no Worker
  assert.match(html, /default-src 'self'/);
});

test('o service worker só mexe nos próprios caches', () => {
  const sw = ler('sw.js');
  assert.ok(sw.includes("k.startsWith('co-checklist-v')"));
  assert.ok(!/caches\.delete\(k\)/.test(sw.replace("keys.filter(k => k.startsWith('co-checklist-v') && k !== CACHE).map(k => caches.delete(k))", '')));
});

test('a credencial do HUB só é lida (nunca apagada, criada ou gravada)', () => {
  const c = ler('cripto.js'), a = ler('app.js');
  assert.ok(!a.includes('co-hub-acesso'));                                   // só o cripto.js toca no banco do HUB
  assert.ok(c.includes("indexedDB.open('co-hub-acesso', 1)"));
  assert.ok(c.includes("transaction('cred', 'readonly')"));
  assert.ok(!/deleteDatabase/.test(c + a));
  assert.ok(!/objectStore\([^)]*\)\.(put|add|delete|clear)\(/.test(c));
  // o único cache que o app apaga é a cópia cifrada dos próprios dados
  const apagados = [...a.matchAll(/caches\.delete\(([^)]*)\)/g)].map(m => m[1]);
  assert.deepStrictEqual(apagados, ['CACHE_DADOS']);
});
