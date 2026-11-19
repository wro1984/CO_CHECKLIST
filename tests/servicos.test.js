// Contas das abas Manobra (hoje) e Magic (servicos.js). Números inventados.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../servicos.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8')).esperado;

const M = { v: 1, dia: '2026-11-12', gerado_em: '2026-11-12T15:05:00', corte_min: 5, h: [100, 90, 60], r: [300, 300, 290],
  espera_media_s: { h: 120, r: 4 }, pendentes: { h: 2, r: 1 }, espera_max_s: { h: 300, r: 20 },
  serie: [['09:00', 5, 5, 4, 20, 20, 20], ['09:15', 0, 0, 0, 30, 30, 29]] };

test('manobra: humano, robô e os dois juntos', () => {
  const x = S.manobra(M);
  assert.deepStrictEqual([x.h.vol, x.h.at, x.h.cor], [100, 90, 60]);
  assert.deepStrictEqual([x.t.vol, x.t.at, x.t.cor], [400, 390, 350]);        // total = humano + robô
  assert.strictEqual(x.h.ns, 60 / 90);
  assert.strictEqual(x.r.ns, 290 / 300);
  assert.strictEqual(x.t.ns, 350 / 390);                                      // NS do total: soma dos dois, não média dos NS
  assert.deepStrictEqual([x.partes.h, x.partes.r], [0.25, 0.75]);
  assert.strictEqual(x.corte, 5);
});

test('manobra: sem atendidas não há NS, sem solicitações não há participação', () => {
  const x = S.manobra({ h: [3, 0, 0], r: [0, 0, 0] });
  assert.strictEqual(x.h.ns, null);
  assert.strictEqual(x.r.ns, null);
  assert.strictEqual(S.manobra({ h: [0, 0, 0], r: [0, 0, 0] }).partes.h, null);
  assert.strictEqual(S.manobra(null), null);
  assert.strictEqual(S.manobra({ h: [1, 1, 1] }), null);
});

test('manobra: pontos do gráfico (humano, robô por bloco) e o dado é de hoje?', () => {
  assert.deepStrictEqual(S.manobraPontos(M), [['2026-11-12T09:00', 5, 20], ['2026-11-12T09:15', 0, 30]]);
  assert.deepStrictEqual(S.manobraPontos(null), []);
  assert.strictEqual(S.ehDeHoje(M, '2026-11-12'), true);
  assert.strictEqual(S.ehDeHoje(M, '2026-11-13'), false);
});

test('robô na manobra: porcentagens por dia, o dia de hoje e o filtro de dias', () => {
  const m = { dia: '2026-11-19', robo: [{ dia: '2026-11-19', total: 562, robo: 328, realizadas: 158 }, { dia: '2026-11-18', total: 1280, robo: 663, realizadas: 304 }, { dia: '2026-11-15', total: 0, robo: 0, realizadas: 0 }] };
  const r = S.robo(m);
  assert.strictEqual(r.dias.length, 3);
  assert.ok(Math.abs(r.hoje.pctRobo - 328 / 562) < 1e-12);                  // % ações do robô
  assert.ok(Math.abs(r.hoje.pctManobras - 158 / 562) < 1e-12);              // % manobras (realizadas pelo robô ÷ total)
  assert.ok(Math.abs(r.hoje.resolve - 158 / 328) < 1e-12);                  // resolveu sozinho
  assert.strictEqual(r.dias[2].pctRobo, null);                              // dia sem tratativa: sem porcentagem
  assert.deepStrictEqual(S.robo(m, 2).dias.map(d => d.dia), ['2026-11-19', '2026-11-18']);   // filtro: os N dias mais novos
  assert.strictEqual(S.robo(m, 2).disponiveis, 3);
  assert.strictEqual(S.robo({ dia: 'x', robo: [{ dia: 'y', total: 1, robo: 1, realizadas: 1 }] }).hoje, null);   // sem o dia de hoje na lista
  assert.strictEqual(S.robo({}), null);
  assert.strictEqual(S.robo({ robo: null }), null);                         // a consulta falhou no MAPI: o app avisa
  assert.strictEqual(S.robo(null), null);
});

const H = { HOJE: { A: [[0, 5], [1, 5], [10, 7]], B: [[1, 1]] }, D7: { A: [[0, 4], [1, 4], [2, 4], [50, 9]], B: [[1, 2]] }, D14: { A: [[0, 1]] } };

test('magic: categorias e vetores de 96 blocos', () => {
  assert.deepStrictEqual(S.categorias(H), ['A', 'B']);
  assert.strictEqual(S.vetor(H, 'HOJE', null).length, 96);
  assert.strictEqual(S.vetor(H, 'HOJE', null)[1], 6);                         // todas as categorias somadas
  assert.strictEqual(S.vetor(H, 'HOJE', 'B')[1], 1);
  assert.strictEqual(S.vetor(H, 'D21', null).reduce((a, b) => a + b, 0), 0);
});

test('magic: bloco de agora e o comparativo só até a mesma hora', () => {
  assert.strictEqual(S.slotAgora('2026-11-12T15:05:02-03:00'), 60);
  assert.strictEqual(S.slotAgora('2026-11-12T00:14'), 0);
  assert.strictEqual(S.slotAgora('lixo'), null);
  const c = S.comparativo(H, null, '2026-11-12T00:40:00');                    // agora = bloco 2 (00:30)
  const por = Object.fromEntries(c.map(x => [x.periodo, x]));
  assert.strictEqual(por.HOJE.total, 11);                                     // blocos 0 a 2 de hoje: 5 + 6 + 0
  assert.strictEqual(por.D7.total, 4 + 6 + 4);                                // o bloco 50 de D7 ainda não "aconteceu" às 00:40
  assert.strictEqual(por.D21.total, 0);
  assert.strictEqual(por.D21.difPct, null);                                   // sem base
  assert.ok(Math.abs(por.D7.difPct - 100 * (11 - 14) / 14) < 1e-9);
  assert.strictEqual(por.HOJE.difPct, null);
});

test('magic: séries do gráfico (hoje só até agora, nos outros dias inteiros)', () => {
  const s = S.seriesLinhas(H, null, '2026-11-12T02:50:00');                   // bloco 11
  const hoje = s.find(x => x.k === 'HOJE').valores;
  assert.strictEqual(hoje[10], 7);
  assert.strictEqual(hoje[11], 0);
  assert.strictEqual(hoje[12], null);                                         // o futuro não é desenhado como zero
  assert.strictEqual(s.find(x => x.k === 'D7').valores[50], 9);
  assert.deepStrictEqual(s.map(x => x.k), ['HOJE', 'D7', 'D14']);             // período sem dado não vira linha
  assert.strictEqual(S.rotulosSlots()[53], '13:15');
});

test('fixture do MAPI: os blocos novos vêm no formato que o app lê', () => {
  assert.ok(S.manobra(fx.manobra_hoje).t.vol > 0);
  ['vlan', 'psa', 'tv'].forEach(k => {
    assert.ok(fx['magic_' + k].TOTAL > 0, k);
    const c = S.comparativo(fx['magic_' + k + '_hist'], null, fx.coletado_em);
    assert.strictEqual(c.length, 4, k);
    assert.ok(c.every(x => x.total >= 0), k);
  });
  assert.strictEqual(S.parteDoTotal(25, 100), 25);
  assert.strictEqual(S.parteDoTotal(1, 0), null);
});
