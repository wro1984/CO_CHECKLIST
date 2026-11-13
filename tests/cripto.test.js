// Abre o pacote cifrado pelo MAPI (checklist_app.montar_pacote, tests/fixtures/pacote.json, dados inventados) com a
// credencial como o HUB guarda no aparelho (CryptoKey não extraível derivada da chave com o salt do HUB).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const K = require('../cripto.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
const S = crypto.subtle, enc = new TextEncoder();
const norm = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();   // normCodigo do HUB

async function credDoHub(chave = fx.hub.chave, salt = fx.hub.salt, mat = fx.hub.matricula) {
  const base = await S.importKey('raw', enc.encode(norm(chave)), 'PBKDF2', false, ['deriveKey']);
  const k = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(fx.hub.salt, 'base64'), iterations: fx.hub.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const id = Buffer.from(await S.digest('SHA-256', enc.encode('hub:' + mat))).toString('hex');
  return { id, matricula: mat, chave: k, salt };
}

test('abre os KPIs com a credencial do HUB', async () => {
  const r = await K.abrir(fx.pacote, await credDoHub());
  assert.deepStrictEqual(r, fx.esperado);
  assert.deepStrictEqual(Object.keys(r.fila), ['aguardando', 'executando']);
  assert.ok(Object.keys(r.series).length >= 7);
  assert.strictEqual(r.acompanhamento.colunas.length, r.acompanhamento.linhas[0].length);
  assert.strictEqual(r.programacao.intervalo_min, 5);
  assert.strictEqual(r.limite_atraso_s, 900);
});

test('a chave digitada de outro jeito no HUB dá a mesma credencial', async () => {
  const r = await K.abrir(fx.pacote, await credDoHub('LAGO VENTO PEDRA'));
  assert.strictEqual(r.fila.executando, fx.esperado.fila.executando);
});

test('sem o app no perfil, chave trocada ou errada: sem_acesso', async () => {
  const outra = await K.abrir(fx.pacote, await credDoHub(fx.hub.chave, fx.hub.salt, 'B0002')).catch(e => e);
  assert.strictEqual(outra.code, 'sem_acesso');
  assert.match(outra.message, /perfil no HUB/);
  const salt = await K.abrir(fx.pacote, await credDoHub(fx.hub.chave, 'b3V0cm8tc2FsdC0xNmJ5dA==')).catch(e => e);
  assert.strictEqual(salt.code, 'sem_acesso');
  assert.match(salt.message, /trocada/);
  const errada = await K.abrir(fx.pacote, await credDoHub('outra-chave')).catch(e => e);
  assert.strictEqual(errada.code, 'sem_acesso');
});

test('pacote sem ninguém (hub vazio) não abre', async () => {
  const vazio = JSON.parse(JSON.stringify(fx.pacote)); vazio.hub = { acessos: {} };
  assert.strictEqual((await K.abrir(vazio, await credDoHub()).catch(e => e)).code, 'sem_acesso');
});

test('formato desconhecido e dados adulterados são recusados', async () => {
  const outroApp = Object.assign({}, fx.pacote, { app: 'co-coe' });
  assert.strictEqual((await K.abrir(outroApp, await credDoHub()).catch(e => e)).code, 'formato');
  const adulterado = JSON.parse(JSON.stringify(fx.pacote));
  adulterado.dados.ct = Buffer.from('x'.repeat(40)).toString('base64');
  assert.strictEqual((await K.abrir(adulterado, await credDoHub()).catch(e => e)).code, 'corrompido');
});

test('nada aberto no arquivo público', () => {
  const pub = JSON.stringify(fx.pacote);
  for (const t of ['VIVO', 'TRIAGEM', 'MAGIC', 'executando', '8375', fx.hub.matricula]) assert.ok(!pub.includes(t), t);
});
