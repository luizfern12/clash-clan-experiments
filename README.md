# Clash Clan Experiments

Web app que analisa um clã do Clash Royale usando a API oficial via o [proxy da RoyaleAPI](https://docs.royaleapi.com/proxy.html) (funciona a partir de IPs dinâmicos).

## Funcionalidades

- **Relatório de promoções**: para cada membro, calcula a média de fama das últimas 4 e 8 guerras do rio e emite avisos de promoção (membro → ancião com média 4 > 2500; ancião → co-líder com média 8 > 2500).
- **Ataques de Guerra**: gráfico com o total de ataques (`decksUsed`) das últimas 7 semanas + a semana atual (inclui ataques de hoje, via `decksUsedToday`).

O app é somente leitura — não executa nenhuma ação no clã.

## Arquitetura

```
server/   Node.js + Express REST API (porta 3001)
client/   React + Vite SPA (porta 5173), faz proxy de /api para o backend
```

### Endpoints

| Método | Rota                          | Descrição |
|--------|-------------------------------|-----------|
| GET    | `/health`                     | Health check |
| GET    | `/api/clan/:tag`              | Relatório de promoções (`{ clan, racesAnalyzed, members[], warnings[] }`) |
| GET    | `/api/clan/:tag/war-attacks`  | Ataques de guerra (`{ clan, players, weeks[] }`) |

## Como rodar

Requisitos: Node.js 18+ (usa `fetch` nativo).

1. Token da API: defina `ROYALE_API_TOKEN` ou crie um `AGENTS.md` na raiz com a linha `Token: <seu_token>` (o arquivo é ignorado pelo git). O token precisa ter o IP `45.79.218.79` na whitelist (IP do proxy).
2. Backend:
   ```
   cd server && npm install && npm start
   ```
3. Frontend:
   ```
   cd client && npm install && npm run dev
   ```
4. Abra http://localhost:5173 e insira a tag do clã (ex.: `#LLJ8JQ99`).

## Notas da API

- Use `https://proxy.royaleapi.dev/v1` em vez de `https://api.clashroyale.com/v1`.
- O proxy é protegido por Cloudflare e bloqueia user-agents padrão (`Python-urllib`/`undici`, erro 1010); o app envia um `User-Agent` customizado.
- Tags de clã devem ser URL-encoded (`#` → `%23`).
- `decksUsedToday` só tem valor na semana atual; semanas passadas expõem apenas o total semanal (`decksUsed`). Não há histórico por dia por jogador na API oficial.
- `/clans/{tag}/riverracelog` pode retornar 525 ocasionalmente; o backend faz retry em 5xx.

## Roadmap

- GitHub Actions com cron diário para capturar snapshots diários de `decksUsed` por jogador e montar a tabela de ataques por dia.
