/* Checklist VLAN — abertura do dados.json publicado pelo MAPI, só pelo login do HUB.
 *
 * O Worker da Cloudflare que serve o arquivo é público, então o dados.json vem cifrado. Este app NÃO tem chave própria: abre
 * com a credencial que o HUB dos apps (https://wro1984.github.io/) guardou no IndexedDB "co-hub-acesso" deste endereço.
 *
 * FORMATO do dados.json (gerado pelo MAPI em checklist_app.py; mudar os dois juntos):
 *   {app:"co-checklist", v:1, gerado_em,
 *    hub:   {acessos: {<id do HUB>: {salt, iv, ct}}}   id = SHA-256("hub:" + MATRÍCULA); salt = o do HUB
 *                                                        ct = a chave dos dados, cifrada (AES-GCM) com a chave do HUB
 *    dados: {iv, ct}}                                    o JSON dos KPIs, cifrado (AES-GCM 256) com a chave dos dados
 *
 * A chave dos dados muda a cada publicação. Quem perde o app no perfil do HUB some de `hub.acessos` e deixa de abrir os
 * dados novos. Este app só LÊ a credencial do HUB: nunca apaga nem copia (sair de todos os apps é no HUB).
 */
(function (root) {
  'use strict';

  const VERSAO = '1.0.0';
  const C = (root.crypto && root.crypto.subtle) ? root.crypto : null;
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  const erro = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

  function conferePacote(p) {
    if (!p || p.app !== 'co-checklist' || p.v !== 1 || !p.dados || typeof p.dados.iv !== 'string' || typeof p.dados.ct !== 'string')
      throw erro('formato', 'dados.json em formato desconhecido.');
  }

  // credencial do HUB neste aparelho (ou null). Não cria o banco se o HUB nunca foi aberto aqui.
  const lerCredHub = () => new Promise(res => {
    if (typeof indexedDB === 'undefined') { res(null); return; }
    let rq;
    try { rq = indexedDB.open('co-hub-acesso', 1); } catch (e) { res(null); return; }
    rq.onupgradeneeded = () => { try { rq.transaction.abort(); } catch (e) { /* segue */ } };
    rq.onerror = () => res(null);
    rq.onsuccess = () => {
      const d = rq.result;
      try {
        const g = d.transaction('cred', 'readonly').objectStore('cred').get('atual');
        g.onsuccess = () => {
          d.close();
          const c = g.result;
          res(c && c.id && c.chave && c.salt ? { id: c.id, matricula: c.matricula, chave: c.chave, salt: c.salt } : null);
        };
        g.onerror = () => { d.close(); res(null); };
      } catch (e) { d.close(); res(null); }
    };
  });

  // abre os KPIs: devolve o objeto JSON. Erros com `code`: sem_acesso, formato, corrompido.
  async function abrir(pacote, cred) {
    if (!C) throw erro('formato', 'Este navegador não tem criptografia (abra pelo endereço https do app).');
    conferePacote(pacote);
    const a = pacote.hub && pacote.hub.acessos && pacote.hub.acessos[cred.id];
    if (!a) throw erro('sem_acesso', 'Seu perfil no HUB não inclui o Checklist VLAN. Fale com o administrador.');
    if (a.salt !== cred.salt) throw erro('sem_acesso', 'Sua chave do HUB foi trocada. Abra o HUB e entre de novo.');
    let rawK;
    try { rawK = await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(a.iv) }, cred.chave, b64(a.ct)); }
    catch (e) { throw erro('sem_acesso', 'Sua chave do HUB não abre este app. Abra o HUB e entre de novo.'); }
    const k = await C.subtle.importKey('raw', rawK, 'AES-GCM', false, ['decrypt']);
    let bytes;
    try { bytes = await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(pacote.dados.iv) }, k, b64(pacote.dados.ct)); }
    catch (e) { throw erro('corrompido', 'Os dados publicados estão corrompidos.'); }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch (e) { throw erro('corrompido', 'Os dados publicados estão em formato desconhecido.'); }
  }

  const api = { VERSAO, abrir, lerCredHub, conferePacote };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CKACripto = api;
})(typeof self !== 'undefined' ? self : globalThis);
