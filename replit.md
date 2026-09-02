# ZELO

App de cuidado compartilhado para famílias com idosos: vários cuidadores coordenam o registro
de medicamentos, consultas e aferições de um paciente — sem duplicidade e sem culpa.

> **Leia o [`CLAUDE.md`](CLAUDE.md) antes de editar qualquer coisa.** Ele tem os invariantes do
> produto, as armadilhas que já custaram caro e o padrão de trabalho obrigatório.
> Este arquivo cobre só o que é específico de rodar no Replit.

## Run & Operate

- Backend roda como **workflow** "artifacts/api-server: API Server" (aba Workflows) — **precisa
  ser iniciado manualmente**, não sobe sozinho. Depois de `git pull`, reiniciar por ali.
- **Nunca rodar `pnpm run dev` no Shell para isso** — dá erro de `PORT` faltando. Quem define
  essa variável é o mecanismo de Workflow, não o shell.
- `pnpm run typecheck` — typecheck de todos os pacotes
- `pnpm run build` — typecheck + build
- `pnpm --filter @workspace/api-server run test:all` — suíte completa (precisa de `DATABASE_URL`
  e `ADMIN_PANEL_SECRET`)
- `pnpm --filter @workspace/db run push` — schema (dev)
- `pnpm --filter @workspace/db run push:raw` — trigger de imutabilidade do `audit_log`
- `pnpm --filter @workspace/api-spec run codegen` — regenera hooks e schemas Zod a partir do
  OpenAPI. **Depois de rodar, reescreva `lib/api-zod/src/index.ts`** — ver `CLAUDE.md`.

## Stack

pnpm workspaces, Node.js 24, TypeScript 5.9, Express 5, PostgreSQL + Drizzle, Zod, pg-boss,
Orval, esbuild. Detalhe em [`planning/decisoes/FOUNDATION.md`](planning/decisoes/FOUNDATION.md).

## Secrets necessários

`DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`, `ADMIN_PANEL_SECRET`, `APP_URL`, `RESEND_API_KEY`.

### E-mail — `APP_URL` virou obrigatório de verdade (Issue #73, 02/09/2026)

| Variável | Papel |
|---|---|
| `RESEND_API_KEY` | chave do Resend, escopo `sending_access`, presa a `zelocuida.com.br`. Sem ela **não há provedor**: o cadastro por e-mail e senha se recusa a criar conta e manda pelo Google |
| `APP_URL` | `https://zelo-care-foundation.replit.app`. É a base de **todo link** que sai por e-mail |
| `EMAIL_FROM` | opcional. Padrão: `ZELO <contato@zelocuida.com.br>` |

**Por que `APP_URL` deixou de ser detalhe.** Até a Issue #73 ela era lida só por
`lib/email.ts`, que não enviava nada — a auditoria de 23/08/2026 chegou a
registrar que faltava nos Secrets e que não quebrava nada. Agora quebra: sem
ela, `baseUrl()` cai em `http://localhost:5173` e **todo link sairia apontando
para a máquina de quem lê**. O e-mail chegaria bonito e inútil.

Por isso `hasEmailProvider()` exige as duas em produção: faltando `APP_URL`, o
envio fica desligado de propósito e o cadastro segue pelo Google. Falha barulhenta
em vez de e-mail morto.

**`NODE_ENV` não é definido pelo Replit** — e o código trata a ausência como **produção**, de
propósito. Não "conserte" isso definindo `NODE_ENV=development` no deploy: era exatamente essa
suposição invertida que deixava rotas de dev expostas em produção.

## Onde as coisas moram

| Precisa de | Vá para |
|---|---|
| Regras de trabalho e invariantes | [`CLAUDE.md`](CLAUDE.md) |
| Estado atual do projeto | [`CONTEXT.md`](CONTEXT.md) |
| Schema do banco | `lib/db/src/schema/` — e `lib/db/sql/producao-schema-completo.sql` |
| Contrato da API | `lib/api-spec/` (OpenAPI) → `lib/api-zod/` (gerado) |
| Rotas | `artifacts/api-server/src/routes/` |
| Frontend | `artifacts/zelo/` |
| Montar o banco de produção do zero | [`planning/runbooks/banco-de-producao.md`](planning/runbooks/banco-de-producao.md) |

## Gotchas do ambiente Replit

- **O banco não é versionado pelo git.** `git reset --hard` reseta o código; o schema fica como
  estava. Já apareceu coluna órfã que nunca existiu no schema local.
- **`drizzle-kit push` morre em silêncio** contra o banco de produção pelo Shell. Use
  `lib/db/scripts/aplicar-sql.mjs`, que verifica o resultado no `information_schema`.
- **A configuração de portas vive no `.replit`** e está versionada. Se os workflows pararem de
  subir, é o primeiro lugar a olhar.
- **Front mais novo que a API** produz "Rota não encontrada" na tela: é deploy de frontend sem
  reiniciar o workflow da API.
