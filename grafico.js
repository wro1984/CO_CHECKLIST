/* Checklist VLAN — contas dos gráficos (sem DOM; roda também no Node, para os testes).
 *
 * colunas(): acertos e erros por bloco de 15 min, em colunas empilhadas (erro em cima).
 * linhas():  gráfico de linhas com várias séries (acompanhamento do dia por frente).
 * Escala pelo maior valor VISÍVEL, arredondado para cima num número "redondo".
 */
(function (root) {
  'use strict';

  // o menor 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10^n que cabe o máximo
  function topoEscala(max) {
    if (!(max > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max - 1e-9) return f * p;
    return max;
  }

  const M = { x0: 30, y1: 6 };       // margem esquerda (rótulos do eixo) e topo

  // pontos: [[bloco, acertos, erros]]
  function colunas(pontos, w, h) {
    const N = pontos.length, x0 = M.x0, x1 = w - 4, y0 = h - 16, y1 = M.y1;
    const max = Math.max(0, ...pontos.map(p => (p[1] || 0) + (p[2] || 0)));
    const topo = topoEscala(max);
    const slot = N > 0 ? (x1 - x0) / N : 0, larg = Math.max(1, slot * 0.72);
    const Y = v => y0 - (y0 - y1) * v / topo;
    return {
      x0, x1, y0, y1, N, topo, slot,
      grade: [0, 0.5, 1].map(f => ({ y: Y(topo * f), v: Math.round(topo * f) })),
      barras: pontos.map((p, i) => {
        const a = p[1] || 0, e = p[2] || 0, x = x0 + slot * i + (slot - larg) / 2;
        return { i, x, larg, ya: Y(a), ha: Y(0) - Y(a), ye: Y(a + e), he: Y(a) - Y(a + e) };
      })
    };
  }

  // series: [{k, valores}], off: {k:true} escondidas
  function linhas(rotulos, series, off, w, h) {
    const vis = series.filter(s => !(off && off[s.k]));
    const max = Math.max(0, ...vis.flatMap(s => s.valores.filter(v => v != null)));
    const topo = topoEscala(max);
    const x0 = M.x0, x1 = w - 6, y0 = h - 16, y1 = M.y1, N = rotulos.length;
    const X = i => (N > 1 ? x0 + (x1 - x0) * i / (N - 1) : (x0 + x1) / 2);
    const Y = v => y0 - (y0 - y1) * v / topo;
    const pts = d => d.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    return {
      x0, x1, y0, y1, N, topo, X, Y,
      grade: [0, 0.5, 1].map(f => ({ y: Y(topo * f), v: Math.round(topo * f) })),
      linhas: vis.map(s => ({ k: s.k, pontos: pts(s.valores) }))
    };
  }

  // toque (x em unidades do viewBox) -> índice do bloco mais perto
  function indiceDoToque(x, x0, x1, N) {
    if (N <= 1) return 0;
    return Math.max(0, Math.min(N - 1, Math.floor((x - x0) / (x1 - x0) * N)));
  }

  // índices de rótulos do eixo X (de `passo` em `passo` blocos), sem encostar no fim
  function marcas(N, passo) {
    const out = [];
    for (let i = 0; i < N; i += passo) out.push(i);
    return out;
  }

  const api = { topoEscala, colunas, linhas, indiceDoToque, marcas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKAGrafico = api;
})(typeof self !== 'undefined' ? self : globalThis);
