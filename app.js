/* Serviços — telas.
 *
 * Fluxo: credencial do HUB neste aparelho -> baixa o dados.json (sempre da rede; cópia cifrada no cache para abrir sem
 * rede) -> abre com cripto.js -> desenha. Confere de novo a cada 2 minutos com o app aberto e ao voltar para ele (o
 * coletor grava a cada 5 min). Nada aberto é guardado no aparelho: só o dados.json cifrado.
 *
 * Seis áreas, trocadas no topo: Agora (fila e frentes do Checklist VLAN), Acertos (acertos e erros por frente, acompanhamento do dia), Saúde
 * (bancos e máquina da API), Eventos (alertas abertos e histórico de 7 dias), Magic (VLAN, PSA e TV de hoje e o comparativo com os dias
 * anteriores) e Manobra (o dia de hoje por frente: humano, robô e os dois juntos). O sino liga o aviso no celular (push.js) e o botão
 * de compartilhar gera uma imagem (cartao.js) para o WhatsApp e o Teams. A atualização é automática, no intervalo que a pessoa
 * escolher (padrão 1 min), com contador. Os números vêm prontos do MAPI/coletor: este app só apresenta. Um bloco que falhou na
 * coleta não vem (nome em `parciais`) e aparece como indisponível; o resto segue.
 */
(function () {
  'use strict';

  const APP_VERSION = '1.4.0';
  const CHAVE_AUTO = 'co-checklist-auto';          // intervalo escolhido neste aparelho (segundos; 0 = manual)
  const MARCA_PUSH = 'co-checklist-push';          // última inscrição entregue ao MAPI (localStorage): não reenviar à toa
  const HUB_URL = new URL('/', location.href).href;
  // aberto dentro do "HUB de Apps" do MAPI (?mapi): sem login do HUB, sem baixar o dados.json, sem service worker; os dados vêm do MAPI por mensagem
  const MODO_MAPI = window.parent !== window && new URLSearchParams(location.search).has('mapi');
  const CACHE_DADOS = 'co-checklist-dados';        // última cópia (CIFRADA) do dados.json, para abrir sem rede

  const G = window.CKAGrafico, K = window.CKACripto, L = window.CKALogica, P = window.CKAPush, C = window.CKACartao, S = window.CKAServicos;
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

  let dados = null, cred = null, gerado = null, pushCtx = null;
  let area = 'agora';
  const abertos = {};                      // ⓘ abertos (sobrevivem ao redesenho)
  const ESTADO = { frente: null, serieSel: null, acompOff: {}, acompSel: null, acompIni: false, mgFrente: 'vlan', mgCat: null, mgSel: null, manSel: null };

  const INFO = {
    fila: 'Checklists na fila agora: os que aguardam para começar e os que estão em execução.',
    exec: 'Checklists em execução agora, por frente de atividade.',
    aguard: 'Checklists aguardando agora, por frente de atividade.',
    hoje: 'Checklists registrados hoje, por frente de atividade (a mesma conta do painel "Frente de Atividade - HOJE" do Grafana).',
    rede: 'Checklists do Magic registrados, por rede (VIVO1 e VIVO2).',
    serie: 'Acertos e erros em blocos de 15 min, nas últimas 24 h, só das execuções finalizadas. % de acerto = acertos ÷ (acertos + erros). Toque numa coluna para ver o horário.',
    acomp: 'Execuções do dia por frente, em blocos de 15 min (conta tudo do dia, não só as finalizadas). Toque no gráfico para ver o horário; toque na legenda para esconder uma linha.',
    banco: 'Conexões abertas agora no banco e o limite. A divisão entre ativas e ociosas só aparece quando o usuário de leitura enxerga todas as sessões.',
    eventos: 'Um evento abre quando uma medida (CPU, memória, disco, conexões dos bancos, situação do coletor) fica acima do limite por algumas coletas seguidas, e fecha quando volta ao normal. O histórico guarda os últimos 7 dias. Quem liga o sino recebe aviso na abertura e quando volta ao normal.',
    manobra: 'A Manobra de hoje, direto do banco de operação, com a mesma regra do NS: o dia é o da solicitação; "em N min" são as atendidas em até N minutos; NS = em N min ÷ atendidas. Humano = atendimento de uma pessoa; robô = automação. "Manobras realizadas pelo robô" = as que o robô finalizou como "Manobra realizada" (% do total de solicitações do dia); "Resolveu sozinho" = realizadas ÷ solicitações do robô. "Aguardando agora" são as solicitações de hoje ainda sem atribuição.',
    manobra_serie: 'Solicitações de hoje por bloco de 15 min, empilhadas (humano embaixo, robô em cima). Toque numa coluna para ver o horário.',
    mg_vlan: 'Execuções do Magic de hoje (VLAN) por resultado: corrigido, sem falhas ou falha na execução. O total conta também as demais (duplicado, já registrado).',
    mg_psa: 'Validações de carga do PSA de hoje, por situação (as mesmas contas do dashboard MAGIC do Grafana). Um mesmo registro pode contar em mais de uma linha.',
    mg_tv: 'Validações de TV de hoje: corrigido, sem falhas e quem não digitou a atividade.',
    mg_comp: 'Compara hoje com o mesmo dia da semana, 7, 14 e 21 dias atrás, em blocos de 15 min. A tabela soma cada dia só até a hora de agora, para a comparação ser justa. Escolha a frente e a categoria acima.',
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

  // ---------- modo MAPI ----------
  // O app avisa `co-checklist:pronto` (só o aviso, sem dado algum) e o MAPI responde `co-checklist:dados` com o conteúdo já aberto, a
  // quem tem o app liberado para a matrícula. Cada atualização automática repete o pedido. Só vale a mensagem da janela pai.
  let esperaMapi = null;
  function pedirAoMapi() {
    clearTimeout(esperaMapi);
    window.parent.postMessage({ tipo: 'co-checklist:pronto', versao: APP_VERSION }, '*');
    if (!dados) esperaMapi = setTimeout(() => { if (!dados) telaAviso('O MAPI não respondeu', 'Volte e abra o app de novo pelo HUB de Apps do MAPI.', false); }, 20000);
  }
  function receberDoMapi(e) {
    if (e.source !== window.parent || !e.data || e.data.tipo !== 'co-checklist:dados') return;
    clearTimeout(esperaMapi);
    const d = e.data.dados;
    if (e.data.erro || !d || d.v !== 1) { if (!dados) telaAviso('Não deu para abrir', e.data.erro ? String(e.data.erro) : 'O MAPI mandou dados em formato desconhecido.', false); return; }
    dados = d; gerado = null; pushCtx = null; cred = null;
    marcarOffline(false); reiniciarContagem(); desenhar();
  }

  async function carregar() {
    if (MODO_MAPI) return pedirAoMapi();
    cred = await K.lerCredHub();
    if (!cred) { dados = null; pushCtx = null; sino(); await apagarCopia(); return telaAviso('Entre pelo HUB',
      'Este app abre com o login do HUB dos apps. Entre no HUB com sua matrícula e chave e toque no atalho do Serviços.', true); }
    let pacote;
    try { pacote = await baixar(); }
    catch (e) {
      if (dados) return marcarOffline(true);
      return telaAviso(e.code === 'sem_dados' ? 'Sem dados ainda' : 'Sem conexão', e.message, false);
    }
    reiniciarContagem();
    const doCache = !!pacote.__cache;
    if (pacote.gerado_em && pacote.gerado_em === gerado && dados) { marcarOffline(doCache); return desenhar(); }
    try {
      dados = await K.abrir(pacote, cred);
      gerado = pacote.gerado_em || null;
      pushCtx = await K.extrasPush(pacote, cred);
    } catch (e) {
      if (e.code === 'sem_acesso') {
        dados = null; pushCtx = null; await apagarCopia();
        try { await P.desinscrever(await navigator.serviceWorker.getRegistration()); } catch (x) { /* segue */ }
        sino();
        return telaAviso('Sem acesso', e.message, true);
      }
      return telaAviso('Não deu para abrir', e.message, false);
    }
    marcarOffline(doCache);
    desenhar();
    sino(true);
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
    const sel = ESTADO.serieSel;                              // bloco (0..95) escolhido pelo toque
    const op = b => (sel == null || sel === b.slot ? 1 : 0.45);
    return `<svg class="graf" id="graf-serie" viewBox="0 0 ${w} ${h}" role="img" aria-label="Acertos e erros por bloco de 15 minutos">
      ${g.grade.map(l => `<line x1="${g.x0}" x2="${g.x1}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${g.x0 - 3}" y="${(l.y + 3).toFixed(1)}" text-anchor="end">${l.v}</text>`).join('')}
      ${g.barras.map(b => `<rect x="${b.x.toFixed(1)}" y="${b.ya.toFixed(1)}" width="${b.larg.toFixed(1)}" height="${Math.max(0, b.ha).toFixed(1)}" fill="var(--ok2)" opacity="${op(b)}"/>
        <rect x="${b.x.toFixed(1)}" y="${b.ye.toFixed(1)}" width="${b.larg.toFixed(1)}" height="${Math.max(0, b.he).toFixed(1)}" fill="var(--bad2)" opacity="${op(b)}"/>`).join('')}
      ${sel != null ? `<line x1="${(g.x0 + g.slot * (sel + 0.5)).toFixed(1)}" x2="${(g.x0 + g.slot * (sel + 0.5)).toFixed(1)}" y1="${g.y1}" y2="${g.y0}" stroke="var(--ink3)" stroke-dasharray="3 3"/>` : ''}
      ${g.marcas.map(m => `<text x="${m.x.toFixed(1)}" y="${g.y0 + 11}" text-anchor="middle">${m.hh}</text>`).join('')}
    </svg>`;
  }

  // leitura do bloco tocado: o horário vale mesmo sem execução (o coletor só manda os blocos com execução)
  function leituraSerie(pontos) {
    if (ESTADO.serieSel == null) return '<span class="toque">Toque numa coluna para ver o horário.</span>';
    const g = G.colunas(pontos, 340, 150), b = g.barras.find(x => x.slot === ESTADO.serieSel), hh = g.horaDoSlot(ESTADO.serieSel);
    return b ? `<b>${esc(hh)}</b> · acertos ${esc(n(pontos[b.i][1]))} · erros ${esc(n(pontos[b.i][2]))}` : `<b>${esc(hh)}</b> · sem execuções neste bloco`;
  }

  // acompanhamento: blocos de 15 min sem execução entram com zero (a linha não "pula" o horário)
  const completarAcomp = a => G.completar(a.linhas, a.colunas.length - 1);

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
      out.push(sec('Acertos e erros (24 h)', 'serie', `${chips}
        <div class="g3">${kpi('Acertos', n(r.acertos), '', 'ok')}${kpi('Erros', n(r.erros), '', r.erros > 0 ? 'bad' : '')}${kpi('% acerto', pct(r.pct), `${esc(n(r.total))} execuções`)}</div>
        ${pontos.length ? colunasSvg(pontos) : '<p class="vazio">Nenhuma execução nas últimas 24 h.</p>'}
        ${pontos.length ? `<div class="leg2"><span><i style="background:var(--ok2)"></i>Acertos</span><span><i style="background:var(--bad2)"></i>Erros</span></div>
        <div class="leit" id="leit-serie">${leituraSerie(pontos)}</div>` : ''}`));
    }
    out.push(telaAcompanhamento(d));
    return out.join('');
  }

  function telaAcompanhamento(d) {
    const a = d.acompanhamento;
    if (!a) return sec('Acompanhamento do dia', 'acomp', indisp('acompanhamento', d));
    if (!a.linhas.length) return sec('Acompanhamento do dia', 'acomp', '<p class="vazio">Nenhuma execução hoje.</p>');
    const nomes = a.colunas.slice(1), linhasC = completarAcomp(a), rot = linhasC.map(l => l[0]);
    const series = nomes.map((nm, j) => ({ k: nm, valores: linhasC.map(l => l[j + 1]) }));
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
    const linha = sel != null ? linhasC[sel] : null;
    const leit = `<div class="leit" id="leit-acomp">${linha ? `<b>${esc(hhmmBloco(linha[0]))}</b> · ${nomes.map((k, j) => `${esc(k === 'total' ? 'total' : L.nomeFrente(k))} ${esc(n(linha[j + 1]))}`).join(' · ')}` : '<span class="toque">Toque no gráfico para ver o horário.</span>'}</div>`;
    const totais = nomes.map((k, j) => ({ k, v: linhasC.reduce((s, l) => s + (l[j + 1] || 0), 0) }));
    const lista = `<div class="chips">${totais.map(t => `<div class="c"><span>${esc(t.k === 'total' ? 'Total do dia' : L.nomeFrente(t.k))}</span><b class="num">${esc(n(t.v))}</b></div>`).join('')}</div>`;
    return sec('Acompanhamento do dia', 'acomp', `${lista}${svg}${leg}${leit}`);
  }

  // ---------- Manobra (hoje) ----------
  const hojeISO = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const ddmm = iso => (iso || '').length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—';
  const tempo = seg => seg == null ? '—' : seg < 60 ? `${seg} s` : L.fmtDuracao(seg);

  // colunas empilhadas (humano embaixo, robô em cima) reaproveitando G.colunas: [bloco, humano, robô]
  function colunasManobra(pontos) {
    const w = 340, h = 150, g = G.colunas(pontos, w, h), sel = ESTADO.manSel;
    const op = b => (sel == null || sel === b.slot ? 1 : 0.45);
    return `<svg class="graf" id="graf-man" viewBox="0 0 ${w} ${h}" role="img" aria-label="Solicitações da Manobra por bloco de 15 minutos, humano e robô">
      ${g.grade.map(l => `<line x1="${g.x0}" x2="${g.x1}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${g.x0 - 3}" y="${(l.y + 3).toFixed(1)}" text-anchor="end">${l.v}</text>`).join('')}
      ${g.barras.map(b => `<rect x="${b.x.toFixed(1)}" y="${b.ya.toFixed(1)}" width="${b.larg.toFixed(1)}" height="${Math.max(0, b.ha).toFixed(1)}" fill="var(--hum)" opacity="${op(b)}"/>
        <rect x="${b.x.toFixed(1)}" y="${b.ye.toFixed(1)}" width="${b.larg.toFixed(1)}" height="${Math.max(0, b.he).toFixed(1)}" fill="var(--rob)" opacity="${op(b)}"/>`).join('')}
      ${sel != null ? `<line x1="${(g.x0 + g.slot * (sel + 0.5)).toFixed(1)}" x2="${(g.x0 + g.slot * (sel + 0.5)).toFixed(1)}" y1="${g.y1}" y2="${g.y0}" stroke="var(--ink3)" stroke-dasharray="3 3"/>` : ''}
      ${g.marcas.map(m => `<text x="${m.x.toFixed(1)}" y="${g.y0 + 11}" text-anchor="middle">${m.hh}</text>`).join('')}
    </svg>`;
  }

  function leituraManobra(pontos) {
    if (ESTADO.manSel == null) return '<span class="toque">Toque numa coluna para ver o horário.</span>';
    const g = G.colunas(pontos, 340, 150), b = g.barras.find(x => x.slot === ESTADO.manSel), hh = g.horaDoSlot(ESTADO.manSel);
    return b ? `<b>${esc(hh)}</b> · humano ${esc(n(pontos[b.i][1]))} · robô ${esc(n(pontos[b.i][2]))}` : `<b>${esc(hh)}</b> · sem solicitações neste bloco`;
  }

  // robô dentro do card da Manobra: manobras que ele realizou, quanto resolveu sozinho e (recolhida) a tabela dos últimos dias
  function blocoRobo(R) {
    const h = R.hoje, p = v => esc(pct(v == null ? null : 100 * v));
    const chips = h
      ? `<div class="chips rb-chips">
          <div class="c"><span>Manobras realizadas pelo robô</span><b class="num">${esc(n(h.realizadas))}</b><small>${p(h.pctManobras)} do total</small></div>
          <div class="c"><span>Resolveu sozinho</span><b class="num">${p(h.resolve)}</b><small>realizadas ÷ solicitações do robô</small></div>
        </div>`
      : '';
    const linhas = R.dias.map(d => `<div class="rb-d">${esc(ddmm(d.dia))}</div><div>${esc(n(d.total))}</div><div>${esc(n(d.robo))}</div><div>${p(d.pctRobo)}</div><div>${esc(n(d.realizadas))}</div><div>${p(d.pctManobras)}</div>`).join('');
    return `<div class="rb-bloco">${chips}<details class="rb-dias"><summary>Robô nos últimos ${esc(R.dias.length)} dias</summary>
      <div class="rb-tab" role="table" aria-label="Robô na Manobra por dia">
        <div class="rb-h">Dia</div><div class="rb-h">Solicit.</div><div class="rb-h">Robô</div><div class="rb-h">% robô</div><div class="rb-h">Realiz.</div><div class="rb-h">% realiz.</div>${linhas}</div></details></div>`;
  }

  function telaManobra(d) {
    const X = S.manobra(d.manobra_hoje);
    if (!X) return sec('Manobra · hoje', 'manobra', indisp('manobra_hoje', d));
    const hoje = S.ehDeHoje(d.manobra_hoje, hojeISO());
    const aviso = hoje ? '' : `<div class="faixa" role="status">Estes números são de ${esc(ddmm(X.dia))}: ainda não há leitura de hoje.</div>`;
    const corte = X.corte;
    const linha = (rot, fn, cls) => `<div class="r ${cls || ''}">${esc(rot)}</div>` + ['t', 'h', 'r'].map(k => `<div class="c ${cls || ''}">${fn(X[k], k)}</div>`).join('');
    const nsTxt = f => f.ns == null ? '—' : pct(100 * f.ns);
    const pend = k => `${esc(n(X.pendentes[k]))}`;
    const barra = X.partes.h == null ? '' : `<div class="fr-bar" role="img" aria-label="Humano ${esc(pct(100 * X.partes.h))} e robô ${esc(pct(100 * X.partes.r))} das solicitações"><span class="h" style="width:${(X.partes.h * 100).toFixed(2)}%"></span><span class="r" style="width:${(X.partes.r * 100).toFixed(2)}%"></span></div>
      <div class="fr-leg"><span><i class="h"></i>Humano ${esc(pct(100 * X.partes.h))}</span><span><i class="r"></i>Robô ${esc(pct(100 * X.partes.r))}</span><small>das solicitações</small></div>`;
    const grade = `<div class="fr-grid" role="table" aria-label="Total, humano e robô"><div></div>${['Total', 'Humano', 'Robô'].map((t, i) => `<div class="h ${['tot', 'hum', 'rob'][i]}">${t}</div>`).join('')}
      ${linha(`NS ${corte} min`, f => `<b>${esc(nsTxt(f))}</b>`, 'ns')}${linha('Solicitações', f => esc(n(f.vol)))}${linha('Atendidas', f => esc(n(f.at)))}${linha(`Em ${corte} min`, f => esc(n(f.cor)))}
      <div class="r">Espera média</div><div class="c">${esc(tempo(X.espera.h != null || X.espera.r != null ? Math.round(((X.espera.h || 0) * X.h.at + (X.espera.r || 0) * X.r.at) / Math.max(1, X.t.at)) : null))}</div><div class="c">${esc(tempo(X.espera.h))}</div><div class="c">${esc(tempo(X.espera.r))}</div>
      <div class="r">Aguardando agora</div><div class="c">${esc(n(X.pendentes.h + X.pendentes.r))}</div><div class="c">${pend('h')}</div><div class="c">${pend('r')}</div>
      <div class="r">Espera mais antiga</div><div class="c">${esc(tempo(Math.max(X.espera_max_s.h || 0, X.espera_max_s.r || 0) || null))}</div><div class="c">${esc(tempo(X.espera_max_s.h || null))}</div><div class="c">${esc(tempo(X.espera_max_s.r || null))}</div></div>`;
    const R = S.robo(d.manobra_hoje, X);
    const out = [aviso];
    out.push(sec(`Manobra · hoje ${ddmm(X.dia)}`, 'manobra', `<div class="sub-man">Lido às ${esc(horaDe(X.gerado_em))} no banco de operação</div>${barra}${grade}${R ? blocoRobo(R) : ''}`));
    const pontos = S.manobraPontos(d.manobra_hoje);
    out.push(sec('Solicitações por bloco de 15 min', 'manobra_serie', pontos.length
      ? `${colunasManobra(pontos)}<div class="leg2"><span><i style="background:var(--hum)"></i>Humano</span><span><i style="background:var(--rob)"></i>Robô</span></div><div class="leit" id="leit-man">${leituraManobra(pontos)}</div>`
      : '<p class="vazio">Nenhuma solicitação hoje.</p>'));
    return out.join('');
  }

  // ---------- Magic ----------
  const COR_PERIODO = { HOJE: '--s1', D7: '--s2', D14: '--s3', D21: '--s4' };

  function kpisHoje(mapa, itens) {
    const tot = mapa.TOTAL != null ? mapa.TOTAL : null;
    return `<div class="g2">${itens.map(([chave, nome, cls]) => {
      const v = mapa[chave];
      const leg = chave === 'TOTAL' || v == null || !tot ? '' : `${esc(pct(S.parteDoTotal(v, tot)))} do total`;
      return kpi(nome, n(v), leg, cls || (chave === 'TOTAL' ? 'destaque' : ''));
    }).join('')}</div>`;
  }

  function graficoMagic(hist, cat, iso) {
    const w = 340, h = 150, rot = S.rotulosSlots();
    const series = S.seriesLinhas(hist, cat, iso);
    const g = G.linhas(rot, series, {}, w, h), sel = ESTADO.mgSel;
    const eixo = rot.map((t, i) => ({ i, t })).filter(x => /^(00|04|08|12|16|20):00$/.test(x.t));
    return `<svg class="graf" id="graf-mg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Comparativo do dia por bloco de 15 minutos">
      ${g.grade.map(l => `<line x1="${g.x0}" x2="${g.x1}" y1="${l.y.toFixed(1)}" y2="${l.y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/><text x="${g.x0 - 3}" y="${(l.y + 3).toFixed(1)}" text-anchor="end">${l.v}</text>`).join('')}
      ${g.linhas.slice().reverse().map(l => `<polyline points="${l.pontos}" fill="none" stroke="var(${COR_PERIODO[l.k]})" stroke-width="${l.k === 'HOJE' ? 2.6 : 1.5}" stroke-linejoin="round" stroke-linecap="round"${l.k === 'HOJE' ? '' : ' opacity=".8"'}/>`).join('')}
      ${sel != null ? `<line x1="${g.X(sel).toFixed(1)}" x2="${g.X(sel).toFixed(1)}" y1="${g.y1}" y2="${g.y0}" stroke="var(--ink3)" stroke-dasharray="3 3"/>` : ''}
      ${eixo.map(x => `<text x="${g.X(x.i).toFixed(1)}" y="${g.y0 + 11}" text-anchor="middle">${x.t.slice(0, 2)}h</text>`).join('')}
    </svg>`;
  }

  function leituraMagic(hist, cat) {
    if (ESTADO.mgSel == null) return '<span class="toque">Toque no gráfico para ver o horário.</span>';
    const rot = S.rotulosSlots()[ESTADO.mgSel];
    const partes = S.PERIODOS.filter(p => hist[p]).map(p => `${esc(S.NOME_PERIODO[p].toLowerCase())} ${esc(n(S.vetor(hist, p, cat)[ESTADO.mgSel]))}`);
    return `<b>${esc(rot)}</b> · ${partes.join(' · ')}`;
  }

  function secComparativo(d) {
    const nomeF = Object.fromEntries(S.FRENTES_MAGIC);
    const f = ESTADO.mgFrente;
    const hist = d['magic_' + f + '_hist'];
    const chipsF = `<div class="chips-f" role="group" aria-label="Frente do Magic">${S.FRENTES_MAGIC.map(([k, nome]) => `<button type="button" data-mgf="${k}" aria-pressed="${k === f}">${esc(nome)}</button>`).join('')}</div>`;
    if (!hist) return sec('Comparativo do dia', 'mg_comp', `${chipsF}${indisp('magic_' + f + '_hist', d)}`);
    const cats = S.categorias(hist);
    if (ESTADO.mgCat && !cats.includes(ESTADO.mgCat)) ESTADO.mgCat = null;
    const cat = ESTADO.mgCat;
    const chipsC = cats.length > 1 ? `<div class="chips-f" role="group" aria-label="Categoria"><button type="button" data-mgc="" aria-pressed="${cat == null}">Todas</button>${cats.map((c, i) => `<button type="button" data-mgc="${i}" aria-pressed="${c === cat}">${esc(c)}</button>`).join('')}</div>` : '';
    const cmp = S.comparativo(hist, cat, d.coletado_em);
        const linhas = cmp.map(x => `<tr><td><i class="pt" style="background:var(${COR_PERIODO[x.periodo]})"></i>${esc(x.nome)}</td><td class="num">${esc(n(x.total))}</td><td class="num">${x.difPct == null ? '—' : esc((x.difPct > 0 ? '+' : '') + pct(x.difPct))}</td></tr>`).join('');
    const leg = `<div class="leg2">${S.PERIODOS.filter(p => hist[p]).map(p => `<span><i style="background:var(${COR_PERIODO[p]})"></i>${esc(S.NOME_PERIODO[p])}</span>`).join('')}</div>`;
    const corpo = `${chipsF}${chipsC}${graficoMagic(hist, cat, d.coletado_em)}${leg}<div class="leit" id="leit-mg">${leituraMagic(hist, cat)}</div>
      <table class="mtab"><thead><tr><th>Até as ${esc(horaBloco(S.slotAgora(d.coletado_em)))}</th><th>Total</th><th>Hoje vs dia</th></tr></thead><tbody>${linhas}</tbody></table>`;
    return sec(`Comparativo do dia · ${nomeF[f]}`, 'mg_comp', corpo);
  }

  // fim do bloco de 15 min de agora (a comparação conta cada dia até aqui)
  const horaBloco = s => { if (s == null) return '—'; const m = Math.min(1439, (s + 1) * 15); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

  function telaMagic(d) {
    const out = [];
    const v = d.magic_vlan, p = d.magic_psa, t = d.magic_tv;
    out.push(sec('VLAN · hoje', 'mg_vlan', v ? kpisHoje(v, [['CORRIGIDO', 'Corrigido', 'ok'], ['SEM_FALHAS', 'Sem falhas'], ['FALHA_EXECUCAO', 'Falha na execução', v.FALHA_EXECUCAO > 0 ? 'bad' : ''], ['TOTAL', 'Total']]) : indisp('magic_vlan', d)));
    out.push(sec('PSA · hoje', 'mg_psa', p ? kpisHoje(p, [['CARGA_CORRIGIDA', 'Carga corrigida', 'ok'], ['CARGA_OK', 'Carga OK'], ['FALHA_AO_VALIDAR_CARGA', 'Falha ao validar carga', p.FALHA_AO_VALIDAR_CARGA > 0 ? 'bad' : ''],
      ['ATIVIDADE_INEXISTENTE', 'Atividade inexistente'], ['ATIVIDADE_NAO_INFORMADA', 'Atividade não informada'], ['WIFI_BLOQUEADO', 'Wifi bloqueado'], ['TOTAL', 'Total']]) : indisp('magic_psa', d)));
    out.push(sec('TV · hoje', 'mg_tv', t ? kpisHoje(t, [['CORRIGIDO', 'Corrigido', 'ok'], ['SEM_FALHAS', 'Sem falhas'], ['NAO_DIGITOU_ATIVIDADE', 'Não digitou atividade'], ['TOTAL', 'Total']]) : indisp('magic_tv', d)));
    out.push(secComparativo(d));
    return out.join('');
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

  // ---------- Eventos ----------
  const duracaoTxt = (e) => { const m = L.duracaoEvento(e, Date.now()); return m == null ? '—' : L.fmtDuracao(m * 60); };

  function cartaoEvento(e, aberto) {
    return `<div class="ev ${e.sev === 'critico' ? 'critico' : 'aviso'}${aberto ? ' aberto' : ''}">
      <div class="ev-t"><b>${esc(e.nome)}${e.chave ? ` · ${esc(e.chave)}` : ''}</b><span class="ev-s">${esc(L.rotuloSev(e.sev))}</span></div>
      <div class="ev-d">${esc(L.detalhePT(e.detalhe))}</div>
      <div class="ev-m">${aberto ? `desde ${esc(L.horaBR(e.aberto_em))} · há ${esc(duracaoTxt(e))} · pico ${esc(L.fmtPico(e))}`
        : e.regra === 'reinicio' ? `às ${esc(L.horaBR(e.aberto_em))} · evento pontual`
        : `${esc(L.horaBR(e.aberto_em))} → ${esc(L.horaBR(e.fechado_em))} · durou ${esc(duracaoTxt(e))} · pico ${esc(L.fmtPico(e))}`}</div></div>`;
  }

  function telaEventos(d) {
    const ev = L.eventosDe(d);
    if (!ev) return sec('Eventos', 'eventos', '<p class="vazio">Os alertas ainda não estão ligados no MAPI. Quando estiverem, os eventos aparecem aqui.</p>');
    const out = [];
    out.push(sec(`Abertos agora (${ev.abertos.length})`, 'eventos', ev.abertos.length
      ? `<div class="evs">${ev.abertos.map(e => cartaoEvento(e, true)).join('')}</div>` : '<p class="ok-vazio">✔ Nenhum evento aberto agora.</p>'));
    const grupos = L.porDia(ev.historico);
    out.push(sec(`Histórico (${ev.dias || 7} dias)`, null, grupos.length
      ? grupos.map(g => `<h4>${esc(g.dia)}</h4><div class="evs">${g.itens.map(e => cartaoEvento(e, false)).join('')}</div>`).join('')
      : '<p class="vazio">Nenhum evento fechado nos últimos 7 dias.</p>'));
    return out.join('');
  }

  // ---------- telas ----------
  function telaAviso(titulo, texto, comHub) {
    $('areas').hidden = true;
    $('auto').hidden = true;
    $('btCompartilhar').hidden = true;
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
    $('sub').innerHTML = `<span class="vivo${s.nivel === 'ok' ? '' : ' parado'}" aria-hidden="true"></span><span class="nw">Coleta às ${esc(horaDe(d.coletado_em))}</span>`;
    const seg = $('areas');
    seg.hidden = false;
    $('auto').hidden = false;
    $('btCompartilhar').hidden = false;
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.area === area)));
    const ev = L.eventosDe(d), nAb = ev ? ev.abertos.length : 0;
    $('btEventos').innerHTML = 'Eventos' + (nAb ? ` <span class="badge" aria-label="${nAb} aberto(s)">${nAb}</span>` : '');
    if (nAb) $('sub').innerHTML += `<button type="button" class="link-ev nw" id="lnkEv">⚠ ${nAb} evento${nAb > 1 ? 's' : ''} aberto${nAb > 1 ? 's' : ''}</button>`;
    const faixa = s.nivel === 'ok' ? '' : `<div class="faixa ${s.nivel}" role="status">${esc(s.texto)}</div>`;
    const falhas = d.parciais && Object.keys(d.parciais).length
      ? `<div class="faixa" role="status">Alguns números não vieram nesta coleta: ${Object.keys(d.parciais).map(esc).join(', ')}.</div>` : '';
    const y = window.scrollY;
    $('conteudo').innerHTML = faixa + (area === 'agora' ? falhas : '') + (area === 'agora' ? telaAgora(d) : area === 'acertos' ? telaAcertos(d) : area === 'eventos' ? telaEventos(d) : area === 'magic' ? telaMagic(d) : area === 'manobra' ? telaManobra(d) : telaSaude(d));
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
    const mf = ev.target.closest('[data-mgf]');
    if (mf) { ESTADO.mgFrente = mf.dataset.mgf; ESTADO.mgCat = null; ESTADO.mgSel = null; desenhar(); return; }
    const mc = ev.target.closest('[data-mgc]');
    if (mc) {
      const hist = dados && dados['magic_' + ESTADO.mgFrente + '_hist'];
      ESTADO.mgCat = mc.dataset.mgc === '' || !hist ? null : (S.categorias(hist)[Number(mc.dataset.mgc)] || null);
      desenhar();
      return;
    }
    const gm = ev.target.closest('#graf-mg');
    if (gm) { const r = gm.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * 340; ESTADO.mgSel = Math.max(0, Math.min(95, Math.round((x - 30) / (334 - 30) * 95))); desenhar(); return; }
    const gn = ev.target.closest('#graf-man');
    if (gn && dados && dados.manobra_hoje) {
      const r = gn.getBoundingClientRect();
      ESTADO.manSel = G.colunas(S.manobraPontos(dados.manobra_hoje), 340, 150).slotDoToque((ev.clientX - r.left) / r.width * 340);
      desenhar();
      return;
    }
    const gs = ev.target.closest('#graf-serie');
    if (gs && dados && dados.series && dados.series[ESTADO.frente]) {
      const r = gs.getBoundingClientRect();
      ESTADO.serieSel = G.colunas(dados.series[ESTADO.frente], 340, 150).slotDoToque((ev.clientX - r.left) / r.width * 340);
      desenhar();
      return;
    }
    const ga = ev.target.closest('#graf-acomp');
    if (ga && dados && dados.acompanhamento) {
      const r = ga.getBoundingClientRect(), N = completarAcomp(dados.acompanhamento).length;
      const x = (ev.clientX - r.left) / r.width * 340;
      ESTADO.acompSel = Math.max(0, Math.min(N - 1, Math.round((x - 30) / (334 - 30) * (N - 1))));
      desenhar();
    }
  }

  // ---------- atualização automática ----------
  let intervaloS = L.INTERVALO_PADRAO_S, ultimoCarregar = Date.now();
  const lerAuto = () => { try { return L.intervaloValido(localStorage.getItem(CHAVE_AUTO)); } catch (e) { return L.INTERVALO_PADRAO_S; } };
  const gravarAuto = v => { try { localStorage.setItem(CHAVE_AUTO, String(v)); } catch (e) { /* segue */ } };

  function reiniciarContagem() { ultimoCarregar = Date.now(); mostrarContagem(); }

  function mostrarContagem() {
    const r = L.segundosRestantes(ultimoCarregar, intervaloS, Date.now());
    $('prox').textContent = r == null ? 'só ao tocar em atualizar' : `próxima em ${L.fmtContagem(r)}`;
  }

  function tique() {
    if (document.visibilityState !== 'visible') return;       // escondido: não conta nem consulta (poupa bateria e a cota da Cloudflare)
    const r = L.segundosRestantes(ultimoCarregar, intervaloS, Date.now());
    if (r === 0) { ultimoCarregar = Date.now(); carregar(); }
    mostrarContagem();
  }

  // ---------- sino (aviso no celular) ----------
  const SINO_OFF = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M3 3l18 18"/>';
  const SINO_ON = '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
  const lerMarca = () => { try { return localStorage.getItem(MARCA_PUSH); } catch (e) { return null; } };
  const gravarMarca = v => { try { if (v) localStorage.setItem(MARCA_PUSH, v); else localStorage.removeItem(MARCA_PUSH); } catch (e) { /* segue */ } };
  const regSw = async () => ('serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.ready : null);

  // mostra o sino (só com push disponível) e, se já está ligado, reentrega a inscrição quando ela mudou
  async function sino(conferir) {
    const b = $('btSino');
    if (!P.disponivel(pushCtx && cred ? pushCtx : null)) { b.hidden = true; return; }
    let reg = null, sub = null;
    try { reg = await regSw(); sub = await P.inscricaoAtual(reg); } catch (e) { /* sem service worker */ }
    const ligado = !!sub && Notification.permission === 'granted';
    b.hidden = false;
    b.setAttribute('aria-pressed', String(ligado));
    b.setAttribute('aria-label', ligado ? 'Avisos ligados neste aparelho (tocar desliga)' : 'Ligar avisos neste aparelho');
    b.title = ligado ? 'Avisos ligados' : 'Ligar avisos';
    b.querySelector('svg').innerHTML = ligado ? SINO_ON : SINO_OFF;
    if (ligado && conferir) {
      try { gravarMarca(await P.registrar({ reg, chave: pushCtx.chave, segredo: pushCtx.segredo, cred, guardado: lerMarca() })); }
      catch (e) { /* tenta de novo na próxima conferência */ }
    }
  }

  async function alternarSino() {
    const b = $('btSino');
    const reg = await regSw();
    if (b.getAttribute('aria-pressed') === 'true') {
      await P.desinscrever(reg); gravarMarca(null);
      aviso('Avisos desligados neste aparelho.');
      return sino();
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { aviso('O navegador não deixou mostrar avisos. Libere as notificações do app nas configurações.'); return sino(); }
      gravarMarca(await P.registrar({ reg, chave: pushCtx.chave, segredo: pushCtx.segredo, cred, forcar: true }));
      aviso('Avisos ligados: você recebe quando algo sai do normal (CPU, memória, bancos, coletor) e quando volta.');
    } catch (e) { aviso(e.message || 'Não deu para ligar os avisos.'); }
    sino();
  }

  let avisoT = null;
  function aviso(txt) {
    const a = $('aviso');
    a.textContent = txt; a.hidden = false;
    clearTimeout(avisoT); avisoT = setTimeout(() => { a.hidden = true; }, 4500);
  }

  // ---------- compartilhar (imagem + texto) ----------
  const FC = { conteudo: 'tela', blob: null, url: null, texto: '' };

  function planoDoConteudo() {
    const area = FC.conteudo === 'completo' ? 'completo' : area_();
    return C.montar(dados, { area, frente: ESTADO.frente, agora: Date.now() });
  }
  const area_ = () => ['agora', 'acertos', 'saude', 'eventos', 'magic', 'manobra'].includes(area) ? area : 'agora';

  async function gerarImagem() {
    $('fcMsg').textContent = 'Gerando a imagem…';
    FC.texto = L.textoCompartilhar(dados, Date.now());
    const plano = planoDoConteudo();
    const cv = document.createElement('canvas');
    C.renderizar(cv, plano, 2);                                            // 2160 px de largura: nítida mesmo ampliada
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (FC.url) URL.revokeObjectURL(FC.url);
    FC.blob = blob; FC.url = blob ? URL.createObjectURL(blob) : null;
    $('fcImg').src = FC.url || '';
    $('fcMsg').textContent = blob ? 'No celular, toque em Compartilhar imagem e escolha o WhatsApp ou o Teams. No computador, use os botões do WhatsApp e do Teams (a imagem é copiada: cole com Ctrl+V na conversa).' : 'Não consegui gerar a imagem neste aparelho.';
  }

  const arquivo = () => new File([FC.blob], `servicos-${Date.now()}.png`, { type: 'image/png' });

  async function copiarImagem() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': FC.blob })]);
      return true;
    } catch (e) { return false; }
  }

  async function enviarSistema() {
    if (!FC.blob) return;
    const f = arquivo();
    try {
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Serviços', text: FC.texto }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { if (navigator.share) { await navigator.share({ title: 'Serviços', text: FC.texto }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    $('fcMsg').textContent = 'Este aparelho não compartilha imagem direto: use Copiar imagem ou Baixar.';
  }

  async function viaApp(destino) {
    if (!FC.blob) return;
    const copiou = await copiarImagem();
    const txt = encodeURIComponent(FC.texto);
    const url = destino === 'zap' ? `https://wa.me/?text=${txt}`
      : `https://teams.microsoft.com/share?href=${encodeURIComponent(location.origin + location.pathname)}&msgText=${txt}`;
    $('fcMsg').textContent = copiou ? 'Imagem copiada: na conversa que abriu, cole com Ctrl+V (ou segure e toque em Colar).' : 'Não consegui copiar a imagem: toque em Baixar e anexe o arquivo na conversa.';
    window.open(url, '_blank', 'noopener');
  }

  function baixarImagem() {
    if (!FC.url) return;
    const a = document.createElement('a');
    a.href = FC.url; a.download = `servicos-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function abrirFolha() {
    if (!dados) return;
    FC.conteudo = 'tela';                                    // sempre abre em "Esta tela"
    $('folha').querySelectorAll('[data-conteudo]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.conteudo === 'tela')));
    $('folha').hidden = false;
    $('folha').querySelector('[data-conteudo]').focus();
    await gerarImagem();
  }
  function fecharFolha() {
    $('folha').hidden = true;
    if (FC.url) { URL.revokeObjectURL(FC.url); FC.url = null; FC.blob = null; $('fcImg').removeAttribute('src'); }
  }

  // ---------- início ----------
  function iniciar() {
    $('btHub').href = HUB_URL;
    if (MODO_MAPI) { $('btHub').hidden = true; window.addEventListener('message', receberDoMapi); }
    $('btAtualizar').onclick = () => carregar();
    $('btSino').onclick = () => alternarSino();
    $('btCompartilhar').onclick = () => abrirFolha();
    $('fcFechar').onclick = fecharFolha;
    $('folha').addEventListener('click', ev => { if (ev.target.id === 'folha') fecharFolha(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('folha').hidden) fecharFolha(); });
    $('folha').querySelectorAll('[data-conteudo]').forEach(b => { b.onclick = () => {
      FC.conteudo = b.dataset.conteudo;
      $('folha').querySelectorAll('[data-conteudo]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      gerarImagem();
    }; });
    $('fcEnviar').onclick = enviarSistema;
    $('fcZap').onclick = () => viaApp('zap');
    $('fcTeams').onclick = () => viaApp('teams');
    $('fcCopiar').onclick = async () => { $('fcMsg').textContent = (await copiarImagem()) ? 'Imagem copiada.' : 'Este navegador não deixou copiar a imagem: use Baixar.'; };
    $('fcBaixar').onclick = baixarImagem;
    $('conteudo').addEventListener('click', aoTocar);
    $('sub').addEventListener('click', ev => { if (ev.target.closest('#lnkEv')) { area = 'eventos'; desenhar(); window.scrollTo(0, 0); } });
    $('areas').querySelectorAll('button').forEach(b => { b.onclick = () => { area = b.dataset.area; desenhar(); window.scrollTo(0, 0); }; });
    intervaloS = lerAuto();
    $('selAuto').value = String(intervaloS);
    $('selAuto').onchange = () => { intervaloS = L.intervaloValido($('selAuto').value); gravarAuto(intervaloS); reiniciarContagem(); };
    if (K.VERSAO !== APP_VERSION || (P && P.VERSAO !== APP_VERSION)) {   // arquivos de versões diferentes no cache: atualiza antes de abrir
      telaAviso('Atualizando', 'Uma versão nova do app chegou. Recarregando…', false);
      setTimeout(() => location.reload(), 1500);
      return;
    }
    carregar();
    setInterval(tique, 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { ultimoCarregar = Date.now(); carregar(); } });
    if (!MODO_MAPI && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.CKAApp = { APP_VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
