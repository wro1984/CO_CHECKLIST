const test = require('node:test');
const assert = require('node:assert');
const L = require('../logica.js');

const d = (hhmm, extra) => Object.assign({ coletado_em: `2026-11-12T${hhmm}:00-03:00`, limite_atraso_s: 900,
  programacao: { ativo: true, intervalo_min: 5, hora_inicio: '00:00', hora_fim: '23:59' } }, extra);
// "agora" em hora local do aparelho: monta a data local equivalente
const local = (h, m) => new Date(2026, 10, 12, h, m, 0);
const coletaLocal = (h, m, extra) => Object.assign({ coletado_em: new Date(2026, 10, 12, h, m).toISOString(), limite_atraso_s: 900,
  programacao: { ativo: true, intervalo_min: 5, hora_inicio: '00:00', hora_fim: '23:59' } }, extra);

test('coleta recente é normal', () => {
  const s = L.situacao(coletaLocal(15, 5), local(15, 8));
  assert.strictEqual(s.nivel, 'ok');
  assert.strictEqual(s.idade_min, 3);
});

test('atrasada passa do limite que o MAPI mandou', () => {
  assert.strictEqual(L.situacao(coletaLocal(15, 5), local(15, 20)).nivel, 'ok');            // 15 min = no limite
  const s = L.situacao(coletaLocal(15, 5), local(15, 21));
  assert.strictEqual(s.nivel, 'atraso');
  assert.match(s.texto, /há 16 min/);
});

test('sem limite no pacote usa 15 min', () => {
  const x = coletaLocal(15, 5); delete x.limite_atraso_s;
  assert.strictEqual(L.situacao(x, local(15, 19)).nivel, 'ok');
  assert.strictEqual(L.situacao(x, local(15, 25)).nivel, 'atraso');
});

test('coleta desligada ou fora da janela não é atraso', () => {
  const desl = coletaLocal(15, 5, { programacao: { ativo: false, intervalo_min: 5, hora_inicio: '00:00', hora_fim: '23:59' } });
  assert.strictEqual(L.situacao(desl, local(20, 0)).nivel, 'info');
  assert.match(L.situacao(desl, local(20, 0)).texto, /desligada/);
  const jan = coletaLocal(21, 55, { programacao: { ativo: true, intervalo_min: 5, hora_inicio: '07:00', hora_fim: '22:00' } });
  const noite = L.situacao(jan, local(23, 30));
  assert.strictEqual(noite.nivel, 'info');
  assert.match(noite.texto, /07:00–22:00/);
});

test('janela que passa da meia-noite', () => {
  const p = { ativo: true, hora_inicio: '22:00', hora_fim: '06:00' };
  assert.ok(L.naJanela(p, local(23, 0)));
  assert.ok(L.naJanela(p, local(2, 0)));
  assert.ok(!L.naJanela(p, local(12, 0)));
});

test('sem data da coleta: aviso de atraso, sem quebrar', () => {
  const s = L.situacao({ programacao: { ativo: true, hora_inicio: '00:00', hora_fim: '23:59' } }, local(10, 0));
  assert.strictEqual(s.nivel, 'atraso');
  assert.strictEqual(s.idade_min, null);
});

test('frentes: sem o total, na ordem das frentes e depois pelo maior valor', () => {
  const r = L.frentes({ TOTAL: 100, MAGIC: 20, OUTRA_X: 5, TRIAGEM: 2, OUTRA_Y: 9, MANOBRA: 12 });
  assert.deepStrictEqual(r.map(x => x[0]), ['TRIAGEM', 'MANOBRA', 'MAGIC', 'OUTRA_Y', 'OUTRA_X']);
  assert.deepStrictEqual(L.frentes(null), []);
});

test('nomes das frentes', () => {
  assert.strictEqual(L.nomeFrente('CO_SISTEMICO'), 'CO sistêmico');
  assert.strictEqual(L.nomeFrente('TEL_ICOMON'), 'TEL');
  assert.strictEqual(L.nomeFrente('NOVA_FRENTE'), 'Nova frente');
});

test('resumo de acertos e erros', () => {
  const r = L.resumoSerie([['a', 8, 2], ['b', 1, 0], ['c', null, 1]]);
  assert.deepStrictEqual(r, { acertos: 9, erros: 3, total: 12, pct: 75 });
  assert.strictEqual(L.resumoSerie([]).pct, null);
  assert.strictEqual(L.resumoSerie(null).total, 0);
});

test('níveis de uso e formatos', () => {
  assert.deepStrictEqual([null, 10, 69.9, 70, 89.9, 90, 100].map(L.nivelUso), ['nd', 'ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  assert.strictEqual(L.fmtDuracao(1728000), '20 d 0 h');
  assert.strictEqual(L.fmtDuracao(3660), '1 h 1 min');
  assert.strictEqual(L.fmtDuracao(120), '2 min');
  assert.strictEqual(L.fmtBytes(16867405824), '15,7 GB');
  assert.strictEqual(L.fmtBytes(512), '512 B');
  assert.strictEqual(L.fmtBytes(null), '—');
});

test('atualização automática: intervalo válido e contagem', () => {
  assert.deepStrictEqual(L.INTERVALOS_S, [30, 60, 120, 300, 0]);
  assert.strictEqual(L.INTERVALO_PADRAO_S, 60);
  assert.deepStrictEqual(['30', '60', '120', '300', '0', '45', 'x', null].map(L.intervaloValido), [30, 60, 120, 300, 0, 60, 60, 60]);
  assert.strictEqual(L.segundosRestantes(0, 60, 18000), 42);
  assert.strictEqual(L.segundosRestantes(0, 60, 60000), 0);
  assert.strictEqual(L.segundosRestantes(0, 60, 90000), 0);          // nunca negativo
  assert.strictEqual(L.segundosRestantes(0, 0, 5000), null);          // manual
  assert.deepStrictEqual([42, 0, 125, null].map(L.fmtContagem), ['0:42', '0:00', '2:05', 'manual']);
});

test('eventos: só com o bloco completo, duração e histórico por dia', () => {
  assert.strictEqual(L.eventosDe({}), null);
  assert.strictEqual(L.eventosDe({ eventos: { abertos: [] } }), null);
  const ev = { abertos: [], historico: [] };
  assert.strictEqual(L.eventosDe({ eventos: ev }), ev);
  const e = { aberto_em: '2026-11-12T10:00:00-03:00', fechado_em: '2026-11-12T10:45:00-03:00' };
  assert.strictEqual(L.duracaoEvento(e, Date.now()), 45);
  const aberto = { aberto_em: new Date(Date.now() - 20 * 60000).toISOString(), fechado_em: null };
  assert.ok(Math.abs(L.duracaoEvento(aberto, Date.now()) - 20) <= 1);
  const g = L.porDia([{ aberto_em: '2026-11-10T12:00:00Z', id: 'a' }, { aberto_em: '2026-11-12T12:00:00Z', id: 'b' }, { aberto_em: '2026-11-12T18:00:00Z', id: 'c' }]);
  assert.deepStrictEqual(g.map(x => x.itens.map(i => i.id)), [['c', 'b'], ['a']]);        // dia mais recente primeiro, e dentro do dia o mais recente
});

test('valor do pico: % nas regras de uso', () => {
  assert.strictEqual(L.fmtPico({ regra: 'cpu', pico: 97 }), '97%');
  assert.strictEqual(L.fmtPico({ regra: 'mem', pico: 84.04 }), '84%');
  assert.strictEqual(L.fmtPico({ regra: 'disco', pico: 96.5 }), '96,5%');
  assert.strictEqual(L.fmtPico({ regra: 'coletor', pico: 2 }), '2');
  assert.strictEqual(L.fmtPico({ regra: 'cpu', pico: null }), '—');
  assert.strictEqual(L.rotuloSev('critico'), 'Crítico');
  assert.strictEqual(L.rotuloSev('aviso'), 'Aviso');
});

test('texto para compartilhar: hora do coletor, números e eventos', () => {
  const d = { coletado_em: '2026-11-12T15:05:02-03:00', fila: { aguardando: 1, executando: 37 },
    execucao_frente: { TOTAL: 37, MAGIC: 20, TRIAGEM: 2 }, hoje_frente: { TOTAL: 8375, MAGIC: 3998 }, rede_magic: { VIVO1: 2632, VIVO2: 1366 },
    hardware: { cpu_pct: 24.7, mem_pct: 40.2 }, bancos: { b162: { total: 31, max: 100 }, b242: null },
    eventos: { dias: 7, abertos: [{ nome: 'Memória da máquina alta', chave: '' }, { nome: 'Disco cheio', chave: '/data' }], historico: [] } };
  const t = L.textoCompartilhar(d, Date.now());
  assert.ok(t.startsWith('*Checklist VLAN* — coleta às 15:05 de 12/11'));                  // fatia do texto: não depende do fuso do aparelho
  for (const x of ['Fila: 1 aguardando · 37 em execução', 'Em execução: 37 (Triagem 2 · Magic 20)', 'Hoje: 8.375', 'VIVO1 2.632', 'CPU 24.7%', '162 31/100 conexões',
    '⚠️ 2 evento(s) aberto(s): Memória da máquina alta · Disco cheio /data']) assert.ok(t.includes(x), x);
  assert.ok(L.textoCompartilhar(Object.assign({}, d, { eventos: { dias: 7, abertos: [], historico: [] } }), 0).includes('✅ Nenhum evento aberto'));
  assert.ok(!L.textoCompartilhar({ coletado_em: '2026-11-12T15:05:02-03:00' }, 0).includes('evento'));
});
