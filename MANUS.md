# Spec para o Manus — ClashClanSpy

> Documento autocontido para reconstruir o projeto **ClashClanSpy** (dashboard de gestão de clã do Clash Royale). Siga esta spec exatamente; todos os detalhes de dados, API e estrutura estão aqui.

## 1. Objetivo

Dashboard web para líderes de clã do Clash Royale com:

1. **Relatório de promoções**: média de fama dos membros nas guerras recentes, com sugestões de promoção baseadas em regras configuráveis (somente leitura; **nunca** executa ações no jogo).
2. **Ataques de Guerra**: gráfico de barras com total de ataques das últimas 7 semanas + semana atual, e uma **tabela jogador × dia** com os ataques diários. As colunas devem mostrar a **tag da guerra** (ex.: `134/1`, `134/2`...) em vez da data (a data vira tooltip). O usuário pode **ordenar as linhas pelo total de ataques** (mais→menos e menos→mais).
3. **Tema**: dropdown **Auto / Claro / Escuro**. `auto` segue `prefers-color-scheme` do sistema em tempo real; a escolha fica persistida em `localStorage`. Um script inline no `index.html` aplica o tema antes da primeira renderização (evitar "flash").

## 2. Arquitetura

- **Coletor (worker)**: script Node.js que roda a cada 30 min via **GitHub Actions** (cron `*/30`). Consulta a API oficial do Clash Royale via proxy da RoyaleAPI, grava snapshots no **Firestore** e **pré-computa** um relatório por clã.
- **Front**: SPA estática **React + Vite** hospedada no **GitHub Pages**. Lê o Firestore diretamente (sem backend próprio).
- **Banco**: **Firestore** (plano Spark/grátis). Regras: leitura pública, escrita negada (só o worker via Admin SDK escreve).

```
GitHub Actions (cron */30)        React SPA (GitHub Pages)
┌────────────────────────┐        ┌──────────────────────────┐
│ worker/collect.js      │  lê    │ Firestore (leitura)      │
│  → API RoyaleAPI proxy │──────►│ clans/{id}/report/latest  │◄── front lê
│  → grava Firestore     │        │ clans/{id}/daily/{date}  │
│  Admin SDK (secrets)   │        │ clans (lista)            │
└────────────────────────┘        └──────────────────────────┘
```

## 3. Dados da API (crítico)

- **Base**: use `https://proxy.royaleapi.dev/v1` (proxy da RoyaleAPI; funciona de IP dinâmico). Substituir `api.clashroyale.com` por este host.
- **Auth**: header `Authorization: Bearer <TOKEN>`. O token vem de `process.env.ROYALE_API_TOKEN` (**nunca** embutir no código ou no front). Token oficial criado em `developer.clashroyale.com`; o proxy exige que o IP `45.79.218.79` esteja na whitelist do token.
- **User-Agent**: o proxy fica atrás de Cloudflare e bloqueia user-agents padrão (`Python-urllib`, `undici`) com erro **1010**. Sempre enviar um `User-Agent` customizado (ex.: `clash-royale-worker/0.1`).
- **Tags de clã**: precisam ser URL-encoded (`#` → `%23`). Normalizar: maiúsculas, sem `#` para chaves de documento (`#LLJ8JQ99` → `LLJ8JQ99`); `%23LLJ8JQ99` para URLs.
- **Retry**: `/clans/{tag}/riverracelog` retorna **525** (Cloudflare) ocasionalmente — fazer retry com backoff em respostas 5xx.
- **Código 404 em `/currentriverrace`**: acontece quando o clã **não está em uma guerra atual** (ex.: clãs pequenos). Não pode derrubar a coleta — tratar como "sem guerra atual" (participantes vazios, sem dado diário) e continuar gravando o report com membros + guerras do log.

### Endpoints usados

| Endpoint | Uso |
|---|---|
| `GET /clans/{tag}` | Dados do clã: `name`, `badgeId`, `memberList[]` (cada item: `tag`, `name`, `role`, `clanRank`) |
| `GET /clans/{tag}/currentriverrace` | Guerra atual. Top-level: `sectionIndex`, `periodIndex`, `periodLogs`. Nosso clã: `clan` (tem `participants[]`); rivais: `clans[]`. Por participante: `fame`, `repairPoints`, `decksUsed` (total da semana), `decksUsedToday` (ataques de hoje) |
| `GET /clans/{tag}/riverracelog` | Guerras concluídas (até ~12, novas primeiro). Cada item: `seasonId`, `sectionIndex`, `createdDate` (label da semana). Nosso clã fica em `standings[].clan` — **`participants[]` está sob `clan`, NÃO no standings**. Por participante: `fame`, `decksUsed` (total semanal) |

### Limitações conhecidas (importante para a UI)

- **Não existe histórico diário de semanas passadas** na API. `decksUsedToday` só existe na semana atual. Por isso a tabela diária é construída acumulando coletas: a cada 30 min, guarda-se `decksUsedToday` por jogador para a data atual (usar `Math.max` com o valor anterior do dia). Dias anteriores ao início da coleta ficam perdidos — exibir aviso na UI.
- A API é 100% leitura. Não é possível promover/expulsar/agir no clã via API.

## 4. Modelo de dados no Firestore

```
clans/{id}                    — clã rastreado
  name, badgeId, enabled (bool), addedAt

clans/{id}/report/latest      — relatório pré-computado (front lê este doc)
  updatedAt, clan: {tag,name,badgeId},
  promotion: {racesAnalyzed, warnings:[...], members:[...]},
  warAttacks: {players, weeks:[...], daily:{dates, labels, players}},
  data: {members:[...], races:[...], daily:{dates, labels, players}}

clans/{id}/daily/{date}       — snapshot bruto do dia (YYYY-MM-DD)
  date, label (ex.: "134/3"), raceId, players:[{tag,name,decksUsed,decksUsedToday}], updatedAt
```

> Um caminho com 3 segmentos (`clans/{id}/report`) é uma **coleção**, não um documento. Por isso o relatório vive em `clans/{id}/report/latest` (coleção `report`, doc fixo `latest`).

### Regras (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /clans/{clanId} {
      allow read: if true;
      allow write: if false;
    }
    match /clans/{clanId}/{document=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

## 5. Lógica do worker (collect, a cada 30 min)

Para cada clã com `enabled == true`:

1. Busca `clan`, `currentriverrace`, `riverracelog` em paralelo (com o tratamento de 404 do currentriverrace).
2. **Snapshot diário**: grava em `clans/{id}/daily/{date}` os `participants` com `decksUsed` e `decksUsedToday` (merge; para cada jogador, `decksUsedToday = max(anterior, atual)` do dia).
3. **Cache de guerras**: do `riverracelog`, anexa ao array `races` (novas primeiro, máx. 12) as que ainda não estão em cache, extraindo do `standings[].clan.participants` de cada guerra: `tag`, `name`, `fame`, `decksUsed`.
4. **Matriz diária** (`data.daily`): `dates[]` (últimos 35 dias), `players[tag] = {name, role, days:{date: attacksToday}}`, e **`labels[date] = "{season}/{dia}"`**.
5. **Rótulo da guerra** (ex.: `134/3`):
   - `season`: usar o item mais recente do `riverracelog` (`seasonId`). Se `sectionIndex` do log >= `sectionIndex` atual → `season = seasonId + 1` (mudou de temporada), senão `= seasonId`.
   - `dia`: `periodIndex - sectionIndex * 7 - 2` (validado: cada guerra ocupa os períodos `{section}*7+3..+6`). Se `sectionIndex`/`periodIndex` ausentes → sem rótulo.
6. **Poda**: exclui docs `daily/{date}` com data < 35 dias atrás (1x por dia) e remove datas/labels antigos da matriz.
7. **Relatório**: computa `promotion` e `warAttacks` (ver abaixo) e grava em `clans/{id}/report/latest`.

### Regras de promoção (`promotion`)

- **membro** com média de fama das **últimas 4 guerras > 2500** → sugerir **PROMOVER A ANCIÃO**.
- **ancião** com média das **últimas 8 guerras > 2500** → sugerir **PROMOVER A CO-LÍDER**.
- Fama ausente na guerra conta como 0. Só calcular média quando houver o número mínimo de guerras (4 ou 8). Cada membro: `tag`, `name`, `role`, `roleLabel`, `media4`, `media8`, `part4`, `part8`, `promotion` (ou `null`). `warnings` = membros com `promotion`. Ordenar por `clanRank`.

### Gráfico de semanas (`warAttacks.weeks`)

- As 7 guerras passadas mais recentes (em ordem cronológica), cada uma: `label` = data (`createdDate` → `YYYY-MM-DD`), `attacks` = soma de `decksUsed`.
- Item final "Semana atual": `attacks` = soma de `decksUsed` dos participantes atuais, `attacksToday` = soma de `decksUsedToday`, marcado `current: true`.

## 6. Front (React + Vite)

### Navbar (desktop)
- Largura total da janela (barra fixa `position: sticky; top: 0` com fundo).
- **Esquerda**: título **ClashClanSpy** + abas **Relatório** e **Ataques de Guerra**.
- **Direita**: seletor de clã (da coleção `clans`, `enabled == true`) + dropdown de **tema** (Auto/Claro/Escuro).
- Em telas estreitas: quebrar em linhas (`flex-wrap`).

### Config Firebase (front)
- Ler de `import.meta.env.VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Valores públicos (vão no bundle), não são segredos.
- `onSnapshot` de `clans` (lista) e `clans/{id}/report/latest` (relatório) para atualização em tempo real.

### Aba Relatório
- Avisos de promoção (banners com fundo âmbar, borda esquerda destacada, texto de alto contraste em ambos os temas).
- Tabela: Jogador, Cargo, Média 4, Média 8, Part. 4/8, Promoção. Linhas com promoção em destaque.

### Aba Ataques de Guerra
- Gráfico de barras das semanas (altura proporcional ao total; semana atual em cor de destaque, mostrando "N hoje").
- **Tabela diária**: cabeçalho com a **tag da guerra** (`labels[date]` ex.: `134/3`) e a data como `title`; sem rótulo, mostra `MM-DD`. Rolagem horizontal; primeira coluna (jogador) fixa.
- **Ordenação**: dropdown "Ordenar por ataques" com **Ordem padrão / Mais → Menos / Menos → Mais**, ordenando as linhas pela **soma de ataques na janela exibida** (desempate por nome).

### Tema
- Estado `auto | light | dark` (default `auto`, lido do `localStorage`). Em `auto`, acompanhar `matchMedia('(prefers-color-scheme: dark)')` com listener.
- Aplicar efetivo em `document.documentElement.dataset.theme`. CSS por **variáveis custom** (`--bg`, `--text`, `--muted`, `--border`, `--header-bg`, `--input-bg`, `--input-border`, `--hover`, `--accent`, `--accent-text`, `--error`, `--warning-bg`, `--warning-border`, `--warning-left`, `--warning-text`, `--promoted-bg`, `--bar`) definidas em `:root` (claro) e `html[data-theme='dark']`. Usar `color-scheme: light/dark`.
- Script inline em `index.html` antes do bundle aplica `data-theme` a partir do `localStorage`/sistema (anti-flash).

## 7. Setup de deploy

### Firebase
1. Projeto no plano **Spark**; habilitar **Firestore** (modo production), database ID `(default)`.
2. **Service account**: Project settings → Service accounts → Generate new private key (JSON).
3. Publicar `firestore.rules` (`firebase deploy --only firestore:rules` ou colar no console).

### GitHub (repo público)
- **Secrets**: `ROYALE_API_TOKEN` (token da API), `FIREBASE_SERVICE_ACCOUNT` (JSON da service account em **base64**).
- **Variables** (aba Variables, NÃO Secrets): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Importante: o `deploy.yml` lê com `vars.*`, que só resolve valores da aba **Variables**.
- **Pages**: Settings → Pages → Source: **GitHub Actions**.

### Workflows
- `collect.yml`: cron `'*/30 * * * *'` + `workflow_dispatch`; node 22; `npm ci` no `worker/`; roda `node src/collect.js` com os secrets.
- `deploy.yml`: dispara em push na `main` + `workflow_dispatch`; builda `client/` com as `VITE_FIREBASE_*` do `vars`; publica `client/dist` no Pages (artifact).

### Adicionar clãs ao tracking
- `node src/seed.js "#TAG"` (busca o nome na API e grava `clans/{id}` com `enabled: true`); `node src/seed.js "#TAG" --disable` desabilita.
- Clãs rastreados: `#LLJ8JQ99` (Death Star), `#229G9V9Q` (BRASIL FURIA ™), `#QGRRJLLG` (Death Star II), `#QVQ9R80V` (Brasil Fúria 2).

## 8. Custo

Spark: 50k reads / 20k writes / 20k deletes por dia, 1 GiB. Com ~4–20 clãs a cada 30 min usa uma fração pequena da quota. Repo público = Actions e Pages grátis. Exceder quota bloqueia no dia, não cobra.

## 9. Cuidados / bugs já conhecidos

- Não duplicar o `#` nas URLs (`%23%23TAG` é erro): encode uma vez.
- Caminho Firestore com 3 segmentos é coleção (usar `report/latest`).
- Fila de coleta para clãs fora de guerra (404 no currentriverrace) sem abortar os demais.
- No Spark, o rate da API é por segundo; para poucos clãs, 3 chamadas/min por clã é seguro.
