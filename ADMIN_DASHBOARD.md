# Plano — Dashboard de Admin

> Planejamento (rascunho) para a próxima sessão. Decisões em aberto marcadas com **[DECIDIR]**.

## Objetivo

Dar ao líder do clã controle de gestão no próprio site (hoje o app é 100% leitura; gestão de clãs é feita via `seed.js` no console). Sem custo adicional (Firebase Spark, repo público).

## Contexto / restrições atuais

- Front lê Firestore direto; **escrita é negada** nas `firestore.rules` (só Admin SDK escreve).
- Clãs em tracking: coleção `clans/{id}` (`enabled` bool). Adicionar/remover = `npm run seed`.
- Regras de promoção são **hardcoded** no worker (`analyze.js`: médias 4/8 > 2500).
- O token da API **não pode** ir para o client (segredo) — o client não pode chamar a RoyaleAPI.

## Arquitetura proposta

```
Admin (Google Sign-In via Firebase Auth)
  │  rules: escrita permitida APENAS p/ UID em `admins`
  ▼
Firestore ──▶ worker (Admin SDK, inalterado em essência)
                 │ lê regras por clã (se configuradas) do doc clans/{id}
                 └── continua pré-computando report/latest
```

### Autenticação

- Ativar **Firebase Auth → Google** no console (gratuito).
- Coleção `admins/{uid}` = `{ email, addedAt }`, preenchida via script/console (não pelo client).
- Client: botão "Entrar" (Google) na aba Admin; `admins/{uid}` define se é admin.

### Regras do Firestore (mudança)

```js
// escrita só p/ admin autenticado; leitura continua pública
match /clans/{clanId} {
  allow read: if true;
  allow write: if request.auth != null
    && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}
match /clans/{clanId}/{document=**} {
  allow read: if true;
  allow write: if request.auth != null
    && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}
match /admins/{uid} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false; // só via Admin SDK
}
```

> `exists()` exige regras que acessem outro doc — ok no Firestore (custo de leitura extra no write, desprezível).

### Escrita de clã sem expor o token

O client **não** consulta a API. Fluxo ao adicionar clã:
1. Admin digita a tag (`#ABC123`).
2. Client cria `clans/{id}` com `{ tag, enabled: true, addedAt, source: 'admin' }` (sem nome).
3. No próximo collect, o worker enriquece `name`/`badgeId` (como o seed faz) e, se a tag for inválida, marca `invalid: true`.
4. Admin vê a lista com status (pendente/válido/inválido) e pode remover/desabilitar.

### Regras de promoção configuráveis por clã (opcional, v1 ou v2)

- Doc `clans/{id}` ganha `rules`: `{ elderWars, coLeaderWars, elderThreshold, coLeaderThreshold }`.
- `analyze.js` passa a receber as regras (defaults = atuais: 4/8, 2500).
- UI de admin edita esses campos.

## Escopo sugerido

### v1 (primeira sessão)
1. Firebase Auth (Google) + coleção `admins` + script para adicionar admin.
2. Regras atualizadas (escrita admin-only) + deploy.
3. Aba **Admin** no front:
   - Login Google + indicador de admin.
   - **Gestão de clãs**: listar (nome, tag, enabled, último collect), adicionar por tag, desabilitar/habilitar, remover.
   - **Status da coleta**: por clã — `report.updatedAt`, nº de dias diários, nº de membros, guerras.
4. Worker: enriquecer clan doc ao coletar (name/badge) e marcar inválido quando a tag falhar.

### v2 (futuro)
- Regras de promoção configuráveis por clã (UI + `analyze.js` parametrizado).
- KPIs na aba Admin: total de membros, ataques da semana, candidatos a promoção.
- Export CSV (tabela diária / relatório).
- Log de ações de promoção (proposto → aplicado, feito pelo admin).
- (Opcional) workflow de Actions para `firebase deploy --only firestore:rules` com `FIREBASE_TOKEN` secret.

## Tarefas para a próxima sessão (ordem)

1. Criar `admins` no console + script `worker/src/addadmin.js` (usa Admin SDK).
2. Atualizar `firestore.rules` + deploy.
3. Adicionar dep `firebase/auth` no client; hook `useAuth` (Google Sign-In); estado `isAdmin` via `onSnapshot(admins/{uid})`.
4. Aba Admin: gestão de clãs (add por tag / enable / disable / remove) + status da coleta.
5. Worker `collect.js`: enriquecer doc do clã (`name`, `badgeId`, `invalid`).
6. Testar de ponta a ponta (local + deploy).

## Pendências / decisões

- **[DECIDIR]** Quem são os admins? (1 UID basta para começar — o do dono.)
- **[DECIDIR]** Remover clã = apagar o doc `clans/{id}` (e perder reports diários) ou apenas `enabled:false`? Recomendo `enabled:false` (mantém histórico).
- **[DECIDIR]** Regras configuráveis entram na v1 ou na v2?
- **[DECIDIR]** Precisa de logout explícito ou login é suficiente?
- **[DECIDIR]** Hospedar/limitar a aba Admin (oculta para não-admins).
