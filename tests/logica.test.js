const test = require('node:test');
const assert = require('node:assert');
const L = require('../logica.js');

const d = (hhmm, extra) => Object.assign({ coletado_em: `2026-11-12T${hhmm}:00-03:00`, limite_atraso_s: 900,
  programacao: { ativo: true, intervalo_min: 5, hora_inicio: '00:00', hora_fim: '23:59' } }, extra);
// "agora" em hora local do aparelho: monta a data local equivalente
const local = (h, m) => new Date(2026, 10, 12, h, m, 0);
const coletaLocal = (h, m, extra) => Object.assign({ coletado_em: new Date(2026, 10, 12, h, m).toISOString(), limite_atraso_s: 900,
  programacao: { ativo: true, intervalo_min: 5, hora_inicio: '00:00', hora_fim: '23:59' } }, extra);

test('coleta recente é normal', () => {
  const s = L.situacao(coletaLocal(15, 5), local(15, 8));
  assert.strictEqual(s.nivel, 'ok');
  assert.strictEqual(s.idade_min, 3);
});

test('atrasada passa do limite que o MAPI mandou', () => {
  assert.strictEqual(L.situacao(coletaLocal(15, 5), local(15, 20)).nivel, 'ok');            // 15 min = no limite
  const s = L.situacao(coletaLocal(15, 5), local(15, 21));
  assert.strictEqual(s.nivel, 'atraso');
  assert.match(s.texto, /há 16 min/);
});

test('sem limite no pacote usa 15 min', () => {
  const x = coletaLocal(15, 5); delete x.limite_atraso_s;
  assert.strictEqual(L.situacao(x, local(15, 19)).nivel, 'ok');
  assert.strictEqual(L.situacao(x, local(15, 25)).nivel, 'atraso');
});

test('coleta desligada ou fora da janela não é atraso', () => {
  const desl = coletaLocal(15, 5, { programacao: { ativo: false, intervalo_min: 5, hora_inicio: '00:00', hora_fim: '23:59' } });
  assert.strictEqual(L.situacao(desl, local(20, 0)).nivel, 'info');
  assert.match(L.situacao(desl, local(20, 0)).texto, /desligada/);
  const jan = coletaLocal(21, 55, { programacao: { ativo: true, intervalo_min: 5, hora_inicio: '07:00', hora_fim: '22:00' } });
  const noite = L.situacao(jan, local(23, 30));
  assert.strictEqual(noite.nivel, 'info');
  assert.match(noite.texto, /07:00–22:00/);
});

test('janela que passa da meia-noite', () => {
  const p = { ativo: true, hora_inicio: '22:00', hora_fim: '06:00' };
  assert.ok(L.naJanela(p, local(23, 0)));
  assert.ok(L.naJanela(p, local(2, 0)));
  assert.ok(!L.naJanela(p, local(12, 0)));
});

test('sem data da coleta: aviso de atraso, sem quebrar', () => {
  const s = L.situacao({ programacao: { ativo: true, hora_inicio: '00:00', hora_fim: '23:59' } }, local(10, 0));
  assert.strictEqual(s.nivel, 'atraso');
  assert.strictEqual(s.idade_min, null);
});

test('frentes: sem o total, na ordem das frentes e depois pelo maior valor', () => {
  const r = L.frentes({ TOTAL: 100, MAGIC: 20, OUTRA_X: 5, TRIAGEM: 2, OUTRA_Y: 9, MANOBRA: 12 });
  assert.deepStrictEqual(r.map(x => x[0]), ['TRIAGEM', 'MANOBRA', 'MAGIC', 'OUTRA_Y', 'OUTRA_X']);
  assert.deepStrictEqual(L.frentes(null), []);
});

test('nomes das frentes', () => {
  assert.strictEqual(L.nomeFrente('CO_SISTEMICO'), 'CO sistêmico');
  assert.strictEqual(L.nomeFrente('TEL_ICOMON'), 'TEL');
  assert.strictEqual(L.nomeFrente('NOVA_FRENTE'), 'Nova frente');
});

test('resumo de acertos e erros', () => {
  const r = L.resumoSerie([['a', 8, 2], ['b', 1, 0], ['c', null, 1]]);
  assert.deepStrictEqual(r, { acertos: 9, erros: 3, total: 12, pct: 75 });
  assert.strictEqual(L.resumoSerie([]).pct, null);
  assert.strictEqual(L.resumoSerie(null).total, 0);
});

test('níveis de uso e formatos', () => {
  assert.deepStrictEqual([null, 10, 69.9, 70, 89.9, 90, 100].map(L.nivelUso), ['nd', 'ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  assert.strictEqual(L.fmtDuracao(1728000), '20 d 0 h');
  assert.strictEqual(L.fmtDuracao(3660), '1 h 1 min');
  assert.strictEqual(L.fmtDuracao(120), '2 min');
  assert.strictEqual(L.fmtBytes(16867405824), '15,7 GB');
  assert.strictEqual(L.fmtBytes(512), '512 B');
  assert.strictEqual(L.fmtBytes(null), '—');
});
