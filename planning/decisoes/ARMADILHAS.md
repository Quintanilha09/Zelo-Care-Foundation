# ZELO — Armadilhas conhecidas

> Consolidação de `.agents/memory/` em 23/08/2026. Cada item abaixo foi **reconferido contra o
> código** nesta data; o que não se sustentou foi removido e está registrado no fim do arquivo.
>
> O resumo operacional está em [../../CLAUDE.md](../../CLAUDE.md). Aqui fica o detalhe e o porquê.

---

## Ambiente

### Nunca compare `NODE_ENV` diretamente

```ts
// ERRADO — `undefined !== "production"` é true
if (process.env.NODE_ENV !== "production") { ...atalho... }

// CERTO
import { allowsDevelopmentShortcuts, IS_PRODUCTION } from "./lib/environment.ts";
```

**Por quê:** o deploy do Replit não define `NODE_ENV`. O padrão errado deixou cinco proteções
desligadas em produção, incluindo rotas de manipulação do relógio expostas sem autenticação.

Um teste em `environment-hardening.test.ts` varre o código-fonte e falha se o padrão voltar.

### Testes são reconhecidos por `NODE_TEST_CONTEXT`

O test runner do Node define essa variável sozinho. É por isso que a suíte roda sem
`NODE_ENV=test` na linha de comando — sintaxe que o shell do Windows não aceita — e sem
precisar de `cross-env` como dependência.

---

## Log e segredos

### `safeLog` sanitiza o contexto, não a mensagem

```ts
safeLog.info({ token }, "verificação enviada");   // OK — contexto é sanitizado
safeLog.info({}, `verificação: ${token}`);        // FURO — mensagem passa intacta
```

O 1º argumento passa pela allowlist; o 2º não. Um token interpolado na mensagem contorna a
proteção inteira — foi exatamente o que acontecia no cadastro. Há teste varrendo o código-fonte
atrás desse formato.

---

## Relógio

### `Clock.now()` sempre; `new Date()` nunca em domínio

`pnpm run lint:clock` falha se lógica de domínio usar `new Date()` ou `Date.now()` diretamente.

### JWT: `iat` precisa vir do `Clock`

`generateAccessToken` usa `Clock.now()` para `iat`/`exp` explícitos.
`revokeAllAccessTokensForUser` grava `Math.floor(Clock.now().getTime() / 1000)`.
`isAccessTokenRevoked` compara com `payload.iat < logoutAtSec` — **estritamente menor**.

**Por quê:** `iat` tem resolução de 1 segundo. Se a revogação usar `Clock.now()` e o `jwt.sign`
usar `Date.now()`, depois de um `Clock.advance()` nos testes o `logoutAtSec` fica à frente do
`iat` real e o token novo é rejeitado indevidamente. O `<` (não `<=`) evita rejeitar tokens
emitidos no mesmo segundo do logout-all.

Nos testes de theft detection, `Clock.advance(1001)` **antes** do ataque.

### `freezeAt` + `advance` são cumulativos

`Clock.freezeAt(date)` define a base; `Clock.advance(ms)` soma sobre ela. Permite simular a
cascata de escalonamento (15/30/60min) nos testes.

### O relógio do cliente não é fonte de verdade

Não mande `takenAt` para dizer "acabei de tomar" — ausente significa "agora, segundo o
servidor". Horário explícito até 5 minutos no futuro é tratado como dessincronia e ancorado em
"agora"; futuro real (dose de amanhã) segue recusado. Registro **retroativo** continua mandando
instante explícito, que é o caso em que a intenção sobre o horário importa de fato.

---

## Testes

### `--test-concurrency=1` é obrigatório

`node --test` roda arquivos em paralelo por padrão. Com banco compartilhado isso causa race
condition em contagem e cleanup. `test:all` usa `tsx --test --test-concurrency=1`.

### Hooks `before` idempotentes

Se o cleanup falhou num run anterior, o próximo tenta criar o mesmo usuário e quebra com
"duplicate key". Padrão: deletar os dados de teste no início do `before`, com `.catch(() => {})`.

### Testes de auth não podem revogar tokens usados adiante

Em `isolation.test.ts`, o teste de `POST /auth/logout` usa um token temporário — não o `tokenA`,
que precisa continuar válido nos testes seguintes de `/export` e `/consent`.

### Todo `.test.ts` no `test:all`, e vice-versa

Um guardrail em `environment-hardening.test.ts` trava os dois lados:
- referência a arquivo que não existe → quebra a suíte inteira (`tsx --test` sai com 1);
- arquivo de teste fora do `test:all` → nunca roda no CI, falha em silêncio.

Já aconteceu: `patient-role-matrix.test.ts` ficou referenciado sem nunca ter existido, e a suíte
ficou vermelha no `main` sem ninguém perceber.

### `tsx` vs `--experimental-strip-types`

- `--experimental-strip-types` só para testes que **não** importam `@workspace/db`.
- `tsx` para seed e testes de integração.

**Por quê:** `--experimental-strip-types` no Node 24 não suporta import de diretório
(`import from "./schema"` sem extensão) e falha com `ERR_UNSUPPORTED_DIR_IMPORT`.

### Erro de constraint via Drizzle vem embrulhado

O Drizzle envolve o erro do `pg` num objeto próprio. Para detectar violação de unique (23505),
cheque **`err.code` e `err.cause?.code`**:

```ts
const code = e.code ?? e.cause?.code;
const msg = (e.message ?? "") + (e.cause?.message ?? "");
assert.ok(code === "23505" || msg.includes("unique") || msg.includes("duplicate"));
```

### Seed é idempotente pelo slug

Chave: `families.slug = "familia-ficticia-teste"` (UNIQUE). A segunda execução detecta e encerra
sem inserir. Para re-semear:
`DELETE FROM families WHERE slug = 'familia-ficticia-teste' CASCADE`.

---

## TypeScript

### Module augmentation de Express não funciona neste projeto

Não use `declare module "express-serve-static-core" { interface Request { user? } }`.

**Por quê:** `isolatedModules: true` no `tsconfig.base.json` impede que augmentations se
propaguem entre arquivos. Triple-slash reference e import do `.d.ts` também não resolvem.

**Padrão correto:** `getAuth(req)` de `src/lib/auth-types.ts`. Nunca criar
`src/types/express.d.ts` com augmentation — quebra o `IRouter` e outros tipos do módulo.

### `noEmit` + `allowImportingTsExtensions` no api-server

Obrigatório para os testes que importam `.ts` via `tsx`. O build usa esbuild (`build.mjs`),
não `tsc` — `noEmit` não afeta o build.

### `?? []` infere `never[]`

```ts
const refs = texto.match(/.../g) ?? [];        // never[] — .includes(string) não compila
const refs: string[] = texto.match(/.../g) ?? []; // certo
```

### Middleware muda o tipo de `req.params`

Adicionar middleware faz `req.params.x` virar `string | string[]`. Resolva com genérico na rota:
`router.get<{ rawToken: string }>(...)`.

---

## Orval / codegen

Depois de `pnpm --filter @workspace/api-spec run codegen`, o Orval **sobrescreve**
`lib/api-zod/src/index.ts` e readiciona `export * from './generated/types'`, causando TS2308
(nomes como `ListScheduledDosesParams` colidem).

**Sempre reescrever o arquivo após o codegen**, deixando só:

```ts
export * from "./generated/api";
// NÃO reexportar ./generated/types
```

Use `z.infer<typeof SomeSchema>` para derivar tipos.

---

## Express

### Rota sem parâmetro antes de rota com parâmetro

`GET /patients/today-summary` era engolida por `GET /patients/:patientId` — o Express casava
`"today-summary"` como id e devolvia 400. Foi movida para `/dashboard/today-summary`: um prefixo
próprio elimina a ambiguidade **por construção**, em vez de depender da ordem de montagem.

---

## Build

### Cuidado com o que vai para `external` no esbuild

`build.mjs` tinha `"@swc/*"` na lista de externos. Vale para `@swc/core` (nativo), mas
`@swc/helpers` é JS puro e é dependência real do `fontkit`, usado pelo `pdfkit`. Resultado: o
servidor não subia em produção. Externalizar por curinga é arriscado.

---

## Banco

### `drizzle-kit push` morre em silêncio no Replit

Contra o banco de produção pelo Shell do Replit, o processo é encerrado no "Pulling schema" sem
mensagem de erro — a conexão em si funciona. Use `lib/db/scripts/aplicar-sql.mjs`, que executa
um `.sql` revisado e **verifica o resultado** no `information_schema`.

### O trigger de imutabilidade não vem do Drizzle

`lib/db/sql/audit-log-immutability.sql`, aplicado por `pnpm run push:raw`. Banco novo do zero
não tem. É idempotente — rodar sem necessidade não faz mal.

### Ao remover e adicionar coluna na mesma leva, faça em dois `push`

O prompt "isso é rename?" do `drizzle-kit` trava fora de ambiente interativo. Primeiro só a
coluna nova, depois só a remoção.

**Regra geral para qualquer prompt "adicionar sem truncar" vs "truncar": sempre a primeira
opção.** Nunca truncar dado real sem motivo específico.

### O banco não é versionado pelo git

Um `git reset --hard` reseta o **código**; o schema do banco fica como estava. Já apareceu
coluna órfã no Replit que nunca existiu no schema local. Depois de `push`, **revise a lista de
colunas que o drizzle-kit propõe remover** — pode haver funcionalidade real ali.

---

## Removido nesta revisão — não era verdade

O antigo `.agents/memory/zelo-foundation-state.md` afirmava, e **nada disso existe no código**:

| Afirmação | Realidade verificada em 23/08/2026 |
|---|---|
| Tabela `patient_caregivers` com par UNIQUE `(patientId, caregiverId, role)` | Não existe em nenhum arquivo do repositório. O papel é por **família** (`caregivers.role`) |
| "papel por paciente verificado no DB a cada requisição" | Não acontece. É um **gap documentado** no cabeçalho de `lib/capabilities.ts` |
| `test:all` inclui `patient-role-matrix.test.ts` | O arquivo nunca existiu em nenhuma branch. A referência quebrou a suíte inteira |
| "144 testes passando" | Defasado em centenas |
| "21 tabelas" (versão da branch de CI) | São 31 |

**Lição:** a origem provável é alguém ter lido o gap documentado em `capabilities.ts` ("exigiria
uma tabela de junção cuidador × paciente") e registrado como **implementado**. Uma memória
descrevendo o que *deveria* existir, tratada depois como descrição do que existe, custou uma
suíte quebrada no `main` e um agente inteiro trabalhando com o modelo de dados errado.

Nunca escreva num artefato um fato que você não mediu.
