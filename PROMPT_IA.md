# PROMPT — Construa o app ClashClanSpy

> Copie tudo abaixo e entregue a outra IA (Claude, GPT, etc.) para ela construir o app do zero. Não inclua segredos — tokens vão via variáveis de ambiente.

---

Você vai construir, do zero, o **ClashClanSpy**: um dashboard web para gestão de clãs do Clash Royale. Requisitos técnicos e de dados estão detalhados abaixo. Siga exatamente.

## Stack

- **Worker (coletor)**: Node.js (ESM) com `firebase-admin`. Roda a cada 30 min via **GitHub Actions** (cron). Busca dados na API oficial do Clash Royale via proxy da RoyaleAPI e grava no **Firestore**.
- **Front**: SPA **React + Vite** (estática), hospedada no **GitHub Pages**. Lê o Firestore diretamente (sem backend próprio).
- **Banco**: **Firestore** (plano Spark/grátis). Regras: leitura pública, escrita negada (só o worker escreve via Admin SDK).

## Funcionalidades

1. **Relatório de promoções**: média de fama por membro nas guerras recentes + sugestões de promoção (somente leitura, nunca executa ações no jogo):
   - membro com média das **4 últimas guerras > 2500** → sugerir **PROMOVER A ANCIÃO**;
   - ancião com média das **8 últimas guerras > 2500** → sugerir **PROMOVER A CO-LÍDER**;
   - fama ausente conta 0; só calcular média com o mínimo de guerras; ordenar por `clanRank`.
2. **Ataques de Guerra**: gráfico de barras com total das últimas 7 semanas + semana atual, e **tabela jogador × dia**:
   - colunas com a **tag da guerra** `{season}/{dia}` (ex.: `134/3`) em vez da data (data = tooltip);
   - **ordenar linhas** por total de ataques na janela: dropdown "Ordem padrão / Mais → Menos / Menos → Mais".
3. **Tema**: dropdown **Auto / Claro / Escuro**. `auto` segue `prefers-color-scheme` em tempo real; persistir em `localStorage`; script inline no `index.html` aplica o tema antes do render (anti-flash). CSS via variáveis (`--bg`, `--text`, `--muted`, `--border`, `--header-bg`, `--input-bg`, `--input-border`, `--hover`, `--accent`, `--accent-text`, `--error`, `--warning-bg`, `--warning-border`, `--warning-left`, `--warning-text`, `--promoted-bg`, `--bar`) em `:root` (claro) e `html[data-theme='dark']`, com `color-scheme`.

## Dados da API (crítico — siga à risca)

- **Base**: `https://proxy.royaleapi.dev/v1` (substitui `api.clashroyale.com`; funciona de IP dinâmico).
- **Auth**: header `Authorization: Bearer <TOKEN>`; token de `process.env.ROYALE_API_TOKEN` (nunca no front/código). Token oficial exige o IP `45.79.218.79` na whitelist.
- **User-Agent customizado obrigatório** (ex.: `clash-royale-worker/0.1`): o proxy está atrás de Cloudflare e bloqueia user-agents padrão (erro 1010).
- **Tags**: URL-encoded (`#` → `%23`). Para chave de documento Firestore: maiúsculas sem `#` (`#LLJ8JQ99` → `LLJ8JQ99`); para URL: `%23LLJ8JQ99`. Nunca duplicar o encode (erro `%23%23`).
- **Retry em 5xx** no `/riverracelog` (ocasional 525 do Cloudflare).
- **404 no `/currentriverrace`** = clã **fora de guerra atual** (ex.: clã pequeno). NÃO abortar a coleta: tratar como guerra vazia (participantes `[]`, sem dado diário) e seguir gravando membros + guerras do log.

### Endpoints

| Endpoint | O que retorna |
|---|---|
| `GET /clans/{tag}` | `name`, `badgeId`, `memberList[]` (`tag`, `name`, `role`, `clanRank`) |
| `GET /clans/{tag}/currentriverrace` | Guerra atual: top-level `sectionIndex`, `periodIndex`, `periodLogs`; nosso clã em `clan` (com `participants[]`); rivais em `clans[]`. Participante: `fame`, `repairPoints`, `decksUsed` (total da semana), `decksUsedToday` (hoje) |
| `GET /clans/{tag}/riverracelog` | Guerras concluídas (~12, novas primeiro): `seasonId`, `sectionIndex`, `createdDate`. Nosso clã em `standings[].clan` — **`participants[]` está sob `clan`, não no standings**. Participante: `fame`, `decksUsed` (total semanal) |

### Limitações (exibir na UI)

- **Sem histórico diário de semanas passadas** na API; `decksUsedToday` só existe na semana atual. Por isso o worker acumula: a cada 30 min grava `decksUsedToday` por jogador para a data atual (usar `Math.max` com o anterior do dia). Dias anteriores ao início da coleta são irrecuperáveis — mostrar aviso.
- API é 100% leitura — sem ações no clã.

## Modelo Firestore

```
clans/{id}                  → { name, badgeId, enabled: bool, addedAt }
clans/{id}/report/latest    → relatório pré-computado (o front lê este doc):
                              updatedAt, clan{tag,name,badgeId},
                              promotion{racesAnalyzed, warnings[], members[]},
                              warAttacks{players, weeks[], daily{dates, labels, players}},
                              data{members[], races[], daily{dates, labels, players}}
clans/{id}/daily/{date}     → snapshot bruto do dia (YYYY-MM-DD):
                              date, label ("134/3"), raceId, players[{tag,name,decksUsed,decksUsedToday}], updatedAt
```

> `clans/{id}/report` (3 segmentos) é **coleção**, não documento. Use `report/latest`.

### firestore.rules

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

## Worker — lógica de cada coleta (30 min)

Para cada clã com `enabled == true`:
1. Buscar `clan`, `currentriverrace` (com tratamento de 404), `riverracelog` em paralelo.
2. **Snapshot diário** em `clans/{id}/daily/{date}` (merge; `decksUsedToday = max(anterior, atual)`).
3. **Cache de guerras**: anexar ao array `races` (novas primeiro, máx. 12) as que ainda não estão em cache, extraindo de `standings[].clan.participants`: `tag`, `name`, `fame`, `decksUsed`.
4. **Matriz diária**: `dates[]` (últimos 35 dias), `players[tag] = {name, role, days:{date: attacksToday}}`, `labels[date] = "{season}/{dia}"`.
5. **Rótulo da guerra** (`134/3`):
   - `season` = `seasonId` do item mais recente do `riverracelog`; se o `sectionIndex` dele >= `sectionIndex` atual → `season + 1` (nova temporada), senão `= seasonId`.
   - `dia` = `periodIndex - sectionIndex * 7 - 2` (cada guerra ocupa os períodos `{section}*7+3..+6`; validado). Sem `sectionIndex`/`periodIndex` → sem rótulo.
6. **Poda**: excluir docs `daily/{date}` com data < 35 dias (1x/dia) e limpar datas/labels antigos da matriz.
7. **Gravar relatório** em `clans/{id}/report/latest`.

**Gráfico de semanas**: 7 guerras passadas (cronológicas; `label` = data `YYYY-MM-DD`, `attacks` = soma `decksUsed`) + "Semana atual" (`attacks` = soma `decksUsed`, `attacksToday` = soma `decksUsedToday`, `current: true`).

**Seed de clãs**: script `seed.js "#TAG"` valida na API e grava `clans/{id}` com `enabled: true`; `--disable` desabilita.

## Front — UI

- **Navbar** (desktop): largura total da janela, `position: sticky; top: 0`, fundo com `--header-bg`. **Esquerda**: título **ClashClanSpy** + abas **Relatório** / **Ataques de Guerra**. **Direita**: seletor de clã (de `clans`, `enabled == true`) + dropdown de tema. Telas estreitas: `flex-wrap`.
- **Config Firebase** via `import.meta.env.VITE_FIREBASE_API_KEY` (valores públicos) + `onSnapshot` de `clans` e `clans/{id}/report/latest`.
- **Relatório**: banners de aviso de promoção (fundo âmbar, borda esquerda, alto contraste nos dois temas) + tabela (Jogador, Cargo, Média 4, Média 8, Part. 4/8, Promoção; linhas promovidas em destaque).
- **Ataques**: gráfico de barras (semana atual em destaque, "N hoje") + tabela diária (tag da guerra no cabeçalho, data no `title`, rolagem horizontal, primeira coluna fixa) + dropdown de ordenação por total.
- **Login visual**: não precisa de autenticação no front.

## Deploy

- **Firebase**: projeto Spark, Firestore (modo production, database `(default)`), service account (JSON), publicar `firestore.rules`.
- **GitHub (repo público)**: Secrets `ROYALE_API_TOKEN` e `FIREBASE_SERVICE_ACCOUNT` (JSON da service account em **base64**); Variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (aba **Variables**, pois `deploy.yml` lê com `vars.*` — valores em Secrets ficam vazios). Pages → Source: **GitHub Actions**.
- **Workflows**: `collect.yml` (cron `*/30` + `workflow_dispatch`; node 22; roda `node src/collect.js` com os secrets) e `deploy.yml` (push na `main`; builda `client/` com as vars; publica `client/dist` no Pages).

## Critérios de aceite

1. `npm run collect` (com envs) grava report + daily para clãs habilitados, sem quebrar em clã fora de guerra.
2. O report contém `daily.labels` com valores tipo `"134/3"`.
3. O front lista os clãs, mostra relatório e a tabela diária com tags de guerra, ordenação funcionando e tema funcionando.
4. `firestore.rules` bloqueia escrita de clientes.
5. Nenhum segredo no código ou no bundle.
