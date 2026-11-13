// Configuração do app (pública). `dados` = endereço do dados.json cifrado que o MAPI publica (Worker da Cloudflare "dados dos
// apps", pasta `checklist`). Trocou o endereço? Mude também o `connect-src` da CSP no index.html (o teste confere) e o
// CHECKLIST_APP_CF_URL do MAPI.
window.CKA_CONFIG = { dados: 'https://ura-atendimento-dados.wro-1984.workers.dev/checklist/' };
