// O plano de desenho da imagem de compartilhar (sem DOM): leva só o que está nos dados, cabe na largura e cresce com o conteúdo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../cartao.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8')).esperado;
const AGORA = Date.parse('2026-11-12T15:08:00-03:00');
const textos = p => p.cmds.filter(c => c.t === 'text').map(c => c.txt);

test('cada área gera um plano com a largura fixa e fundo', () => {
  for (const area of ['agora', 'acertos', 'saude', 'eventos', 'completo']) {
    const p = C.montar(fx, { area, frente: 'MAGIC', agora: AGORA });
    assert.strictEqual(p.w, 1080, area);
    assert.ok(p.h > 300, area);
    assert.deepStrictEqual([p.cmds[0].t, p.cmds[0].w, p.cmds[0].h], ['rect', 1080, p.h], area);          // fundo cobre tudo
    assert.ok(textos(p).includes('Checklist VLAN'), area);
  }
});

test('nada desenhado fora da imagem', () => {
  for (const area of ['agora', 'acertos', 'saude', 'eventos', 'completo']) {
    const p = C.montar(fx, { area, frente: 'TRIAGEM', agora: AGORA });
    for (const c of p.cmds) {
      if (c.t === 'rect') assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1080.5 && c.y + c.h <= p.h + 0.5, `${area}: ${JSON.stringify(c)}`);
      if (c.t === 'text') assert.ok(c.x >= 0 && c.x <= 1080 && c.y > 0 && c.y <= p.h, `${area}: ${c.txt}`);
    }
  }
});

test('área Agora: números e frentes sem o TOTAL como barra', () => {
  const t = textos(C.montar(fx, { area: 'agora', agora: AGORA }));
  for (const esperado of ['Fila agora'.toUpperCase(), '37', '8.375', 'Magic', 'Triagem', 'VIVO1', 'VIVO2', '65,8%']) assert.ok(t.includes(esperado), esperado);
  assert.ok(!t.includes('Total'));                                 // o TOTAL vira o card grande, não uma barra
  assert.ok(!t.includes('TOTAL'));
});

test('área Acertos usa a frente escolhida e cai na primeira se não existir', () => {
  const m = textos(C.montar(fx, { area: 'acertos', frente: 'MAGIC', agora: AGORA })).join('|');
  assert.match(m, /ACERTOS E ERROS \(24 H\) · MAGIC/);
  const x = textos(C.montar(fx, { area: 'acertos', frente: 'NAO_EXISTE', agora: AGORA })).join('|');
  assert.match(x, /TRIAGEM/);
  const colunas = C.montar(fx, { area: 'acertos', frente: 'MAGIC', agora: AGORA }).cmds.filter(c => c.t === 'rect' && (c.fill === '#4aa023' || c.fill === '#d6336c'));
  assert.ok(colunas.length > 20);
});

test('área Saúde e Eventos', () => {
  const s = textos(C.montar(fx, { area: 'saude', agora: AGORA })).join('|');
  assert.match(s, /Banco da API \(162\)/);
  assert.match(s, /166 de 300 conexões/);
  assert.match(s, /\/data/);
  const e = textos(C.montar(fx, { area: 'eventos', agora: AGORA })).join('|');
  assert.match(e, /EVENTOS ABERTOS \(2\)/);
  assert.match(e, /Memória da máquina alta/);
  assert.match(e, /HISTÓRICO \(7 DIAS\)/);
});

test('alertas desligados e blocos ausentes não quebram', () => {
  const sem = Object.assign({}, fx); delete sem.eventos;
  assert.match(textos(C.montar(sem, { area: 'eventos', agora: AGORA })).join('|'), /alertas ainda não estão ligados/);
  const vazio = { coletado_em: fx.coletado_em, programacao: fx.programacao, limite_atraso_s: fx.limite_atraso_s };
  for (const area of ['agora', 'acertos', 'saude', 'eventos', 'completo']) assert.ok(C.montar(vazio, { area, agora: AGORA }).h > 200, area);
});

test('dados atrasados aparecem na imagem', () => {
  const t = textos(C.montar(fx, { area: 'agora', agora: AGORA + 40 * 60000 })).join('|');
  assert.match(t, /Dados atrasados/);
  assert.ok(!/Dados atrasados/.test(textos(C.montar(fx, { area: 'agora', agora: AGORA })).join('|')));
});

test('o resumo completo é mais alto que cada área', () => {
  const h = a => C.montar(fx, { area: a, agora: AGORA }).h;
  assert.ok(h('completo') > h('agora') && h('completo') > h('saude') && h('completo') > h('eventos'));
});

test('a imagem não leva login, matrícula nem texto de consulta', () => {
  const todo = JSON.stringify(C.montar(fx, { area: 'completo', agora: AGORA }).cmds).toLowerCase();
  for (const proibido of ['select ', 'a0001', 'matricula', 'senha', 'token']) assert.ok(!todo.includes(proibido), proibido);
});

test('renderizar executa o plano num canvas simulado', () => {
  const chamadas = [];
  const ctx = new Proxy({}, { get: (_, k) => k === 'measureText' ? (t => ({ width: t.length * 10 })) : (...a) => chamadas.push([k, a]), set: (_, k, v) => { chamadas.push([k, v]); return true; } });
  const cv = { getContext: () => ctx };
  const plano = C.montar(fx, { area: 'agora', agora: AGORA });
  C.renderizar(cv, plano, 2);
  assert.strictEqual(cv.width, 2160);
  assert.strictEqual(cv.height, plano.h * 2);
  assert.ok(chamadas.some(c => c[0] === 'fillText'));
  assert.ok(chamadas.some(c => c[0] === 'setTransform' && c[1][0] === 2));
});
