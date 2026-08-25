# Runbook — banco de teste local

> Escrito em 25/08/2026, depois de a suíte voltar a rodar nesta máquina.
> Antes disso, `planning/STATE.md` registrava "os testes de integração não rodam localmente" como
> bloqueio — e a causa era só esta, um container parado.

A suíte de integração precisa de um Postgres de verdade. Ela **não** usa banco em memória:
`pg-boss`, os triggers e o isolamento por família dependem do comportamento real do Postgres.

## Subir

```bash
docker run -d --name zelo-test-pg -e POSTGRES_USER=zelo_dev -e POSTGRES_DB=zelo_dev -e POSTGRES_HOST_AUTH_METHOD=trust -p 5433:5432 postgres:16-alpine
```

**`POSTGRES_HOST_AUTH_METHOD=trust` não é descuido.** O `DATABASE_URL` do `.env.local` é
`postgresql://zelo_dev@localhost:5433/zelo_dev` — **sem senha**. Subir o container com
`POSTGRES_PASSWORD` faz o Postgres exigir senha, a URL falha, e o sintoma é uma suíte que trava em
vez de dar erro claro. Já custou ~20 minutos uma vez.

É um banco descartável, na porta 5433, ouvindo só em localhost. `trust` aqui é o certo; em
produção seria inaceitável.

## Preparar o schema

```bash
DATABASE_URL="postgresql://zelo_dev@localhost:5433/zelo_dev" pnpm --filter @workspace/db run push
```

```bash
DATABASE_URL="postgresql://zelo_dev@localhost:5433/zelo_dev" pnpm --filter @workspace/db run push:raw
```

O segundo aplica o trigger de imutabilidade do `audit_log`. É fácil de esquecer e
**não é opcional** — `audit-immutability.test.ts` falha sem ele.

## Rodar a suíte

O `test:all` **não lê o `.env.local` sozinho**. As variáveis precisam estar no ambiente:

```bash
set -a && . <(tr -d '\r' < artifacts/api-server/.env.local) && set +a && export DATABASE_URL="postgresql://zelo_dev@localhost:5433/zelo_dev" && export ADMIN_PANEL_SECRET="local-admin-$(node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))")" && pnpm --filter @workspace/api-server run test:all
```

Três detalhes que quebram se forem ignorados:

| Detalhe | Por quê |
|---|---|
| `tr -d '\r'` | o `.env.local` tem fim de linha do Windows, e o `\r` entra no valor da variável |
| `ADMIN_PANEL_SECRET` **diferente** do `SESSION_SECRET` | se forem iguais, `getAdminSecret()` desabilita o painel e `admin.test.ts` falha — proteção deliberada, ver `lib/admin-auth.ts` |
| `--test-concurrency=1` | já está no script. O banco é compartilhado; paralelo dá corrida |

## Parar

```bash
docker stop zelo-test-pg
```

Para voltar depois: `docker start zelo-test-pg` — o schema continua lá. Para começar do zero:
`docker rm -f zelo-test-pg` e repetir daqui.

## Última execução verde

**432 testes, 430 passando, 2 pulados, zero falhas**, em 25/08/2026, ~410 segundos.
