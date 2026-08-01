# Clash Clan Experiments

Dashboard de gestão de clã do Clash Royale: relatório de promoções e acompanhamento de ataques de guerra. **Vibecoded** — construído com assistência de IA ([opencode](https://opencode.ai)).

## Como funciona

```
GitHub Actions (cron */30)        React SPA (GitHub Pages)
┌────────────────────────┐        ┌──────────────────────────┐
│ worker/collect.js      │  lê    │ Firestore (leitura)      │
│  → API RoyaleAPI proxy │──────►│ clans/{id}/report/latest  │◄── front lê
│  → grava Firestore     │        │ clans/{id}/daily/{date}  │
│  Admin SDK (secrets)   │        │ clans (lista)            │
└────────────────────────┘        └──────────────────────────┘
```

- O **worker** (rodado pelo GitHub Actions a cada 30 min) consulta a API oficial via o proxy da RoyaleAPI (funciona de IP dinâmico), grava snapshots brutos no Firestore e **pré-computa** um doc `report` por clã.
- O **front** (React, hospedado no GitHub Pages) lê direto do Firestore — sem backend próprio.
- Clãs em tracking ficam numa tabela `clans` no Firestore; adicione-os com o script `seed`.

## Funcionalidades

- **Relatório**: média de fama das últimas 4 e 8 guerras por membro, com avisos de promoção (membro → ancião com média 4 > 2500; ancião → co-líder com média 8 > 2500). Somente leitura — nenhuma ação é executada no clã.
- **Ataques de Guerra**: total de ataques das últimas 7 semanas + semana atual, e uma **tabela jogador × dia** com os ataques diários (colunas com a **tag da guerra**, ex.: `134/1`). A tabela permite **ordenar por total de ataques** (mais→menos / menos→mais).
- **Tema**: switch Auto/Claro/Escuro (padrão `auto` segue o sistema); escolha persistida no `localStorage`.

> A tabela diária só acumula a partir do início da coleta — a API oficial não expõe histórico diário de semanas passadas.

## Repositórios/estrutura

```
worker/   Node.js worker (firebase-admin) — coleta e grava no Firestore
client/   React + Vite SPA (GitHub Pages) — lê o Firestore
.github/  collect.yml (cron */30) + deploy.yml (Pages)
firestore.rules
MANUS.md  spec autocontida (PT-BR) para reconstruir o app com IA (Manus)
```

### Worker

```
cd worker && npm install
npm run collect          # roda a coleta de todos os clãs habilitados
npm run seed #TAG        # adiciona um clã ao tracking
npm run seed #TAG -- --disable   # remove do tracking (enabled=false)
```

Envs do worker: `ROYALE_API_TOKEN` e `FIREBASE_SERVICE_ACCOUNT` (JSON da service account em base64).

### Frontend

```
cd client && npm install
npm run dev
```

Envs (públicas, não são segredos): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Veja `client/.env.example`.

## Setup

Guia completo para configurar do zero (fork/instância própria): veja [Setup.md](Setup.md).

### Setup no GitHub

1. Repositório **público** (minutos do Actions ilimitados e Pages grátis).
2. No Firebase: crie um projeto (plano **Spark**, grátis), habilite **Firestore** e gere uma **service account** (JSON).
3. Faça deploy das regras: `firebase deploy --only firestore:rules` (ou cole `firestore.rules` no console).
4. **Secrets** do repositório (Settings → Secrets and variables → Actions):
   - `ROYALE_API_TOKEN` — token da API (IP `45.79.218.79` na whitelist)
   - `FIREBASE_SERVICE_ACCOUNT` — JSON da service account em base64 (`base64 -w0 service-account.json`)
5. **Variables** do repositório (Settings → Secrets and variables → Actions → Variables):
   - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
6. Settings → Pages → Source: **GitHub Actions**.
7. Adicione o(s) clã(s) ao tracking: `npm run seed #TAG` (com `FIREBASE_SERVICE_ACCOUNT` e `ROYALE_API_TOKEN` no env) ou crie um doc na coleção `clans` com `{ name, enabled: true }`.
8. O `deploy.yml` publica o site no push à `main`; o `collect.yml` roda sozinho a cada 30 min (teste com **Run workflow** em Actions).

## Notas da API

- Use `https://proxy.royaleapi.dev/v1` em vez de `https://api.clashroyale.com/v1` (IP dinâmico).
- O proxy é protegido por Cloudflare e bloqueia user-agents padrão (erro 1010); o app envia um `User-Agent` customizado.
- Tags de clã devem ser URL-encoded (`#` → `%23`).
- `decksUsedToday` só tem valor na semana atual; semanas passadas expõem apenas o total semanal (`decksUsed`).
- `/clans/{tag}/riverracelog` pode retornar 525 ocasionalmente; o worker faz retry em 5xx.
- `participants` fica sob `standings[].clan.participants` no river race log.

## Custo

O plano Spark do Firebase (50k reads, 20k writes, 20k deletes/dia; 1 GiB) cobre o uso com folga (~10% da quota para ~20 clãs). Repositório público = Actions e Pages gratuitos. Exceder quota apenas bloqueia no resto do dia — nunca cobra.
