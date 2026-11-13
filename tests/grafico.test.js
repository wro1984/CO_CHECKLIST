const test = require('node:test');
const assert = require('node:assert');
const G = require('../grafico.js');

test('topo da escala é um número redondo que cabe o máximo', () => {
  assert.deepStrictEqual([0, 1, 7, 12, 37, 100, 101, 8375].map(G.topoEscala), [1, 1, 8, 15, 40, 100, 150, 10000]);
});

const bloco = (h, m, dia = 12) => `2026-11-${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

test('colunas empilhadas: acertos embaixo, erros em cima, dentro da área', () => {
  const g = G.colunas([[bloco(10, 0), 8, 2], [bloco(10, 15), 0, 0], [bloco(10, 30), 4, 0]], 340, 150);
  assert.strictEqual(g.N, 96);
  assert.strictEqual(g.topo, 10);
  const b = g.barras[0];
  assert.ok(Math.abs(b.ha / (g.y0 - g.y1) - 0.8) < 1e-9);
  assert.ok(Math.abs(b.he / (g.y0 - g.y1) - 0.2) < 1e-9);
  assert.ok(Math.abs((b.ye + b.he + b.ha) - g.y0) < 1e-9);          // a pilha termina no eixo
  assert.strictEqual(g.barras[1].ha, 0);
  assert.strictEqual(g.barras[1].he, 0);
  assert.ok(g.barras.every(x => x.x >= g.x0 && x.x + x.larg <= g.x1 + 1e-9));
  assert.deepStrictEqual(g.grade.map(l => l.v), [0, 5, 10]);
});

test('colunas: o eixo é o horário real, blocos sem execução ficam vazios', () => {
  // só os blocos 09:00, 09:15 e 11:00 existem (o coletor não manda os vazios): 11:00 fica 8 blocos depois de 09:00
  const g = G.colunas([[bloco(9, 0), 1, 0], [bloco(9, 15), 2, 0], [bloco(11, 0), 3, 0]], 340, 150);
  const s = g.barras.map(b => b.slot);
  assert.strictEqual(s[1] - s[0], 1);
  assert.strictEqual(s[2] - s[1], 7);                                // 09:15 -> 11:00 = 7 blocos
  assert.strictEqual(s[2], 95);                                      // a janela termina no último bloco recebido
  assert.ok(Math.abs((g.barras[2].x - g.barras[1].x) - 7 * g.slot) < 1e-9);
  assert.strictEqual(g.horaDoSlot(95), '11:00');
  assert.strictEqual(g.horaDoSlot(s[0]), '09:00');
});

test('colunas: janela de 24 h, rótulos de 4 em 4 horas e blocos antigos fora', () => {
  const pts = [[bloco(10, 0, 11), 5, 0], [bloco(15, 0, 12), 1, 1]];            // o primeiro tem 29 h: sai da janela
  const g = G.colunas(pts, 340, 150);
  assert.strictEqual(g.barras.length, 1);
  assert.deepStrictEqual(g.marcas.map(m => m.hh), ['16h', '20h', '00h', '04h', '08h', '12h']);
  assert.strictEqual(g.topo, 2);                                       // a escala só olha o que está na janela
  const m0 = g.marcas.find(m => m.hh === '12h');
  assert.strictEqual(g.horaDoSlot(m0.slot), '12:00');
});

test('colunas: toque vira o bloco certo', () => {
  const g = G.colunas([[bloco(9, 0), 1, 0], [bloco(11, 0), 3, 0]], 340, 150);
  assert.strictEqual(g.slotDoToque(g.x0), 0);
  assert.strictEqual(g.slotDoToque(g.x1 + 50), 95);
  assert.strictEqual(g.slotDoToque(-10), 0);
  assert.strictEqual(g.slotDoToque(g.x0 + g.slot * 40.5), 40);
});

test('colunas sem pontos ou com bloco inválido não quebram', () => {
  const g = G.colunas([], 340, 150);
  assert.strictEqual(g.barras.length, 0);
  assert.strictEqual(g.topo, 1);
  assert.deepStrictEqual(g.marcas, []);
  assert.strictEqual(g.horaDoSlot(3), '—');
  assert.strictEqual(G.colunas([['lixo', 1, 1]], 340, 150).barras.length, 0);
});

test('completar: blocos que faltam entram com zero', () => {
  const r = G.completar([[bloco(9, 0), 5, 1], [bloco(9, 45), 2, 0]], 2);
  assert.deepStrictEqual(r.map(l => l[0].slice(11)), ['09:00', '09:15', '09:30', '09:45']);
  assert.deepStrictEqual(r[1].slice(1), [0, 0]);
  assert.deepStrictEqual(r[3].slice(1), [2, 0]);
  assert.deepStrictEqual(G.completar([], 2), []);
  const virada = G.completar([[bloco(23, 30), 1], [bloco(0, 0, 13), 1]], 1);              // passa da meia-noite
  assert.deepStrictEqual(virada.map(l => l[0]), ['2026-11-12T23:30', '2026-11-12T23:45', '2026-11-13T00:00']);
});

test('linhas: escala só pelas séries visíveis', () => {
  const series = [{ k: 'total', valores: [10, 100, 50] }, { k: 'A', valores: [1, 2, 3] }];
  assert.strictEqual(G.linhas(['a', 'b', 'c'], series, {}, 340, 150).topo, 100);
  const g = G.linhas(['a', 'b', 'c'], series, { total: true }, 340, 150);
  assert.strictEqual(g.topo, 3);
  assert.deepStrictEqual(g.linhas.map(l => l.k), ['A']);
});

test('linhas: valor nulo vira buraco', () => {
  const g = G.linhas(['a', 'b', 'c'], [{ k: 'A', valores: [1, null, 3] }], {}, 340, 150);
  assert.strictEqual(g.linhas[0].pontos.split(' ').length, 2);
});

test('toque: índice do bloco', () => {
  assert.strictEqual(G.indiceDoToque(30, 30, 336, 96), 0);
  assert.strictEqual(G.indiceDoToque(335.9, 30, 336, 96), 95);
  assert.strictEqual(G.indiceDoToque(500, 30, 336, 96), 95);
  assert.strictEqual(G.indiceDoToque(-5, 30, 336, 96), 0);
  assert.strictEqual(G.indiceDoToque(100, 30, 336, 1), 0);
});
