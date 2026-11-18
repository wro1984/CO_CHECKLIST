// Modo MAPI (?mapi): o app aberto dentro do "HUB de Apps" do MAPI recebe os dados por mensagem, sem login do HUB, sem baixar o
// dados.json e sem service worker. Confere o código (o desenho em si é o mesmo das outras áreas).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('só entra no modo MAPI dentro de um quadro e com ?mapi na URL', () => {
  assert.match(app, /const MODO_MAPI = window\.parent !== window && new URLSearchParams\(location\.search\)\.has\('mapi'\)/);
});

test('no modo MAPI não lê a credencial do HUB nem baixa o dados.json', () => {
  const carregar = app.slice(app.indexOf('async function carregar()'));
  const antes = carregar.slice(0, carregar.indexOf('cred = await K.lerCredHub()'));
  assert.match(antes, /if \(MODO_MAPI\) return pedirAoMapi\(\)/);              // sai antes de tocar na credencial
});

test('só aceita a mensagem da janela pai e só do tipo certo', () => {
  const f = app.slice(app.indexOf('function receberDoMapi'), app.indexOf('async function carregar()'));
  assert.match(f, /e\.source !== window\.parent/);
  assert.match(f, /e\.data\.tipo !== 'co-checklist:dados'/);
  assert.match(f, /d\.v !== 1/);                                               // formato desconhecido: não desenha
});

test('o pedido ao MAPI leva só o aviso, sem dado algum', () => {
  const f = app.slice(app.indexOf('function pedirAoMapi'), app.indexOf('function receberDoMapi'));
  assert.match(f, /postMessage\(\{ tipo: 'co-checklist:pronto', versao: APP_VERSION \}, '\*'\)/);
  assert.ok(!/dados|cred|matricula/i.test(f.match(/postMessage\([^)]*\)/)[0].replace('co-checklist:pronto', '')));
});

test('no modo MAPI não registra service worker nem mostra o botão do HUB', () => {
  assert.match(app, /if \(!MODO_MAPI && 'serviceWorker' in navigator\)/);
  assert.match(app, /if \(MODO_MAPI\) \{ \$\('btHub'\)\.hidden = true; window\.addEventListener\('message', receberDoMapi\); \}/);
});

test('os dados do MAPI não vão para o aparelho (sem cache, sem armazenamento)', () => {
  const f = app.slice(app.indexOf('function receberDoMapi'), app.indexOf('async function carregar()'));
  assert.ok(!/caches|localStorage|indexedDB|\.put\(/.test(f));
});
