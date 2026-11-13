const test = require('node:test');
const assert = require('node:assert');
const G = require('../grafico.js');

test('topo da escala é um número redondo que cabe o máximo', () => {
  assert.deepStrictEqual([0, 1, 7, 12, 37, 100, 101, 8375].map(G.topoEscala), [1, 1, 8, 15, 40, 100, 150, 10000]);
});

test('colunas empilhadas: acertos embaixo, erros em cima, dentro da área', () => {
  const g = G.colunas([['2026-11-12T10:00', 8, 2], ['2026-11-12T10:15', 0, 0], ['2026-11-12T10:30', 4, 0]], 340, 150);
  assert.strictEqual(g.N, 3);
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

test('colunas sem pontos não quebram', () => {
  const g = G.colunas([], 340, 150);
  assert.strictEqual(g.barras.length, 0);
  assert.strictEqual(g.topo, 1);
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
