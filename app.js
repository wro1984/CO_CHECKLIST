/* Checklist VLAN — telas.
 *
 * Fluxo: credencial do HUB neste aparelho -> baixa o dados.json (sempre da rede; cópia cifrada no cache para abrir sem
 * rede) -> abre com cripto.js -> desenha. Confere de novo a cada 2 minutos com o app aberto e ao voltar para ele (o
 * coletor grava a cada 5 min). Nada aberto é guardado no aparelho: só o dados.json cifrado.
 *
 * Três áreas, trocadas no topo: Agora (fila e frentes), Acertos (acertos e erros por frente, acompanhamento do dia) e
 * Saúde (bancos e máquina da API). Os números vêm prontos do MAPI/coletor: este app só apresenta. Um bloco que falhou na
 * coleta não vem (nome em `parciais`) e aparece como indisponível; o resto segue.
 */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const CONFERIR_MS = 2 * 60 * 1000;
  const HUB_URL = new URL('/', location.href).href;
  const CACHE_DADOS = 'co-checklist-dados';        // última cópia (CIFRADA) do dados.json, para abrir sem rede

  const G = window.CKAGrafico, K = window.CKACripto, L = window.CKALogica;
  const BASE = (function () {
    const b = String((window.CKA_CONFIG && window.CKA_CONFIG.dados) || '').trim();
    if (!b) return '';
    if (!/^https:\/\/[^/?#]+\/[^?#]*$/.test(b)) throw new Error('config.js: endereço dos dados inválido');
    return b.endsWith('/') ? b : b + '/';
  })();

  const $ = id => document.getElementById(id);
  const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('pt-BR');
  const n = v => v == null ? '—' : nf.format(v);
  const pct = v => v == null ? '—' : String(Math.round(Number(v) * 10) / 10).replace('.', ',') + '%';
  const horaDe = iso => (iso || '').slice(11, 16) || '—';

  let dados = null, cred = null, gerado = null;
  let area = 'agora';
  const abertos = {};                      // ⓘ abertos (sobrevivem ao redesenho)
  const ESTADO = { frente: null, serieSel: null, acompOff: {}, acompSel: null, acompIni: false };

  const INFO = {
    fila: 'Checklists na fila agora: os que aguardam para começar e os que estão em execução.',
    exec: 'Checklists em execução agora, por frente de atividade.',
    aguard: 'Checklists aguardando agora, por frente de atividade.',
    hoje: 'Checklists registrados hoje, por frente de atividade (a mesma conta do painel "Frente de Atividade - HOJE" do Grafana).',
    rede: 'Checklists do Magic registrados, por rede (VIVO1 e VIVO2).',
    serie: 'Acertos e erros em blocos de 15 min, nas últimas 24 h, só das execuções finalizadas. % de acerto = acertos ÷ (acertos + erros). Toque numa coluna para ver o horário.',
    acomp: 'Execuções do dia por frente, em blocos de 15 min (conta tudo do dia, não só as finalizadas). Toque no gráfico para ver o horário; toque na legenda para esconder uma linha.',
    banco: 'Conexões abertas agora no banco e o limite. A divisão entre ativas e ociosas só aparece quando o usuário de leitura enxerga todas as sessões.',
    maquina: 'CPU e memória medidos na própria máquina da API (memória = 1 − disponível ÷ total). Verde abaixo de 70%, amarelo a partir de 70%, vermelho a partir de 90%.'
  };

  // ---------- dados ----------
  async function baixar() {
    const url = BASE + 'dados.json';
    let c = null;
    try { c = 'caches' in window ? await caches.open(CACHE_DADOS) : null; } catch (e) { c = null; }
    let r;
    try { r = await fetch(url, { cache: 'no-store' }); }
    catch (e) {
      r = c ? await c.match(url).catch(() => null) : null;                 // sem rede: a última cópia (cifrada)
      if (!r) { const x = new Error('Sem conexão com o servidor de dados.'); x.code = 'rede'; throw x; }
      const j = await r.json();
      j.__cache = true;
      return j;
    }
    if (r.status === 404) { const e = new Error('Ainda não há dados publicados.'); e.code = 'sem_dados'; throw e; }
    if (!r.ok) throw new Error('Não consegui baixar os dados (HTTP ' + r.status + ').');
    if (c) { try { await c.put(url, r.clone()); } catch (e) { /* sem espaço: segue sem guardar */ } }
    return r.json();
  }

  // acesso perdido: tira do aparelho a cópia (cifrada) dos dados
  async function apagarCopia() {
    if (!('caches' in window)) return;
    try { await caches.delete(CACHE_DADOS); } catch (e) { /* nada a apagar */ }
  }

  async function carregar() {
    cred = await K.lerCredHub();
    if (!cred) { dados = null; await apagarCopia(); return telaAviso('Entre pelo HUB',
      'Este app abre com o login do HUB dos apps. Entre no HUB com sua matrícula e chave e toque no atalho do Checklist VLAN.', true); }
    let pacote;
    try { pacote = await baixar(); }
    catch (e) {
      if (dados) return marcarOffline(true);
      return telaAviso(e.code === 'sem_dados' ? 'Sem dados ainda' : 'Sem conexão', e.message, false);
    }
    const doCache = !!pacote.__cache;
    if (pacote.gerado_em && pacote.gerado_em === gerado && dados) { marcarOffline(doCache); return desenhar(); }
    try {
      dados = await K.abrir(pacote, cred);
      gerado = pacote.gerado_em || null;
    } catch (e) {
      if (e.code === 'sem_acesso') { dados = null; await apagarCopia(); return telaAviso('Sem acesso', e.message, true); }
      return telaAviso('Não deu para abrir', e.message, false);
    }
    marcarOffline(doCache);
    desenhar();
  }

  function marcarOffline(sim) {
    const o = $('offline');
    o.hidden = !sim;
    o.textContent = sim ? 'Sem conexão: mostrando os últimos dados abertos.' : '';
  }

  // ---------- peças ----------
  const btInfo = k => `<button type="button" class="info" data-info="${k}" aria-expanded="${!!abertos[k]}" aria-controls="i-${k}" aria-label="O que é este número">i</button>`;
  const desc = k => `<div class="desc" id="i-${k}"${abertos[k] ? '' : ' hidden'}>${esc(INFO[k])}</div>`;
  const sec = (titulo, k, corpo, extra) => `<section class="sec"><h3><span class="tt">${esc(titulo)}</span>${extra || ''}${k ? btInfo(k) : ''}</h3>${k ? desc(k) : ''}${corpo}</section>`;
  const kpi = (nome, valor, legenda, cls) => `<div class="k ${cls || ''}"><div class="n"><span>${esc(nome)}</span></div><div class="v num">${esc(valor)}</div>${legenda ? `<div class="l">${legenda}</div>` : ''}</div>`;
  const indisp = (bloco, d) => {
    const m = d && d.parciais && d.parciais[bloco];
    return `<p class="vazio">Indisponível nesta coleta${m ? ` (${esc(m)})` : ''}.</p>`;
  };
  const CORES = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  const CORES_LINHA = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

  function barras(mapa, cor) {
    const itens = L.frentes(mapa);
    if (!itens.length) return '<p class="vazio">Nenhum registro.</p>';
    const max = Math.max(1, ...itens.map(i => i[1]));
    return `<div class="barras">${itens.map(([k, v], i) => `<div class="barra"><span>${esc(L.nomeFrente(k))}</span><b class="num">${esc(n(v))}</b>
      <div class="tr"><i style="width:${Math.max(2, Math.round(100 * v / max))}%;background:var(${cor || CORES[i % CORES.length]})"></i></div></div>`).join('')}</div>`;
  }

  // ---------- Agora ----------
  function telaAgora(d) {
    const out = [];
    const f = d.fila;
    out.push(sec('Fila agora', 'fila', f ? `<div class="g2">${kpi('Aguardando', n(f.aguardando), '', f.aguardando > 0 ? 'destaque' : '')}${kpi('Em execução', n(f.executando), '', 'destaque')}</div>` : indisp('fila', d)));
    const e = d.execucao_frente;
    out.push(sec('Em execução por frente', 'exec', e ? `${kpi('Total em execução', n(e.TOTAL != null ? e.TOTAL : L.frentes(e).reduce((s, x) => s + x[1], 0)), '', 'destaque')}${barras(e)}` : indisp('execucao_frente', d)));
    const a = d.aguardando_frente;
    if (a == null || L.frentes(a).length) out.push(sec('Aguardando por frente', 'aguard', a ? barras(a, '--s3') : indisp('aguardando_frente', d)));
    const h = d.hoje_frente;
    out.push(sec('Hoje por frente', 'hoje', h ? `${kpi('Total de hoje', n(h.TOTAL != null ? h.TOTAL : L.frentes(h).reduce((s, x) => s + x[1], 0)), '', 'destaque')}${barras(h)}` : indisp('hoje_frente', d)));
    const r = d.rede_magic;
    out.push(sec('Rede hoje (Magic)', 'rede', r ? redeMagic(r) : indisp('rede_magic', d)));
    return out.join('');
  }

  function redeMagic(r) {
    const itens = Object.entries(r);
    if (!itens.length) return '<p class="vazio">Nenhum registro.</p>';
    const tot = itens.reduce((s, x) => s + x[1], 0) || 1;
    return `<div class="g2">${itens.map(([k, v]) => kpi(k, n(v), `${esc(pct(100 * v / tot))} do total`)).join('')}</div>`;
  }

  // ---------- Acertos ----------
  const hhmmBloco = b => String(b || '').slice(11, 16);

  function colunasSvg(pontos) {
    const w = 340, h = 150, g = G.colunas(pontos, w, h);
    const sel = ESTADO.serieSel != null && ESTADO.serieSel < pontos.length ? ESTADO.serieSel : null;
    const eixo = pontos.map((p, i) => ({ i, hhmm: hhmmBloco(p[0]) })).filter(x => /^(00|04|08|12|16|20):00$/.test(x.hhmm));
    return `<svg class="graf" id="graf-serie" viewBox="0 0 ${w} ${h}" role="img" aria-label="Acertos e erros por bloco de 15 minutos">
      ${g.grade.map(l => `<line x1="${g.x0}" x2="${g.x1}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${g.x0 - 3}" y="${(l.y + 3).toFixed(1)}" text-anchor="end">${l.v}</text>`).join('')}
      ${g.barras.map(b => `<rect x="${b.x.toFixed(1)}" y="${b.ya.toFixed(1)}" width="${b.larg.toFixed(1)}" height="${Math.max(0, b.ha).toFixed(1)}" fill="var(--ok2)" opacity="${sel == null || sel === b.i ? 1 : 0.45}"/>
        <rect x="${b.x.toFixed(1)}" y="${b.ye.toFixed(1)}" width="${b.larg.toFixed(1)}" height="${Math.max(0, b.he).toFixed(1)}" fill="var(--bad2)" opacity="${sel == null || sel === b.i ? 1 : 0.45}"/>`).join('')}
      ${eixo.map(x => `<text x="${(g.x0 + g.slot * (x.i + 0.5)).toFixed(1)}" y="${g.y0 + 11}" text-anchor="middle">${x.hhmm.slice(0, 2)}h</text>`).join('')}
    </svg>`;
  }

  function telaAcertos(d) {
    const out = [];
    const series = d.series || {};
    const chaves = Object.keys(series);
    if (!chaves.length) { out.push(sec('Acertos e erros', 'serie', indisp('series', d))); }
    else {
      if (!ESTADO.frente || !series[ESTADO.frente]) ESTADO.frente = chaves[0];
      const pontos = series[ESTADO.frente] || [];
      const r = L.resumoSerie(pontos);
      const chips = `<div class="chips-f" role="group" aria-label="Frente">${chaves.map(k => `<button type="button" data-frente="${esc(k)}" aria-pressed="${k === ESTADO.frente}">${esc(L.nomeFrente(k))}</button>`).join('')}</div>`;
      const sel = ESTADO.serieSel != null ? pontos[ESTADO.serieSel] : null;
      out.push(sec('Acertos e erros (24 h)', 'serie', `${chips}
        <div class="g3">${kpi('Acertos', n(r.acertos), '', 'ok')}${kpi('Erros', n(r.erros), '', r.erros > 0 ? 'bad' : '')}${kpi('% acerto', pct(r.pct), `${esc(n(r.total))} execuções`)}</div>
        ${pontos.length ? colunasSvg(pontos) : '<p class="vazio">Nenhuma execução nas últimas 24 h.</p>'}
        ${pontos.length ? `<div class="leg2"><span><i style="background:var(--ok2)"></i>Acertos</span><span><i style="background:var(--bad2)"></i>Erros</span></div>
        <div class="leit" id="leit-serie">${sel ? `<b>${esc(hhmmBloco(sel[0]))}</b> · acertos ${esc(n(sel[1]))} · erros ${esc(n(sel[2]))}` : '<span class="toque">Toque numa coluna para ver o horário.</span>'}</div>` : ''}`));
    }
    out.push(telaAcompanhamento(d));
    return out.join('');
  }

  function telaAcompanhamento(d) {
    const a = d.acompanhamento;
    if (!a) return sec('Acompanhamento do dia', 'acomp', indisp('acompanhamento', d));
    if (!a.linhas.length) return sec('Acompanhamento do dia', 'acomp', '<p class="vazio">Nenhuma execução hoje.</p>');
    const nomes = a.colunas.slice(1), rot = a.linhas.map(l => l[0]);
    const series = nomes.map((nm, j) => ({ k: nm, valores: a.linhas.map(l => l[j + 1]) }));
    // primeira vez: só as 4 frentes de maior volume (nove linhas juntas não se leem). O total e as demais ficam na legenda.
    if (!ESTADO.acompIni) {
      ESTADO.acompIni = true;
      const vol = series.map(s => ({ k: s.k, v: s.valores.reduce((t, x) => t + (x || 0), 0) })).filter(x => x.k !== 'total').sort((x, y) => y.v - x.v);
      const top = new Set(vol.slice(0, 4).filter(x => x.v > 0).map(x => x.k));
      nomes.forEach(k => { ESTADO.acompOff[k] = !top.has(k); });
    }
    const w = 340, h = 150, g = G.linhas(rot, series, ESTADO.acompOff, w, h);
    const frentesNomes = nomes.filter(k => k !== 'total');
    const cor = k => `var(${k === 'total' ? '--ink2' : CORES_LINHA[frentesNomes.indexOf(k) % CORES_LINHA.length]})`;
    const sel = ESTADO.acompSel != null && ESTADO.acompSel < rot.length ? ESTADO.acompSel : null;
    const eixo = rot.map((t, i) => ({ i, hhmm: hhmmBloco(t) })).filter(x => /^(00|04|08|12|16|20):00$/.test(x.hhmm));
    const svg = `<svg class="graf" id="graf-acomp" viewBox="0 0 ${w} ${h}" role="img" aria-label="Execuções do dia por frente">
      ${g.grade.map(l => `<line x1="${g.x0}" x2="${g.x1}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${g.x0 - 3}" y="${(l.y + 3).toFixed(1)}" text-anchor="end">${l.v}</text>`).join('')}
      ${g.linhas.map(l => `<polyline points="${l.pontos}" fill="none" stroke="${cor(l.k)}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      ${sel != null ? `<line x1="${g.X(sel).toFixed(1)}" x2="${g.X(sel).toFixed(1)}" y1="${g.y1}" y2="${g.y0}" stroke="var(--ink3)" stroke-dasharray="3 3"/>` : ''}
      ${eixo.map(x => `<text x="${g.X(x.i).toFixed(1)}" y="${g.y0 + 11}" text-anchor="middle">${x.hhmm.slice(0, 2)}h</text>`).join('')}
    </svg>`;
    const leg = `<div class="leg" role="group" aria-label="Linhas">${nomes.map(k => `<button type="button" data-acomp="${esc(k)}" aria-pressed="${!ESTADO.acompOff[k]}"><i style="background:${cor(k)}"></i>${esc(k === 'total' ? 'Total' : L.nomeFrente(k))}</button>`).join('')}</div>`;
    const linha = sel != null ? a.linhas[sel] : null;
    const leit = `<div class="leit" id="leit-acomp">${linha ? `<b>${esc(hhmmBloco(linha[0]))}</b> · ${nomes.map((k, j) => `${esc(k === 'total' ? 'total' : L.nomeFrente(k))} ${esc(n(linha[j + 1]))}`).join(' · ')}` : '<span class="toque">Toque no gráfico para ver o horário.</span>'}</div>`;
    const totais = nomes.map((k, j) => ({ k, v: a.linhas.reduce((s, l) => s + (l[j + 1] || 0), 0) }));
    const lista = `<div class="chips">${totais.map(t => `<div class="c"><span>${esc(t.k === 'total' ? 'Total do dia' : L.nomeFrente(t.k))}</span><b class="num">${esc(n(t.v))}</b></div>`).join('')}</div>`;
    return sec('Acompanhamento do dia', 'acomp', `${lista}${svg}${leg}${leit}`);
  }

  // ---------- Saúde ----------
  function medidor(nome, valor, legenda) {
    const nv = L.nivelUso(valor);
    return `<div class="med"><div class="med-t"><span>${esc(nome)}</span><b class="num ${nv}">${esc(pct(valor))}</b></div>
      <div class="tr"><i class="${nv}" style="width:${valor == null ? 0 : Math.min(100, Math.max(1, valor))}%"></i></div>${legenda ? `<small>${legenda}</small>` : ''}</div>`;
  }

  function cartaoBanco(nome, b) {
    if (!b) return `<div class="banco"><h4>${esc(nome)}</h4><p class="vazio">Indisponível nesta coleta.</p></div>`;
    const uso = b.max > 0 ? 100 * b.total / b.max : null;
    const estados = b.estados_completos && b.estados
      ? `<div class="chips">${Object.entries(b.estados).map(([k, v]) => `<div class="c"><span>${esc(k)}</span><b class="num">${esc(n(v))}</b></div>`).join('')}</div>`
      : '<small class="toque">Divisão por estado indisponível (o usuário de leitura não enxerga todas as sessões).</small>';
    return `<div class="banco"><h4>${esc(nome)}</h4>${medidor('Conexões', uso, `${esc(n(b.total))} de ${esc(n(b.max))}`)}${estados}</div>`;
  }

  function telaSaude(d) {
    const out = [];
    const b = d.bancos;
    out.push(sec('Bancos de dados', 'banco', b ? cartaoBanco('Banco da API (162)', b.b162) + cartaoBanco('Banco de operação (242)', b.b242) : indisp('bancos', d)));
    const h = d.hardware;
    if (!h) { out.push(sec('Máquina da API (162)', 'maquina', indisp('hardware', d))); return out.join(''); }
    const corpo = `<div class="g2 med2">${medidor('CPU', h.cpu_pct)}${medidor('Memória', h.mem_pct, h.mem_total != null ? `${esc(L.fmtBytes(h.mem_usada))} de ${esc(L.fmtBytes(h.mem_total))}` : '')}</div>
      <div class="g2">${kpi('Ligada há', h.uptime_s != null ? L.fmtDuracao(h.uptime_s) : '—', '')}${kpi('Carga (1 min)', h.load1 != null ? String(h.load1).replace('.', ',') : '—', '')}</div>
      ${(h.discos || []).length ? `<h4>Discos</h4>${h.discos.map(x => medidor(x.ponto, x.pct, `${esc(L.fmtBytes(x.usado))} de ${esc(L.fmtBytes(x.total))}`)).join('')}` : ''}`;
    out.push(sec('Máquina da API (162)', 'maquina', corpo));
    return out.join('');
  }

  // ---------- telas ----------
  function telaAviso(titulo, texto, comHub) {
    $('areas').hidden = true;
    $('sub').innerHTML = '';
    $('conteudo').innerHTML = `<div class="aviso-tela"><div class="ic" aria-hidden="true">✅</div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      ${comHub ? `<a class="bt" href="${esc(HUB_URL)}">Abrir o HUB</a>` : '<button type="button" class="bt" id="btTentar">Tentar de novo</button>'}</div>`;
    const t = $('btTentar');
    if (t) t.onclick = () => carregar();
    $('rodape').textContent = 'v' + APP_VERSION;
  }

  function desenhar() {
    if (!dados) return;
    const d = dados, s = L.situacao(d, new Date());
    $('sub').innerHTML = `<span class="vivo${s.nivel === 'ok' ? '' : ' parado'}" aria-hidden="true"></span> Coleta às ${esc(horaDe(d.coletado_em))}`;
    const seg = $('areas');
    seg.hidden = false;
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.area === area)));
    const faixa = s.nivel === 'ok' ? '' : `<div class="faixa ${s.nivel}" role="status">${esc(s.texto)}</div>`;
    const falhas = d.parciais && Object.keys(d.parciais).length
      ? `<div class="faixa" role="status">Alguns números não vieram nesta coleta: ${Object.keys(d.parciais).map(esc).join(', ')}.</div>` : '';
    const y = window.scrollY;
    $('conteudo').innerHTML = faixa + (area === 'agora' ? falhas : '') + (area === 'agora' ? telaAgora(d) : area === 'acertos' ? telaAcertos(d) : telaSaude(d));
    window.scrollTo(0, y);
    $('rodape').textContent = `v${APP_VERSION}` + (cred && cred.matricula ? ` · entrou pelo HUB (${cred.matricula})` : '');
  }

  function aoTocar(ev) {
    const i = ev.target.closest('[data-info]');
    if (i) { const k = i.dataset.info; abertos[k] = !abertos[k]; i.setAttribute('aria-expanded', String(abertos[k])); $('i-' + k).hidden = !abertos[k]; return; }
    const fr = ev.target.closest('[data-frente]');
    if (fr) { ESTADO.frente = fr.dataset.frente; ESTADO.serieSel = null; desenhar(); return; }
    const ac = ev.target.closest('[data-acomp]');
    if (ac) { const k = ac.dataset.acomp; ESTADO.acompOff[k] = !ESTADO.acompOff[k]; desenhar(); return; }
    const gs = ev.target.closest('#graf-serie');
    if (gs && dados && dados.series && dados.series[ESTADO.frente]) {
      const r = gs.getBoundingClientRect(), p = dados.series[ESTADO.frente];
      const x = (ev.clientX - r.left) / r.width * 340;
      ESTADO.serieSel = G.indiceDoToque(x, 30, 336, p.length);
      desenhar();
      return;
    }
    const ga = ev.target.closest('#graf-acomp');
    if (ga && dados && dados.acompanhamento) {
      const r = ga.getBoundingClientRect(), N = dados.acompanhamento.linhas.length;
      const x = (ev.clientX - r.left) / r.width * 340;
      ESTADO.acompSel = Math.max(0, Math.min(N - 1, Math.round((x - 30) / (334 - 30) * (N - 1))));
      desenhar();
    }
  }

  // ---------- início ----------
  function iniciar() {
    $('btHub').href = HUB_URL;
    $('btAtualizar').onclick = () => carregar();
    $('conteudo').addEventListener('click', aoTocar);
    $('areas').querySelectorAll('button').forEach(b => { b.onclick = () => { area = b.dataset.area; desenhar(); window.scrollTo(0, 0); }; });
    if (K.VERSAO !== APP_VERSION) {         // arquivos de versões diferentes no cache: atualiza antes de abrir
      telaAviso('Atualizando', 'Uma versão nova do app chegou. Recarregando…', false);
      setTimeout(() => location.reload(), 1500);
      return;
    }
    carregar();
    setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, CONFERIR_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') carregar(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.CKAApp = { APP_VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
