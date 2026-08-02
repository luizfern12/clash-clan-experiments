# Setup do projeto (para quem fizer fork)

Guia passo a passo para configurar o dashboard do zero no seu fork. Assume que você tem conta no GitHub, um e-mail para o Firebase e acesso ao token da [RoyaleAPI](https://docs.royaleapi.com/).

---

## 1. Prerequisitos

- Node.js 18+ (para rodar worker e client localmente)
- Conta Google (Firebase)
- Token de API do Clash Royale via RoyaleAPI

### 1.1 Token da API

- Crie uma conta em https://royaleapi.com/ (ou use o portal oficial em https://developer.clashroyale.com/).
- Gere um token de `developer`.
- **Importante**: adicione o IP `45.79.218.79` (proxy da RoyaleAPI) à whitelist de IPs do token — o worker chama a API **através do proxy**, então o token precisa aceitar esse IP.
- O token não é um segredo do Firebase; ele só serve para autenticar nas chamadas de leitura da API.

## 2. Firebase

### 2.1 Projeto

1. Acesse https://console.firebase.google.com → **Add project**.
2. Dê um nome (ex.: `meu-clash-clan`) e escolha o plano **Spark** (grátis). Não é preciso habilitar Google Analytics.
3. Anote o **Project ID** (Settings → General → Your project). Ex.: `meu-clash-clan-1234`.

### 2.2 Firestore

1. Menu **Build → Firestore Database** → **Create database**.
2. Escolha **Start in production mode** (importante: com as regras do projeto, leitura pública + escrita negada).
3. Escolha a região (ex.: `nam5` ou `europe-west`) e confirme.
4. Deixe o **database ID** como `(default)` — os SDKs conectam no banco padrão sem config extra.

### 2.3 Service account (Admin SDK)

1. ⚙ **Project settings → Service accounts** → **Generate new private key**. Baixa um JSON.
2. Mantenha esse JSON em local seguro — só aparece uma vez.
3. Para o GitHub Actions, ele precisa ir em **base64** (uma linha):
   ```bash
   base64 -w0 caminho/do/service-account.json
   ```
   Copie a saída — será o secret `FIREBASE_SERVICE_ACCOUNT`.

### 2.4 Deploy das regras

As regras definem leitura pública / escrita negada. Aplique `firestore.rules`:

**Opção A (console):** Firestore → **Rules** → apague o conteúdo padrão, cole o conteúdo de `firestore.rules` do repo e clique em **Publish**.

**Opção B (CLI):**
```bash
npm install -g firebase-tools
firebase login
firebase deploy --project SEU_PROJECT_ID --only firestore:rules
```
> O repo já inclui um `firebase.json` apontando para `firestore.rules`; troque `SEU_PROJECT_ID` pelo Project ID do seu Firebase (Settings → General).

## 3. Fork e clone

```bash
git clone https://github.com/SEU_USUARIO/clash-clan-experiments.git
cd clash-clan-experiments
```

Instale as dependências:
```bash
cd worker && npm install
cd ../client && npm install
```

## 4. Rodando localmente

### Worker

Defina as env vars e rode a coleta (busca os clãs habilitados no Firestore e grava os reports):

```bash
cd worker
export ROYALE_API_TOKEN="SEU_TOKEN"
export FIREBASE_SERVICE_ACCOUNT="<base64 do service account JSON>"
npm run collect
```

Para adicionar um clã ao tracking:

```bash
npm run seed "#TAG"
# ex.: npm run seed "#LLJ8JQ99"
```

### Client

```bash
cd client
cp .env.example .env.local
```

Preencha `.env.local` com os valores públicos do Firebase (Settings → General → Your apps → App `</>` → config):

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=  # ex.: seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=    # ex.: seu-projeto-1234
VITE_FIREBASE_APP_ID=
```

> `VITE_FIREBASE_*` são valores **públicos** (o front é estático). Não são segredos. O `.env.local` já é ignorado pelo git.

Rode o app:

```bash
npm run dev
```

> Se a lista de clãs aparecer vazia, garanta que: as regras foram publicadas (passo 2.4) e existe pelo menos um clã com `enabled: true` na coleção `clans` (passo seed).

## 5. Configurar o GitHub (Actions + Pages)

1. Faça **fork** do repo (ou crie um repo público e dê push). Repo público = Actions com minutos ilimitados e Pages grátis.
2. **Secrets** (Settings → Secrets and variables → Actions → New repository secret):
   - `ROYALE_API_TOKEN` — o token da API (passo 1.1)
   - `FIREBASE_SERVICE_ACCOUNT` — o base64 do service account (passo 2.3)
3. **Variables** (mesma tela, aba Variables):
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - (os mesmos 4 valores do `.env.local`)
4. **Pages**: Settings → Pages → Source: **GitHub Actions**.

## 6. Publicar

1. Faça push na branch `main` — o workflow `deploy.yml` builda o client e publica no Pages.
2. O workflow `collect.yml` agora roda só **manualmente** (`workflow_dispatch`), pois o agendamento foi movido para o cron-job.org + Render (passo 6.5). Para uma rodada avulsa: **Actions → collect.yml → Run workflow**.
3. Se ainda não seedou clãs, faça o seed (passo 4) antes ou depois do primeiro collect — o collect só processa clãs com `enabled: true`.

> O cron do GitHub Actions não é pontual (pode atrasar de 5 min a horas). Para frequência garantida, veja o passo 6.5 (cron-job.org + Render).

## 6.5 Coletor via cron-job.org + Render (alternativa ao Actions, opcional)

O `worker/` também roda como **servidor HTTP** (`POST /collect` dispara a coleta em background e responde 202 na hora; `GET /health` para health check). Isso permite agendar a coleta com **cron-job.org** (pontual, grátis, até 1×/min) apontando para um **Render free web service** — sem depender do timing imprevisível do GitHub Actions.

> Por que não Cloudflare Workers? O plano Free limita CPU a 10 ms por invocação (inclusive Cron Trigger) — o coletor faz parsing de payloads grandes + assinatura JWT p/ Firestore e estoura o limite (Error 1102). Render free (512 MB RAM, 0.1 CPU) não tem esse limite e roda Node de verdade.

**1. Deploy no Render**
1. Crie conta em https://render.com (grátis, sem cartão).
2. **New + → Web Service** → conecte o repo → em **Root Directory** use `/` e nos comandos: Build = `cd worker && npm ci`, Start = `cd worker && npm start`.
3. Plano **Free**. O `render.yaml` do repo já define isso se preferir **Blueprint** (New + → Blueprint).
4. Em **Environment**, adicione manualmente (valores não vêm do repo):
   - `ROYALE_API_TOKEN` — token da API (passo 1.1)
   - `FIREBASE_SERVICE_ACCOUNT` — base64 do service account (passo 2.3)
5. Health check path: `/health` (Render reinicia o serviço se falhar).
6. Guarde a URL: `https://SEU-SERVICO.onrender.com`.

**2. Agendar no cron-job.org**
1. Crie conta em https://cron-job.org (grátis).
2. **Create cronjob**: URL = `https://SEU-SERVICO.onrender.com/collect`, método **POST**, schedule `*/5 * * * *` (a cada 5 min; o serviço também pode ser usado com `GET`).
3. Deixe **Save responses** ligado para depurar. Timeout de 30 s do cron-job.org não atrapalha: o endpoint responde 202 na hora e a coleta segue em background.

**3. Desligar o Actions** (quando o cron-job.org+Render estiver no ar)
No `.github/workflows/collect.yml`, o bloco `schedule:` já foi removido (só `workflow_dispatch` para rodadas manuais) — evita coletar em dobro.

**Limites verificados**: ping a cada 5 min mantém o serviço acordado (< 15 min de idle, sem cold start) e consome ~744 h/mês (abaixo das 750 h grátis). Firestore fica em ~5 k writes/dia (quota Spark: 20 k). API: ~3,5 k req/dia. Todas as execuções cabem nas quotas grátis.

## 7. Troubleshooting

| Sintoma | Causa / solução |
|---|---|
| Erro **1010** (Cloudflare) | O proxy bloqueia user-agent padrão. O worker já envia `User-Agent` customizado; se chamar a API fora do worker, adicione um header `User-Agent`. |
| **525** em `/riverracelog` | Falha transitória do proxy. O worker faz retry em 5xx; rode o collect de novo se persistir. |
| Erro **401/403 na API** | Token errado, expirado ou IP não está na whitelist do token (passo 1.1). |
| Front vazio (sem clãs) | Regras não publicadas (passo 2.4) ou nenhum clã com `enabled: true`. |
| Erro "path does not contain an even number of components" | Caminho de documento inválido no Firestore. O report vive em `clans/{id}/report/latest` (coleção `report`, doc `latest`) — 4 segmentos. |
| Tag com `%23%23` nas URLs da API | Tag duplicada ao codificar. Use o seed (`npm run seed "#TAG"`) que já normaliza (`#TAG` → `%23TAG`). |
| Quota do Firestore estourada | Plano Spark bloqueia leituras/escritas até o próximo dia; nunca cobra. Reduza clãs em tracking ou o intervalo do cron. |

## 8. Custo

Plano Spark: 50k reads, 20k writes, 20k deletes/dia, 1 GiB. Com ~20 clãs e coleta a cada 10 min, usa ~10% da quota. Repo público: Actions e Pages gratuitos. Exceder quota bloqueia no dia, não cobra.
