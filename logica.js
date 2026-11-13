/* Checklist VLAN — regras de apresentação (sem DOM; roda também no Node, para os testes).
 *
 * situacao():  o aviso do topo a partir de `programacao`, `coletado_em` e `limite_atraso_s` (vêm do MAPI, que sabe a cadência
 *              do coletor): desligada, fora da janela, atrasada ou normal. O app nunca recalcula números dos KPIs.
 * Frentes:     nome de cada frente e a ordem das barras.
 */
(function (root) {
  'use strict';

  const NOMES = {
    TOTAL: 'Total', TRIAGEM: 'Triagem', MANOBRA: 'Manobra', ENRIQUECIMENTO: 'Enriquecimento', MAGIC: 'Magic', CO: 'CO',
    TEL: 'TEL', TEL_ICOMON: 'TEL', CO_SISTEMICO: 'CO sistêmico', MONITORAMENTO: 'Monitoramento', REGIONAL: 'Regional', RAV: 'RAV',
    OUTRA_FRENTE: 'Outras'
  };
  const ORDEM = ['TRIAGEM', 'MANOBRA', 'ENRIQUECIMENTO', 'MAGIC', 'CO', 'TEL', 'TEL_ICOMON', 'CO_SISTEMICO', 'MONITORAMENTO', 'REGIONAL', 'RAV'];

  const nomeFrente = k => NOMES[k] || String(k).toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

  // [[chave, valor]] sem o TOTAL, na ordem das frentes conhecidas e depois as demais pelo maior valor
  function frentes(mapa) {
    const itens = Object.entries(mapa || {}).filter(([k]) => k !== 'TOTAL');
    const pos = k => { const i = ORDEM.indexOf(k); return i < 0 ? 999 : i; };
    return itens.sort((a, b) => pos(a[0]) - pos(b[0]) || b[1] - a[1]);
  }

  // "HH:MM" -> minutos do dia (ou null)
  function minutos(hhmm) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  function naJanela(prog, d) {
    const a = minutos(prog && prog.hora_inicio), b = minutos(prog && prog.hora_fim);
    if (a == null || b == null) return true;
    const agora = d.getHours() * 60 + d.getMinutes();
    return a <= b ? (agora >= a && agora <= b) : (agora >= a || agora <= b);
  }

  /** {nivel: 'ok'|'info'|'atraso', texto, idade_min}. `agora` = Date. */
  function situacao(dados, agora) {
    agora = agora || new Date();
    const t = Date.parse(dados && dados.coletado_em);
    const idade = isNaN(t) ? null : Math.max(0, Math.round((agora.getTime() - t) / 60000));
    const prog = dados && dados.programacao;
    if (prog && prog.ativo === false) return { nivel: 'info', texto: 'A coleta está desligada: estes são os últimos números coletados.', idade_min: idade };
    if (prog && !naJanela(prog, agora))
      return { nivel: 'info', texto: `Fora do horário de coleta (${prog.hora_inicio}–${prog.hora_fim}): estes são os últimos números.`, idade_min: idade };
    const limite = Number(dados && dados.limite_atraso_s) > 0 ? dados.limite_atraso_s / 60 : 15;
    if (idade == null || idade > limite)
      return { nivel: 'atraso', texto: idade == null ? 'Não sei quando foi a última coleta.' : `Dados atrasados: a última coleta foi há ${fmtDuracao(idade * 60)}.`, idade_min: idade };
    return { nivel: 'ok', texto: '', idade_min: idade };
  }

  function fmtDuracao(seg) {
    seg = Math.max(0, Math.round(seg));
    const d = Math.floor(seg / 86400), h = Math.floor(seg % 86400 / 3600), m = Math.floor(seg % 3600 / 60);
    if (d > 0) return `${d} d ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  function fmtBytes(b) {
    if (b == null) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = Number(b);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? String(Math.round(v)) : v.toFixed(1)).replace('.', ',') + ' ' + u[i];
  }

  // % de acerto de uma série [[bloco, acertos, erros]] (ou null sem execuções)
  function resumoSerie(pontos) {
    let a = 0, e = 0;
    for (const p of pontos || []) { a += p[1] || 0; e += p[2] || 0; }
    return { acertos: a, erros: e, total: a + e, pct: a + e > 0 ? Math.round(1000 * a / (a + e)) / 10 : null };
  }

  // nível do uso (CPU, memória, disco, conexões): ok < 70 <= atenção < 90 <= crítico
  function nivelUso(pct) {
    if (pct == null) return 'nd';
    return pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok';
  }

  const api = { nomeFrente, frentes, situacao, naJanela, fmtDuracao, fmtBytes, resumoSerie, nivelUso };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKALogica = api;
})(typeof self !== 'undefined' ? self : globalThis);
