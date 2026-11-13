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

  const SLOTS = 96;                                          // 24 h em blocos de 15 min
  // 'AAAA-MM-DDTHH:MM' -> minutos (a hora é a do coletor: só conta a diferença entre os blocos)
  function minutos(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : null;
  }
  const hhmmDe = min => { const d = new Date(min * 60000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };

  // pontos: [[bloco, acertos, erros]]. O coletor só manda os blocos COM execução: o eixo é o horário real (96 blocos de 15 min,
  // terminando no último bloco recebido), então blocos sem execução ficam vazios e as horas ficam no lugar certo.
  function colunas(pontos, w, h) {
    const x0 = M.x0, x1 = w - 4, y0 = h - 16, y1 = M.y1;
    const mins = pontos.map(p => minutos(p[0]));
    const validos = mins.filter(v => v != null);
    const fim = validos.length ? Math.max(...validos) : null, ini = fim == null ? null : fim - 15 * (SLOTS - 1);
    const max = Math.max(0, ...pontos.map((p, i) => (mins[i] != null && mins[i] >= ini ? (p[1] || 0) + (p[2] || 0) : 0)));
    const topo = topoEscala(max);
    const slot = (x1 - x0) / SLOTS, larg = Math.max(1, slot * 0.72);
    const Y = v => y0 - (y0 - y1) * v / topo;
    const barras = [];
    pontos.forEach((p, i) => {
      if (mins[i] == null) return;
      const s = Math.round((mins[i] - ini) / 15);
      if (s < 0 || s >= SLOTS) return;
      const a = p[1] || 0, e = p[2] || 0, x = x0 + slot * s + (slot - larg) / 2;
      barras.push({ i, slot: s, x, larg, ya: Y(a), ha: Y(0) - Y(a), ye: Y(a + e), he: Y(a) - Y(a + e) });
    });
    const marcas = [];
    if (ini != null) for (let s = 0; s < SLOTS; s++) { const t = hhmmDe(ini + 15 * s); if (/^(00|04|08|12|16|20):00$/.test(t)) marcas.push({ slot: s, hh: t.slice(0, 2) + 'h', x: x0 + slot * (s + 0.5) }); }
    return {
      x0, x1, y0, y1, N: SLOTS, topo, slot,
      grade: [0, 0.5, 1].map(f => ({ y: Y(topo * f), v: Math.round(topo * f) })),
      barras, marcas,
      horaDoSlot: s => (ini == null ? '—' : hhmmDe(ini + 15 * s)),
      slotDoToque: x => Math.max(0, Math.min(SLOTS - 1, Math.floor((x - x0) / slot)))
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

  // linhas [bloco, v1, v2...] só com os blocos que existem: completa os de 15 min que faltam, com zero (a linha não "pula" o horário)
  function completar(linhas, nValores) {
    const m = linhas.map(l => minutos(l[0])), ok = m.filter(v => v != null);
    if (!ok.length) return linhas.slice();
    const por = {}; linhas.forEach((l, i) => { if (m[i] != null) por[m[i]] = l; });
    const zeros = Array.from({ length: nValores }, () => 0), out = [];
    for (let t = Math.min(...ok); t <= Math.max(...ok); t += 15) {
      const d = new Date(t * 60000), p2 = v => String(v).padStart(2, '0');
      out.push(por[t] || [`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`].concat(zeros));
    }
    return out;
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

  const api = { topoEscala, colunas, linhas, indiceDoToque, marcas, minutos, completar, SLOTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKAGrafico = api;
})(typeof self !== 'undefined' ? self : globalThis);
