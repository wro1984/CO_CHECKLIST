/* Serviços — contas das abas Manobra (hoje) e Magic (sem DOM; roda também no Node, para os testes).
 *
 * manobra(m): a Manobra de HOJE por frente (humano, robô e os dois juntos), do bloco `manobra_hoje` (o MAPI lê no .242 com a regra do NS:
 *             no corte = atribuída em até `corte_min` min; humano = sem automação). NS = no corte ÷ atendidas.
 * magic*:     números de hoje (VLAN, PSA, TV) e o comparativo do dia (hoje × D-7 × D-14 × D-21), dos blocos `magic_*` do coletor da 162.
 * O app nunca recalcula o NS do MAPI: aqui só somas e divisões dos números já prontos, para mostrar.
 */
(function (root) {
  'use strict';

  const ns = f => (f && f.at > 0 ? f.cor / f.at : null);                 // 0..1 ou null
  const trio = a => ({ vol: a[0] || 0, at: a[1] || 0, cor: a[2] || 0 });

  /** Manobra de hoje -> {h, r, t, partes:{h,r}, espera, pendentes, espera_max_s, serie, dia, gerado_em, corte} (ou null sem dado). */
  function manobra(m) {
    if (!m || !Array.isArray(m.h) || !Array.isArray(m.r)) return null;
    const h = trio(m.h), r = trio(m.r), t = { vol: h.vol + r.vol, at: h.at + r.at, cor: h.cor + r.cor };
    const parte = f => (t.vol > 0 ? f.vol / t.vol : null);
    return {
      h: Object.assign(h, { ns: ns(h) }), r: Object.assign(r, { ns: ns(r) }), t: Object.assign(t, { ns: ns(t) }),
      partes: { h: parte(h), r: parte(r) },
      espera: m.espera_media_s || { h: null, r: null },
      pendentes: m.pendentes || { h: 0, r: 0 },
      espera_max_s: m.espera_max_s || { h: 0, r: 0 },
      serie: Array.isArray(m.serie) ? m.serie : [],
      dia: m.dia || null, gerado_em: m.gerado_em || null, corte: m.corte_min || 5
    };
  }

  /** Pontos para o gráfico de colunas (G.colunas): [[bloco 'AAAA-MM-DDTHH:MM', humano, robô]] com as solicitações de cada bloco de 15 min. */
  function manobraPontos(m) {
    const x = manobra(m);
    if (!x || !x.dia) return [];
    return x.serie.map(l => [`${x.dia}T${l[0]}`, l[1] || 0, l[4] || 0]);
  }

  /** O dado é de hoje? (o bloco guarda o dia do .242; se o app abriu uma cópia velha, avisa). `hoje` = 'AAAA-MM-DD' do aparelho. */
  const ehDeHoje = (m, hoje) => !!(m && m.dia && hoje && m.dia === hoje);

  // ---------- Robô na Manobra (dia a dia) ----------
  const EXITO = 'Manobra realizada';       // a finalização que conta como êxito do robô; qualquer outra (falhas e demais motivos) não

  /** Bloco `robo` (+ `robo_motivos`) do manobra_hoje -> {hoje, dias, motivos, exito, disponiveis}. É a consulta da gestão (robô = matrícula RB...).
   *  dias: [{dia, total, robo, realizadas, pctRobo, pctManobras, exito}] (os `n` mais novos; sem `n`, todos).
   *  pctRobo = do robô ÷ total; pctManobras = realizadas pelo robô ÷ total; exito = realizadas ÷ tratativas FINALIZADAS do robô (as que
   *  terminaram em falha ou em outro motivo contam contra; as sem finalização, ainda em andamento, não entram na conta).
   *  motivos (dos mesmos dias): [{motivo, qtd, pct}] do maior para o menor, `motivo` nulo = sem finalização (pct nulo); exito do período. */
  function robo(m, n) {
    if (!m || !Array.isArray(m.robo) || !m.robo.length) return null;
    const div = (a, b) => (b > 0 ? a / b : null);
    const mot = Array.isArray(m.robo_motivos) ? m.robo_motivos : null;
    const dia1 = (dia, f) => (mot || []).filter(x => x.dia === dia && f(x)).reduce((t, x) => t + (x.qtd || 0), 0);
    const dias = m.robo.slice(0, n > 0 ? n : undefined).map(d => {
      const total = d.total || 0, rb = d.robo || 0, rz = d.realizadas || 0;
      const fin = mot ? dia1(d.dia, x => x.motivo != null) : rb;      // sem os motivos, a base é todas as do robô
      return { dia: d.dia, total, robo: rb, realizadas: rz, pctRobo: div(rb, total), pctManobras: div(rz, total), exito: div(rz, fin) };
    });
    let motivos = null, exito = null;
    if (mot) {
      const ate = new Set(dias.map(d => d.dia)), por = new Map();
      mot.forEach(x => { if (ate.has(x.dia)) por.set(x.motivo, (por.get(x.motivo) || 0) + (x.qtd || 0)); });
      const fin = [...por].filter(([k]) => k != null).reduce((t, [, q]) => t + q, 0);
      motivos = [...por].map(([motivo, qtd]) => ({ motivo, qtd, pct: motivo == null ? null : div(qtd, fin) }))
        .sort((a, b) => (a.motivo == null) - (b.motivo == null) || b.qtd - a.qtd);
      exito = div(por.get(EXITO) || 0, fin);
    }
    return { hoje: dias.find(d => d.dia === m.dia) || null, dias, motivos, exito, disponiveis: m.robo.length };
  }

  // ---------- Magic ----------
  const PERIODOS = ['HOJE', 'D7', 'D14', 'D21'];
  const NOME_PERIODO = { HOJE: 'Hoje', D7: 'Há 7 dias', D14: 'Há 14 dias', D21: 'Há 21 dias' };
  const FRENTES_MAGIC = [['vlan', 'VLAN'], ['psa', 'PSA'], ['tv', 'TV']];

  /** Categorias que aparecem no histórico (ordem de aparição em HOJE, depois as dos outros dias). */
  function categorias(hist) {
    const out = [];
    PERIODOS.forEach(p => Object.keys((hist && hist[p]) || {}).forEach(c => { if (!out.includes(c)) out.push(c); }));
    return out;
  }

  /** Vetor de 96 blocos (15 min) de um período; `cat` null = todas as categorias somadas. */
  function vetor(hist, periodo, cat) {
    const v = new Array(96).fill(0);
    const cats = (hist && hist[periodo]) || {};
    Object.keys(cats).forEach(c => {
      if (cat && c !== cat) return;
      cats[c].forEach(([slot, q]) => { if (slot >= 0 && slot < 96) v[slot] += q; });
    });
    return v;
  }

  /** Bloco de 15 min de agora (0..95) a partir de 'AAAA-MM-DDTHH:MM...' (hora do coletor). */
  function slotAgora(iso) {
    const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
    return m ? Math.min(95, Number(m[1]) * 4 + Math.floor(Number(m[2]) / 15)) : null;
  }

  /**
   * Comparativo do dia: o total de cada período ATÉ o bloco de agora (hoje até agora × os outros dias até a mesma hora) e a variação em %
   * contra hoje. -> [{periodo, nome, total, ate, difPct}] (difPct = (hoje − período) ÷ período, em %; null sem base).
   */
  function comparativo(hist, cat, iso) {
    const s = slotAgora(iso);
    const ate = s == null ? 95 : s;
    const soma = p => vetor(hist, p, cat).slice(0, ate + 1).reduce((a, b) => a + b, 0);
    const hoje = soma('HOJE');
    return PERIODOS.map(p => {
      const total = soma(p);
      return { periodo: p, nome: NOME_PERIODO[p], total, ate, difPct: p === 'HOJE' || total === 0 ? null : 100 * (hoje - total) / total };
    });
  }

  /** Séries para G.linhas: [{k, valores(96)}]; os dias anteriores inteiros, HOJE só até o bloco de agora (depois, null). */
  function seriesLinhas(hist, cat, iso) {
    const s = slotAgora(iso);
    return PERIODOS.filter(p => hist && hist[p]).map(p => {
      const v = vetor(hist, p, cat);
      return { k: p, valores: p === 'HOJE' && s != null ? v.map((x, i) => (i <= s ? x : null)) : v };
    });
  }

  const rotulosSlots = () => Array.from({ length: 96 }, (_, i) => String(Math.floor(i / 4)).padStart(2, '0') + ':' + String((i % 4) * 15).padStart(2, '0'));

  /** Percentual de um item do dia ("Carga OK" 40 de 100) em %, ou null. */
  const parteDoTotal = (v, total) => (total > 0 && v != null ? 100 * v / total : null);

  const api = { manobra, manobraPontos, ehDeHoje, robo, EXITO, categorias, vetor, slotAgora, comparativo, seriesLinhas, rotulosSlots, parteDoTotal, ns,
    PERIODOS, NOME_PERIODO, FRENTES_MAGIC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKAServicos = api;
})(typeof self !== 'undefined' ? self : globalThis);
