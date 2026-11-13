/* Checklist VLAN — imagem para compartilhar (WhatsApp, Teams...).
 *
 * montar(dados, opcoes) devolve um PLANO de desenho (sem DOM, roda no Node nos testes): {w, h, cmds}. renderizar(canvas, plano, escala)
 * executa o plano num <canvas>. A imagem é sempre em tema claro (lê bem em qualquer conversa) e leva 1080 px de largura lógica; com
 * escala 2 sai com 2160 px, nítida mesmo ampliada. Só números já abertos na tela: nada de login, matrícula ou texto de SQL.
 *
 * opcoes: {area: 'agora' | 'acertos' | 'saude' | 'eventos' | 'completo', frente, agora (ms)}.
 */
(function (root) {
  'use strict';

  const L = root.CKALogica || (typeof require !== 'undefined' ? require('./logica.js') : null);
  const G = root.CKAGrafico || (typeof require !== 'undefined' ? require('./grafico.js') : null);

  const W = 1080, M = 40, CW = W - 2 * M;                 // largura, margem e largura útil
  const COR = { bg: '#EFEAF5', card: '#ffffff', ink: '#1f1530', ink2: '#5b5068', ink3: '#8f849e', line: '#e6e0ee', lil: '#f6f1fa', roxo: '#642A90',
    ok: '#2f7a12', ok2: '#4aa023', warn: '#9a5b00', warn2: '#d59a12', bad: '#c41a60', bad2: '#d6336c',
    s: ['#8549b5', '#3f7fd6', '#d59a12', '#2f9a6a', '#c65b9b', '#e0572f', '#1aa1b8', '#7b7f12'] };
  const FONTE = '"Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
  const NUM = 'ui-monospace, "SF Mono", Consolas, "Roboto Mono", monospace';
  const nf = v => v == null ? '—' : new Intl.NumberFormat('pt-BR').format(v);
  const pct = v => v == null ? '—' : String(Math.round(Number(v) * 10) / 10).replace('.', ',') + '%';

  function novo() {
    const cmds = [];
    return {
      cmds, y: 0,
      rect(x, y, w, h, o) { cmds.push(Object.assign({ t: 'rect', x, y, w, h, r: 0, fill: null, stroke: null }, o)); },
      text(txt, x, y, o) { cmds.push(Object.assign({ t: 'text', txt: String(txt), x, y, size: 26, weight: 400, fill: COR.ink, align: 'left', num: false, maxW: null }, o)); },
      line(x1, y1, x2, y2, o) { cmds.push(Object.assign({ t: 'line', x1, y1, x2, y2, stroke: COR.line, width: 2, dash: null }, o)); },
      poly(pts, o) { cmds.push(Object.assign({ t: 'poly', pts, stroke: COR.ink, width: 3.5 }, o)); }
    };
  }

  // ---------- blocos ----------
  function cabecalho(p, d, titulo) {
    p.rect(0, 0, W, 150, { fill: COR.roxo });
    p.text('Checklist VLAN', M, 62, { size: 44, weight: 700, fill: '#fff' });
    const iso = String(d.coletado_em || '');
    p.text(`${titulo}  ·  coleta às ${iso.slice(11, 16) || '—'} de ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`, M, 112, { size: 27, fill: '#e8dcf3' });
    p.y = 190;
  }

  function secao(p, titulo, altura, corpo) {
    const y0 = p.y;
    const idxCard = p.cmds.length;
    p.rect(M, y0, CW, altura, { r: 26, fill: COR.card, stroke: COR.line });
    p.text(titulo.toUpperCase(), M + 28, y0 + 52, { size: 22, weight: 700, fill: COR.ink2, spacing: 1.6 });
    corpo(M + 28, y0 + 84, CW - 56);
    p.y = y0 + altura + 26;
    return idxCard;
  }

  function kpis(p, x, y, w, itens) {                       // linha de cards de número
    const gap = 18, cw = (w - gap * (itens.length - 1)) / itens.length;
    itens.forEach((it, i) => {
      const cx = x + i * (cw + gap);
      p.rect(cx, y, cw, 128, { r: 18, fill: it.destaque ? COR.lil : '#fff', stroke: COR.line });
      p.text(it.nome, cx + 22, y + 40, { size: 23, fill: COR.ink2, maxW: it.legenda ? cw * 0.5 : cw - 44 });
      p.text(it.valor, cx + 22, y + 98, { size: 54, weight: 700, num: true, fill: it.cor || COR.ink, maxW: cw - 44 });
      if (it.legenda) p.text(it.legenda, cx + cw - 22, y + 40, { size: 21, fill: COR.ink3, align: 'right', maxW: cw * 0.55 });
    });
    return 128;
  }

  function barras(p, x, y, w, mapa, cor) {
    const itens = L.frentes(mapa);
    if (!itens.length) { p.text('Nenhum registro.', x, y + 30, { size: 25, fill: COR.ink2 }); return 56; }
    const max = Math.max(1, ...itens.map(i => i[1]));
    itens.forEach(([k, v], i) => {
      const yy = y + i * 64;
      p.text(L.nomeFrente(k), x, yy + 24, { size: 26, maxW: w * 0.6 });
      p.text(nf(v), x + w, yy + 24, { size: 27, weight: 700, num: true, align: 'right' });
      p.rect(x, yy + 36, w, 14, { r: 7, fill: COR.lil });
      p.rect(x, yy + 36, Math.max(14, w * v / max), 14, { r: 7, fill: cor || COR.s[i % COR.s.length] });
    });
    return itens.length * 64;
  }

  const altBarras = m => Math.max(1, L.frentes(m).length) * 64;
  const total = m => m.TOTAL != null ? m.TOTAL : L.frentes(m).reduce((s, x) => s + x[1], 0);

  function indisponivel(p, x, y, txt) { p.text(txt || 'Indisponível nesta coleta.', x, y + 30, { size: 25, fill: COR.ink2 }); }

  // ---------- áreas ----------
  function areaAgora(p, d) {
    const f = d.fila;
    secao(p, 'Fila agora', 128 + 110, (x, y, w) => f ? kpis(p, x, y, w, [
      { nome: 'Aguardando', valor: nf(f.aguardando), destaque: f.aguardando > 0 }, { nome: 'Em execução', valor: nf(f.executando), destaque: true }])
      : indisponivel(p, x, y));
    const e = d.execucao_frente;
    secao(p, 'Em execução por frente', e ? 128 + 40 + altBarras(e) + 100 : 160, (x, y, w) => {
      if (!e) return indisponivel(p, x, y);
      kpis(p, x, y, w, [{ nome: 'Total em execução', valor: nf(total(e)), destaque: true }]);
      barras(p, x, y + 160, w, e);
    });
    const a = d.aguardando_frente;
    if (a && L.frentes(a).length) secao(p, 'Aguardando por frente', altBarras(a) + 120, (x, y, w) => barras(p, x, y, w, a, COR.warn2));
    const h = d.hoje_frente;
    secao(p, 'Hoje por frente', h ? 128 + 40 + altBarras(h) + 100 : 160, (x, y, w) => {
      if (!h) return indisponivel(p, x, y);
      kpis(p, x, y, w, [{ nome: 'Total de hoje', valor: nf(total(h)), destaque: true }]);
      barras(p, x, y + 160, w, h);
    });
    const r = d.rede_magic;
    if (r && Object.keys(r).length) {
      const tot = Object.values(r).reduce((s, v) => s + v, 0) || 1;
      secao(p, 'Rede hoje (Magic)', 128 + 110, (x, y, w) => kpis(p, x, y, w, Object.entries(r).map(([k, v]) => ({ nome: k, valor: nf(v), legenda: pct(100 * v / tot) }))));
    }
  }

  function medidor(p, x, y, w, nome, valor, legenda) {
    const nv = L.nivelUso(valor), cor = nv === 'bad' ? COR.bad2 : nv === 'warn' ? COR.warn2 : COR.ok2;
    p.text(nome, x, y + 26, { size: 26, maxW: w * 0.6 });
    p.text(pct(valor), x + w, y + 28, { size: 32, weight: 700, num: true, align: 'right', fill: nv === 'bad' ? COR.bad : nv === 'warn' ? COR.warn : COR.ok });
    p.rect(x, y + 42, w, 18, { r: 9, fill: COR.lil });
    p.rect(x, y + 42, valor == null ? 0 : Math.max(18, w * Math.min(100, valor) / 100), 18, { r: 9, fill: cor });
    if (legenda) p.text(legenda, x, y + 92, { size: 22, fill: COR.ink3, maxW: w });
    return 108;
  }

  function areaSaude(p, d) {
    const b = d.bancos;
    secao(p, 'Bancos de dados', b ? 20 + 2 * 128 + 70 : 160, (x, y, w) => {
      if (!b) return indisponivel(p, x, y);
      [['Banco da API (162)', b.b162], ['Banco de operação (242)', b.b242]].forEach(([nome, x2], i) => {
        const yy = y + i * 128;
        if (!x2) { p.text(nome + ': indisponível nesta coleta.', x, yy + 30, { size: 25, fill: COR.ink2 }); return; }
        medidor(p, x, yy, w, nome, x2.max > 0 ? 100 * x2.total / x2.max : null, `${nf(x2.total)} de ${nf(x2.max)} conexões`);
      });
    });
    const h = d.hardware;
    const discos = (h && h.discos) || [];
    secao(p, 'Máquina da API (162)', h ? 70 + 128 + 120 + discos.length * 128 + 40 : 160, (x, y, w) => {
      if (!h) return indisponivel(p, x, y);
      const mw = (w - 40) / 2;
      medidor(p, x, y, mw, 'CPU', h.cpu_pct);
      medidor(p, x + mw + 40, y, mw, 'Memória', h.mem_pct, h.mem_total != null ? `${L.fmtBytes(h.mem_usada)} de ${L.fmtBytes(h.mem_total)}` : '');
      kpis(p, x, y + 128, w, [{ nome: 'Ligada há', valor: h.uptime_s != null ? L.fmtDuracao(h.uptime_s) : '—' },
        { nome: 'Carga (1 min)', valor: h.load1 != null ? String(h.load1).replace('.', ',') : '—' }]);
      discos.forEach((dk, i) => medidor(p, x, y + 290 + i * 128, w, dk.ponto, dk.pct, `${L.fmtBytes(dk.usado)} de ${L.fmtBytes(dk.total)}`));
    });
  }

  function graficoColunas(p, x, y, w, h, pontos) {
    const g = G.colunas(pontos, w, h);
    g.grade.forEach(l => { p.line(x + g.x0, y + l.y, x + g.x1, y + l.y); p.text(l.v, x + g.x0 - 8, y + l.y + 8, { size: 19, fill: COR.ink3, align: 'right', num: true }); });
    g.barras.forEach(b => {
      if (b.ha > 0) p.rect(x + b.x, y + b.ya, b.larg, b.ha, { fill: COR.ok2 });
      if (b.he > 0) p.rect(x + b.x, y + b.ye, b.larg, b.he, { fill: COR.bad2 });
    });
    g.marcas.forEach(m => p.text(m.hh, x + m.x, y + g.y0 + 30, { size: 20, fill: COR.ink3, align: 'center' }));
  }

  function areaAcertos(p, d, frente) {
    const series = d.series || {};
    const chaves = Object.keys(series);
    if (!chaves.length) return secao(p, 'Acertos e erros (24 h)', 160, (x, y) => indisponivel(p, x, y));
    const f = series[frente] ? frente : chaves[0];
    const pontos = series[f], r = L.resumoSerie(pontos);
    secao(p, `Acertos e erros (24 h) · ${L.nomeFrente(f)}`, 84 + 168 + 330 + 80, (x, y, w) => {
      kpis(p, x, y, w, [{ nome: 'Acertos', valor: nf(r.acertos), cor: COR.ok }, { nome: 'Erros', valor: nf(r.erros), cor: r.erros > 0 ? COR.bad : COR.ink },
        { nome: '% de acerto', valor: pct(r.pct), legenda: `${nf(r.total)} exec.` }]);
      if (pontos.length) graficoColunas(p, x, y + 168, w, 310, pontos); else p.text('Nenhuma execução nas últimas 24 h.', x, y + 200, { size: 25, fill: COR.ink2 });
      p.rect(x, y + 168 + 330, 20, 20, { r: 4, fill: COR.ok2 }); p.text('Acertos', x + 30, y + 168 + 348, { size: 22, fill: COR.ink2 });
      p.rect(x + 170, y + 168 + 330, 20, 20, { r: 4, fill: COR.bad2 }); p.text('Erros', x + 200, y + 168 + 348, { size: 22, fill: COR.ink2 });
    });
  }

  function areaEventos(p, d, agora) {
    const ev = L.eventosDe(d);
    if (!ev) return secao(p, 'Eventos', 160, (x, y) => indisponivel(p, x, y, 'Os alertas ainda não estão ligados.'));
    const abertos = ev.abertos.slice(0, 8), hist = ev.historico.slice(0, 10);
    secao(p, `Eventos abertos (${ev.abertos.length})`, abertos.length ? abertos.length * 118 + 100 : 150, (x, y, w) => {
      if (!abertos.length) return p.text('✔ Nenhum evento aberto agora.', x, y + 34, { size: 28, fill: COR.ok, weight: 600 });
      abertos.forEach((e, i) => {
        const yy = y + i * 118, cor = e.sev === 'critico' ? COR.bad2 : COR.warn2;
        p.rect(x, yy, 10, 96, { r: 5, fill: cor });
        p.text(e.nome + (e.chave ? ` · ${e.chave}` : ''), x + 30, yy + 34, { size: 28, weight: 700, maxW: w - 40 });
        p.text(`${L.rotuloSev(e.sev)} · desde ${L.horaBR(e.aberto_em)} (${L.fmtDuracao((L.duracaoEvento(e, agora) || 0) * 60)}) · pico ${L.fmtPico(e)}`, x + 30, yy + 72, { size: 23, fill: COR.ink2, maxW: w - 40 });
      });
    });
    if (hist.length) secao(p, `Histórico (${ev.dias || 7} dias)`, hist.length * 84 + 100, (x, y, w) => hist.forEach((e, i) => {
      const yy = y + i * 84;
      p.rect(x, yy + 6, 14, 14, { r: 7, fill: e.sev === 'critico' ? COR.bad2 : COR.warn2 });
      p.text(`${L.diaBR(e.aberto_em)} ${L.horaBR(e.aberto_em)}  ${e.nome}${e.chave ? ' · ' + e.chave : ''}`, x + 30, yy + 24, { size: 25, maxW: w - 40 });
      p.text(e.regra === 'reinicio' ? 'evento pontual' : `${L.fmtDuracao((L.duracaoEvento(e, agora) || 0) * 60)} · pico ${L.fmtPico(e)}`, x + 30, yy + 56, { size: 22, fill: COR.ink3 });
    }));
  }

  const TITULOS = { agora: 'Agora', acertos: 'Acertos e erros', saude: 'Saúde', eventos: 'Eventos', completo: 'Resumo completo' };

  function montar(d, opcoes) {
    opcoes = opcoes || {};
    const area = TITULOS[opcoes.area] ? opcoes.area : 'agora';
    const agora = opcoes.agora || Date.now();
    const p = novo();
    cabecalho(p, d, TITULOS[area]);
    const faixa = L.situacao(d, new Date(agora));
    if (faixa.nivel !== 'ok') {
      p.rect(M, p.y - 10, CW, 76, { r: 18, fill: faixa.nivel === 'atraso' ? '#fff1d6' : COR.lil });
      p.text(faixa.texto, M + 24, p.y + 36, { size: 24, fill: faixa.nivel === 'atraso' ? COR.warn : COR.ink2, maxW: CW - 48 });
      p.y += 90;
    }
    if (area === 'agora' || area === 'completo') areaAgora(p, d);
    if (area === 'eventos' || area === 'completo') areaEventos(p, d, agora);
    if (area === 'acertos') areaAcertos(p, d, opcoes.frente);
    if (area === 'saude' || area === 'completo') areaSaude(p, d);
    p.text('Checklist VLAN · gerado pelo app, a partir da última coleta', W / 2, p.y + 14, { size: 20, fill: COR.ink3, align: 'center' });
    const h = p.y + 50;
    p.cmds.unshift({ t: 'rect', x: 0, y: 0, w: W, h, r: 0, fill: COR.bg, stroke: null });
    return { w: W, h, cmds: p.cmds, area };
  }

  // ---------- desenho no canvas ----------
  function caminho(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function renderizar(canvas, plano, escala) {
    escala = escala || 2;
    canvas.width = Math.round(plano.w * escala); canvas.height = Math.round(plano.h * escala);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    ctx.textBaseline = 'alphabetic';
    for (const c of plano.cmds) {
      if (c.t === 'rect') {
        if (c.fill) { ctx.fillStyle = c.fill; if (c.r) { caminho(ctx, c.x, c.y, c.w, c.h, c.r); ctx.fill(); } else ctx.fillRect(c.x, c.y, c.w, c.h); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = 2; caminho(ctx, c.x, c.y, c.w, c.h, c.r || 0); ctx.stroke(); }
      } else if (c.t === 'line') {
        ctx.strokeStyle = c.stroke; ctx.lineWidth = c.width; ctx.beginPath(); ctx.moveTo(c.x1, c.y1); ctx.lineTo(c.x2, c.y2); ctx.stroke();
      } else if (c.t === 'poly') {
        ctx.strokeStyle = c.stroke; ctx.lineWidth = c.width; ctx.lineJoin = 'round'; ctx.beginPath();
        c.pts.forEach((pt, i) => i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])); ctx.stroke();
      } else if (c.t === 'text') {
        ctx.font = `${c.weight} ${c.size}px ${c.num ? NUM : FONTE}`;
        ctx.fillStyle = c.fill; ctx.textAlign = c.align;
        let t = c.txt;
        if (c.maxW) { while (t.length > 1 && ctx.measureText(t).width > c.maxW) t = t.slice(0, -2) + '…'; }
        ctx.fillText(t, c.x, c.y);
      }
    }
  }

  const api = { montar, renderizar, W, TITULOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKACartao = api;
})(typeof self !== 'undefined' ? self : globalThis);
