# CO_CHECKLIST — Checklist VLAN

App web instalável no celular (PWA) com os KPIs do Checklist VLAN, em três áreas trocadas no topo: **Agora** (fila, em execução,
aguardando e hoje por frente, rede do Magic), **Acertos** (acertos e erros por frente em blocos de 15 min nas últimas 24 h e o
acompanhamento do dia) e **Saúde** (conexões dos bancos 162 e 242; CPU, memória, tempo ligada, carga e discos da máquina da API).
Publicado pelo GitHub Pages em <https://wro1984.github.io/CO_CHECKLIST/> a partir da branch `main`. **Todo push na `main` vai
para o ar em cerca de 1 minuto**, para todos os usuários.

**Topo padrão dos apps** (igual no Problemas Sistêmicos, no Nível de Serviço, na URA e no COE): botão de voltar ao HUB (ícone de
grade, `#btHub`) à esquerda, botões do app à direita. No desktop o topo fica na coluna de 760 px do conteúdo.

## Como funciona

```
Linux 162 (coletor, cron) ──► PostgreSQL .242 ──► MAPI (checklist_app.py) ──► Worker da Cloudflare ──► este app
 consultas só leitura        tb_kpi_snapshot      valida e cifra pelo HUB     dados.json CIFRADO      login do HUB
```

- O app e o Worker são **públicos**. Os números só existem lá **cifrados**, no `dados.json`.
- Quem coleta é o `agente_kpi.py` na Linux 162 (repositório `wro1984/mapi5`, pasta `agente_linux/`); quem valida e publica é o MAPI,
  quando há snapshot novo (a cada 5 min por padrão; a programação é editada em Comunicação → Checklist · App).
- O endereço do `dados.json` fica em `config.js` (`https://ura-atendimento-dados.wro-1984.workers.dev/checklist/`). É o mesmo Worker
  "dados dos apps" do URA Atendimento, com a pasta `checklist` liberada na variável `APPS` dele. **Trocou o endereço?** Mude também o
  `connect-src` da CSP no `index.html` (o teste confere) e o `CHECKLIST_APP_CF_URL` do MAPI.
- **Não há chave própria**: o app abre com a credencial que o HUB dos apps (<https://wro1984.github.io/>) guardou no IndexedDB
  `co-hub-acesso` deste endereço. Quem vê o app é definido no perfil do HUB (app `checklist`).
- O MAPI manda também a `programacao` do coletor e o `limite_atraso_s`: com eles o app diz "dados atrasados", "fora do horário" ou
  "coleta desligada". **O app não recalcula nenhum KPI.**

## Regras que não podem ser quebradas

1. **Nunca commitar dados abertos nem segredos** (números reais, prints, JSON decifrado, chaves, tokens). O histórico do git é
   público. Para testar, use `tests/fixtures/pacote.json` (dados inventados, gerado com as funções do MAPI). Também não ponha aqui
   logins de serviço, nomes de usuário de banco ou o mapeamento login → frente: isso fica fora do repositório (na 162).
2. **Não mudar o formato da criptografia sozinho.** `cripto.js` precisa continuar igual ao que o MAPI gera em `checklist_app.py`:
   - `dados.json`: `{app:"co-checklist", v:1, gerado_em, hub:{acessos:{id_hub:{salt, iv, ct}}}, dados:{iv, ct}}`;
   - `id_hub` = SHA-256 de `"hub:" + MATRÍCULA`, `salt` = o do HUB (diferente: a chave do HUB foi trocada);
   - `ct` do acesso = a chave dos dados (AES-GCM 256) cifrada com a chave do HUB; `dados.ct` = o JSON dos KPIs.
   Mudança aqui tem que ser feita **junto** no MAPI.
3. **A credencial do HUB só é LIDA**: nunca apagar, copiar ou criar o banco `co-hub-acesso` (sair de todos os apps é no HUB). O teste
   `versao.test.js` confere.
4. **O service worker (`sw.js`) só mexe no que é deste app**: caches que começam com `co-checklist-v` e pedidos dentro de
   `/CO_CHECKLIST/`. Outros apps moram no mesmo endereço; apagar o cache deles quebra o offline de todo mundo. O `dados.json` vem de
   outro endereço (Worker): o próprio `app.js` guarda a cópia cifrada no cache `co-checklist-dados` e a apaga se o acesso se perder.
5. **Não carregar nada de fora**: sem CDNs, fontes externas, analytics (o `index.html` tem CSP `default-src 'self'`). A única exceção
   é o `connect-src` do Worker dos dados.
6. **Cota da Cloudflare** (conta gratuita, ~100 mil chamadas por dia somando os Workers): o app confere o `dados.json` a cada **2 min**
   com a tela aberta (`CONFERIR_MS` em `app.js`), porque o coletor grava a cada 5 min. Não diminua sem fazer a conta.
7. Acesso perdido (sem o app no perfil, chave do HUB trocada): o app apaga a cópia cifrada dos dados e mostra "Sem acesso".

## Formato do JSON aberto (o que a tela usa)

`{v:1, coletado_em, fonte_id, fila:{aguardando, executando}, aguardando_frente, execucao_frente, hoje_frente, rede_magic ({FRENTE: n}),
series:{FRENTE: [[bloco "AAAA-MM-DDTHH:MM", acertos, erros]]}, acompanhamento:{colunas:["t","total",...frentes], linhas:[[bloco, total,
...]]}, bancos:{b162, b242:{total, max, estados_completos, estados}}, hardware:{cpu_pct, mem_pct, mem_total, mem_usada, uptime_s, load1,
discos:[{ponto, total, usado, pct}]}, parciais:{<bloco>: <motivo curto>}, programacao:{ativo, intervalo_min, hora_inicio, hora_fim},
limite_atraso_s}`. Um bloco que falhou na coleta vem `null` (e o nome em `parciais`): o app tem que aguentar qualquer bloco ausente.

## Onde mexer

| Quero mudar… | Onde |
|---|---|
| Cores, tamanhos, modo escuro | `<style>` no `index.html` (variáveis em `:root`) |
| Cards de cada área, textos do ⓘ | `telaAgora()`, `telaAcertos()`, `telaSaude()` e `INFO` em `app.js` |
| Nome e ordem das frentes, aviso de atraso, formatos | `logica.js` |
| Gráficos (escala, colunas, linhas, toque) | `grafico.js` (contas) e `colunasSvg()` / `telaAcompanhamento()` em `app.js` |
| Intervalo de conferência | `CONFERIR_MS` em `app.js` |
| **Quais números vêm, de onde, regras de cada consulta** | **não é aqui**: é o coletor (`agente_linux/` do MAPI) e o `checklist_app.py` |

## Antes de cada push

1. **Versão igual** em `APP_VERSION` (`app.js`), `VERSAO` (`cripto.js`), `VERSION` (`sw.js`) e nos `?v=` do `index.html`.
   Com versões diferentes o app se recarrega até elas baterem.
2. Arquivo novo que o app usa? Inclua em `CORE` no `sw.js` (e no `index.html`).
3. `npm test` e teste no navegador em ~390 px, claro e escuro.
4. `git pull` antes do push. Use merge, não force-push.

## Testar localmente, sem dados reais

```
# pacote de teste com as funções do MAPI (dados inventados), pessoa A0001 / lago-vento-pedra
MAPI_DIR=../mapi5 python tests/gerar_fixture.py
mkdir -p /tmp/site/CO_CHECKLIST && cp -r index.html *.js manifest.webmanifest icons /tmp/site/CO_CHECKLIST/
cd /tmp/site && python -m http.server 8000          # http://localhost:8000/CO_CHECKLIST/
```

Sem a credencial do HUB no navegador o app mostra "Entre pelo HUB". Para testar, grave a credencial no IndexedDB (veja `credDoHub()`
em `tests/cripto.test.js`) e responda o pedido do `dados.json` com o `pacote` da fixture (o Playwright faz isso com `page.route`).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | estrutura, estilos (paleta da empresa, modo escuro), CSP, troca Agora / Acertos / Saúde |
| `app.js` | telas, ⓘ de cada card, gráficos com toque; conferência a cada 2 minutos |
| `logica.js` | regras de apresentação (frentes, atraso, formatos); roda também no Node |
| `grafico.js` | contas dos gráficos (escala, colunas, linhas, toque); roda também no Node |
| `cripto.js` | lê a credencial do HUB e abre o `dados.json` |
| `config.js` | endereço do `dados.json` (Worker) |
| `sw.js` | cache offline só deste app |
| `manifest.webmanifest`, `icons/` | instalação no celular |
| `tests/` | criptografia (pacote do MAPI), regras, gráficos, versões e CSP |
