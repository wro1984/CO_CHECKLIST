// Aviso no celular: o segredo de aviso abre de `tk` com a credencial do HUB, e a prova (HMAC com prefixo "coe") é a
// mesma que o MAPI calcula (checklist_app.mac_inscricao). Dados de tests/fixtures/pacote.json (inventados).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.atob) globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
const K = require('../cripto.js');
const P = require('../push.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
const S = crypto.subtle, enc = new TextEncoder();
const norm = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

async function credDoHub(mat = fx.hub.matricula) {
  const base = await S.importKey('raw', enc.encode(norm(fx.hub.chave)), 'PBKDF2', false, ['deriveKey']);
  const k = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(fx.hub.salt, 'base64'), iterations: fx.hub.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const id = Buffer.from(await S.digest('SHA-256', enc.encode('hub:' + mat))).toString('hex');
  return { id, matricula: mat, chave: k, salt: fx.hub.salt };
}

test('o segredo de aviso e a chave pública saem do pacote', async () => {
  const x = await K.extrasPush(fx.pacote, await credDoHub());
  assert.strictEqual(x.chave, fx.push.chave);
  assert.strictEqual(Buffer.from(x.segredo).toString('base64'), fx.push.segredo);
  const outra = await K.extrasPush(fx.pacote, await credDoHub('B0002'));
  assert.strictEqual(outra.segredo, null);
  const sem = await K.extrasPush(Object.assign({}, fx.pacote, { push: undefined }), await credDoHub());
  assert.strictEqual(sem.chave, null);
});

test('a prova da inscrição é a mesma do MAPI (prefixo checklist)', async () => {
  const i = fx.push.inscricao, seg = Buffer.from(fx.push.segredo, 'base64');
  assert.strictEqual(await P.macInscricao(seg, i.endpoint, i.p256dh, i.auth), fx.push.mac);
});

test('registrar entrega à caixa e não repete a mesma inscrição', async () => {
  const cred = await credDoHub(), seg = Buffer.from(fx.push.segredo, 'base64');
  const sub = { options: {}, toJSON: () => ({ endpoint: fx.push.inscricao.endpoint, keys: { p256dh: fx.push.inscricao.p256dh, auth: fx.push.inscricao.auth } }) };
  const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
  const enviados = [];
  P._fetch = async (url, op) => { enviados.push([url, JSON.parse(op.body)]); return { ok: true, status: 202 }; };
  const marca = await P.registrar({ reg, chave: fx.push.chave, segredo: seg, cred });
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0][0], P.CAIXA + '/push/inscrever');
  assert.deepStrictEqual(enviados[0][1], { id: cred.id, endpoint: fx.push.inscricao.endpoint, p256dh: fx.push.inscricao.p256dh,
    auth: fx.push.inscricao.auth, mac: fx.push.mac });
  await P.registrar({ reg, chave: fx.push.chave, segredo: seg, cred, guardado: marca });
  assert.strictEqual(enviados.length, 1);
  P._fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(P.registrar({ reg, chave: fx.push.chave, segredo: seg, cred, forcar: true }), /429/);
  P._fetch = null;
});

test('sem segredo ou chave, sem sino', () => {
  assert.strictEqual(P.disponivel(null), false);
  assert.strictEqual(P.disponivel({ chave: 'x', segredo: null }), false);
});
