/* Checklist VLAN — aviso no celular (push) quando algo sai do normal (CPU, memória, bancos, coletor...) e quando volta.
 *
 * O MAPI não recebe conexões de fora: o app se inscreve no serviço de push do navegador e entrega a inscrição numa
 * caixa de entrada na nuvem (a MESMA do Problemas Sistêmicos); o MAPI busca lá e envia os avisos direto ao serviço
 * de push, cifrados de ponta a ponta para o aparelho. Quem recebe o evento `push` é o sw.js.
 *
 * A inscrição vai com uma PROVA: HMAC-SHA256 do segredo de aviso do HUB da pessoa (vem cifrado no dados.json, em `tk`)
 * sobre "checklist\n" + endpoint + "\n" + p256dh + "\n" + auth. O prefixo "checklist" separa da prova do Problemas Sistêmicos e do COE (que
 * usa o mesmo segredo): igual a checklist_app.mac_inscricao no MAPI. Mudar os dois juntos.
 */
(function (root) {
  'use strict';

  const VERSAO = '1.1.0';
  const CAIXA = 'https://gentle-band-9798.wro-1984.workers.dev';   // pública (a mesma do config.js do Problemas Sistêmicos)
  const enc = new TextEncoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

  const urlB64ParaBytes = s => {
    s = String(s);
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  };

  async function macInscricao(segredo, endpoint, p256dh, auth) {
    const S = root.crypto.subtle;
    const k = await S.importKey('raw', segredo, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await S.sign('HMAC', k, enc.encode(`checklist\n${endpoint}\n${p256dh}\n${auth}`)));
  }

  // Dá para ligar? Chave pública e segredo vindos do pacote + navegador com Push API (no iPhone, só com o app instalado).
  function disponivel(ctx) {
    const w = root;
    return !!(ctx && ctx.segredo && ctx.chave && w.navigator && 'serviceWorker' in w.navigator && 'PushManager' in w && 'Notification' in w);
  }

  async function inscricaoAtual(reg) {
    try { return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; }
  }

  function mesmaChave(sub, chave) {
    const k = sub.options && sub.options.applicationServerKey;
    if (!k) return true;                                   // o navegador não informa: assume que é a mesma
    const a = new Uint8Array(k), b = urlB64ParaBytes(chave);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // Inscreve (se preciso) e entrega ao MAPI pela caixa. `guardado` = última entrega ("endereço|chave|salt"): igual, não
  // repete. Devolve a marca nova.
  async function registrar(ctx) {
    const reg = ctx.reg;
    let sub = await inscricaoAtual(reg);
    if (sub && !mesmaChave(sub, ctx.chave)) { await sub.unsubscribe(); sub = null; }   // o MAPI trocou a chave dele
    if (!sub) {
      try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ParaBytes(ctx.chave) }); }
      catch (e) { throw new Error('Este navegador não aceitou ligar os avisos. No iPhone, instale o app na tela de início primeiro.'); }
    }
    const j = sub.toJSON(), k = j.keys || {};
    const marca = `${j.endpoint}|${ctx.chave}|${ctx.cred.salt}`;
    if (!ctx.forcar && ctx.guardado === marca) return marca;
    const mac = await macInscricao(ctx.segredo, j.endpoint, k.p256dh, k.auth);
    let r;
    try {
      r = await (api._fetch || root.fetch.bind(root))(CAIXA + '/push/inscrever', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ id: ctx.cred.id, endpoint: j.endpoint, p256dh: k.p256dh, auth: k.auth, mac }) });
    } catch (e) { throw new Error('Sem conexão para ligar os avisos. Tente de novo.'); }
    if (!r.ok) throw new Error('Não deu para ligar os avisos agora (' + r.status + ').');
    return marca;
  }

  async function desinscrever(reg) {
    const s = await inscricaoAtual(reg);
    if (s) { try { await s.unsubscribe(); } catch (e) { /* segue */ } }
  }

  const api = { VERSAO, CAIXA, disponivel, registrar, desinscrever, inscricaoAtual, macInscricao, urlB64ParaBytes, _fetch: null };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKAPush = api;
})(typeof self !== 'undefined' ? self : globalThis);
