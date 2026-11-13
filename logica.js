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

  // ---------- atualização automática ----------
  const INTERVALOS_S = [30, 60, 120, 300, 0];           // 0 = manual
  const INTERVALO_PADRAO_S = 60;
  const intervaloValido = v => { if (v == null || String(v).trim() === '') return INTERVALO_PADRAO_S; const n = Number(v); return INTERVALOS_S.includes(n) ? n : INTERVALO_PADRAO_S; };
  /** Segundos até a próxima atualização (null = manual). `ultimo` e `agora` em ms. */
  function segundosRestantes(ultimo, intervaloS, agora) {
    if (!intervaloS) return null;
    return Math.max(0, Math.ceil((ultimo + intervaloS * 1000 - agora) / 1000));
  }
  const fmtContagem = seg => seg == null ? 'manual' : `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;

  // ---------- eventos (alertas) ----------
  /** {abertos, historico, dias} do dados.json ou null quando os alertas não estão ligados no MAPI. */
  const eventosDe = d => (d && d.eventos && Array.isArray(d.eventos.abertos) && Array.isArray(d.eventos.historico)) ? d.eventos : null;
  const minutosEntre = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return isNaN(x) || isNaN(y) ? null : Math.max(0, Math.round((y - x) / 60000)); };
  const duracaoEvento = (e, agora) => minutosEntre(e.aberto_em, e.fechado_em || new Date(agora).toISOString());
  const diaBR = iso => { const t = Date.parse(iso); if (isNaN(t)) return ''; const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const horaBR = iso => { const t = Date.parse(iso); if (isNaN(t)) return '—'; const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  /** Histórico agrupado por dia (mais recente antes): [{dia: 'dd/mm', itens: [...]}]. */
  function porDia(hist) {
    const grupos = [], idx = {};
    (hist || []).slice().sort((a, b) => Date.parse(b.aberto_em) - Date.parse(a.aberto_em)).forEach(e => {
      const k = diaBR(e.aberto_em);
      if (!(k in idx)) { idx[k] = grupos.length; grupos.push({ dia: k, itens: [] }); }
      grupos[idx[k]].itens.push(e);
    });
    return grupos;
  }
  /** Texto do detalhe do evento com vírgula decimal (o MAPI já manda assim; aqui só por segurança). */
  const detalhePT = t => String(t == null ? '' : t).replace(/(\d)\.(\d)/g, '$1,$2');
  const rotuloSev = s => s === 'critico' ? 'Crítico' : 'Aviso';
  /** Valor do evento como texto: 85,5% para regras em %, valor puro para as demais. */
  const fmtPico = e => e.pico == null ? '—' : (['cpu', 'mem', 'disco', 'conn162', 'conn242'].includes(e.regra) ? String(Math.round(e.pico * 10) / 10).replace('.', ',') + '%' : String(e.pico));

  // ---------- texto para compartilhar (WhatsApp usa *negrito*) ----------
  function textoCompartilhar(d, agora) {
    const n = v => v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v);
    const iso = String(d.coletado_em || '');       // hora do coletor (Brasília), como no topo do app: não depende do fuso do aparelho
    const ln = [`*Checklist VLAN* — coleta às ${iso.slice(11, 16) || '—'} de ${iso.slice(8, 10)}/${iso.slice(5, 7)}`];
    if (d.fila) ln.push(`Fila: ${n(d.fila.aguardando)} aguardando · ${n(d.fila.executando)} em execução`);
    const tot = m => m && (m.TOTAL != null ? m.TOTAL : frentes(m).reduce((s, x) => s + x[1], 0));
    if (d.execucao_frente) ln.push(`Em execução: ${n(tot(d.execucao_frente))} (` + frentes(d.execucao_frente).map(([k, v]) => `${nomeFrente(k)} ${n(v)}`).join(' · ') + ')');
    if (d.hoje_frente) ln.push(`Hoje: ${n(tot(d.hoje_frente))} (` + frentes(d.hoje_frente).map(([k, v]) => `${nomeFrente(k)} ${n(v)}`).join(' · ') + ')');
    if (d.rede_magic) ln.push('Rede (Magic): ' + Object.entries(d.rede_magic).map(([k, v]) => `${k} ${n(v)}`).join(' · '));
    const h = d.hardware;
    if (h) ln.push(`Máquina 162: CPU ${h.cpu_pct == null ? '—' : h.cpu_pct + '%'} · memória ${h.mem_pct == null ? '—' : h.mem_pct + '%'}`);
    const b = d.bancos;
    if (b) ln.push('Bancos: ' + [['162', b.b162], ['242', b.b242]].filter(x => x[1]).map(([k, x]) => `${k} ${n(x.total)}/${n(x.max)} conexões`).join(' · '));
    const ev = eventosDe(d);
    if (ev && ev.abertos.length) ln.push(`⚠️ ${ev.abertos.length} evento(s) aberto(s): ` + ev.abertos.map(e => e.nome + (e.chave ? ' ' + e.chave : '')).join(' · '));
    else if (ev) ln.push('✅ Nenhum evento aberto');
    return ln.join('\n');
  }

  const api = { nomeFrente, frentes, situacao, naJanela, fmtDuracao, fmtBytes, resumoSerie, nivelUso, INTERVALOS_S, INTERVALO_PADRAO_S,
    intervaloValido, segundosRestantes, fmtContagem, eventosDe, minutosEntre, duracaoEvento, diaBR, horaBR, porDia, rotuloSev, fmtPico, detalhePT,
    textoCompartilhar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKALogica = api;
})(typeof self !== 'undefined' ? self : globalThis);
