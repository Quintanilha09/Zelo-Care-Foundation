# `@workspace/db` — o esquema e as migrações

## A regra, em uma linha

**Produção e CI usam `migrate`. `push` existe só para desenvolvimento local, e nunca sai daí.**

---

## Por que `push` não vai para produção

O `drizzle-kit push` compara o esquema do código com o banco **vivo** e aplica a diferença na
hora. Para iterar localmente é ótimo. Em produção é uma arma apontada para o pé, e ela já
engatilhou.

Em **12/09/2026**, rodando `pnpm run push`, o drizzle-kit parou e perguntou:

> *"You are about to add `uq_treatment_scheduled_at` unique constraint to the table, which
> contains 112 items. […] **Do you want to truncate `scheduled_doses` table?**"*

`scheduled_doses` é o **histórico de dose**. Um "sim" distraído num terminal às onze da noite
apaga o registro de todo remédio que toda família já tomou.

E como o `push` é interativo, ele **não roda numa esteira automática** — o que empurra a pessoa a
rodá-lo à mão, que é exatamente onde o erro acontece.

**Se essa pergunta aparecer, pare e investigue.** Nunca responda "sim".

---

## Os comandos

| Comando | Quando | O que faz |
|---|---|---|
| `pnpm run migrate` | **produção e CI** | aplica os arquivos de `migrations/` em ordem. Não pergunta nada, não apaga nada |
| `pnpm run generate` | ao mudar o esquema | lê `src/schema/` e **escreve** um arquivo de migração novo. Não toca em banco |
| `pnpm run push` | **só local** | sincroniza o banco local com o esquema, sem gerar arquivo |

Todos precisam de `DATABASE_URL`.

---

## Como mudar o esquema

1. Edite os arquivos em `src/schema/`.
2. `pnpm run generate` — ele escreve `migrations/NNNN_nome.sql`.
3. **Leia o SQL gerado.** É onde se descobre que uma renomeação virou "apaga a coluna e cria
   outra", ou que uma constraint nova vai brigar com dado existente.
4. Rode `pnpm run migrate` contra um banco local limpo e confira que sobe.
5. Commit do esquema **e** da migração juntos. Os arquivos de `migrations/` são o histórico do
   banco: eles são a única forma de saber o que produção tem sem abrir produção.

### Migração escrita à mão

Para algo que o esquema não expressa — gatilho, índice especial, correção de dado:

```bash
pnpm run generate -- --custom --name o-que-ela-faz
```

Isso cria um arquivo vazio para você preencher. Separe cada comando com
`--> statement-breakpoint`, que é como o drizzle divide o arquivo. **Sem o separador**, um corpo
de função com `;` dentro é partido no meio e a migração falha de um jeito confuso.

---

### Se o seu banco local já existe, criado por `push`

`migrate` vai falhar nele: as tabelas já estão lá, e a migração 0000 tenta criá-las.

O caminho mais curto é recriar. Dado de desenvolvimento é descartável — o
`pnpm --filter @workspace/api-server run seed` reconstrói a família fictícia:

```bash
dropdb zelo && createdb zelo
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-server run seed
```

---

## O gatilho de imutabilidade do `audit_log`

Ele é a migração **0001**, e virou migração por um motivo concreto.

Antes vinha de `pnpm run push:raw`, um comando à parte que precisava ser lembrado **depois** de
todo `push`. Esquecê-lo não dava erro nenhum: o banco subia inteiro, os testes passavam, e a
imutabilidade do log de auditoria simplesmente não existia.

Um log de auditoria que pode ser alterado não é log de auditoria. Ele existe justamente para o
caso em que alguém tem motivo para reescrever a história.

`push:raw` continua existindo para quem monta o banco local com `push`, mas quem usa `migrate`
não precisa dele — nem pode esquecê-lo.

`audit-immutability.test.ts`, na suíte do api-server, prova que `UPDATE` e `DELETE` na tabela são
recusados **pelo banco**, inclusive via SQL puro contornando o Drizzle.

---

## Onde isto foi verificado

Em 24/09/2026, num PostgreSQL 18.6 vazio:

| Verificação | Resultado |
|---|---|
| `migrate` num banco zero | **40 tabelas**, 29 tipos, 66 chaves estrangeiras |
| Gatilho `audit_log_immutable` | presente |
| `INSERT` no `audit_log` | funciona |
| `UPDATE` / `DELETE` no `audit_log` | recusados pelo banco |
| Comandos destrutivos na migração inicial | **zero** |

---

## Os arquivos em `sql/`

São históricos, e **não** fazem parte do caminho de criação do banco:

- `audit-log-immutability.sql` — a fonte de onde a migração 0001 veio. Ainda usado pelo `push:raw`.
- `producao-schema-completo.sql` e `producao-zelo-40-56-58.sql` — despejos da época do Replit,
  guardados como registro. **Não** use para montar banco novo: use `migrate`.
