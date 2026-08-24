# Fase 11 — Correção pós-auditoria

> Primeiro `CONTEXT` de fase desde a 04, e a primeira fase a nascer já sob o padrão fixado em
> [`../README.md`](../README.md). Ela **precisa** fechar com `11-VERIFICATION.md` — seria o primeiro
> artefato de verificação da história do projeto.

## De onde esta fase vem

Não vem do roadmap de produto. Vem da **auditoria §10 do GSD**
([`../../auditorias/2026-08-23-gsd-secao-10.md`](../../auditorias/2026-08-23-gsd-secao-10.md)), que
aplicou ao código construído antes do GSD o procedimento de 12 passos. O plano de correção é o
passo 10 daquele documento; esta fase é o passo 11.

## O que a fase precisa saber antes de começar

**1. O app publicado não deixa ninguém entrar por e-mail e senha.**
Nenhum e-mail é enviado em produção (`lib/email.ts` só escreve `logger.warn`), o login exige
`emailVerified`, e a auto-verificação só roda em desenvolvimento. Só o Google funciona. Isso não é
regressão recente: a correção de segurança de 21/08 fechou um furo real e, ao fazê-lo, expôs um gap
que já existia por baixo.

**2. A rede de proteção tem um buraco de forma, não de conteúdo.**
Os 33 testes do motor de recorrência passam — só nunca rodam no CI. O guardrail que deveria pegar
isso só varre `artifacts/api-server/src/tests/`. É a mesma classe do incidente de 21/08, um
diretório ao lado.

**3. As 15 restrições CON estão todas conformes.**
Verificadas contra o código pela primeira vez nesta auditoria: 15 de 15. **Nenhuma correção desta
fase pode quebrá-las** — são violação bloqueante segundo o [`config.json`](../../config.json).
Atenção especial à CON-010 na fase 11.3, que mexe em estilo.

**4. O ambiente exige reinstalação depois de mover a pasta.**
`pnpm install --frozen-lockfile`. Mover o repositório deixa todos os symlinks apontando para o
caminho antigo, e o sintoma (`tsc` não encontrado) não menciona caminho nenhum.

## Restrições desta fase

- **Não reativar a auto-verificação de e-mail em produção.** Fechá-la estava certo.
- **Não redesenhar nada.** A fase 11.3 corrige a base tipográfica e confere o que quebra — não é
  oportunidade de refazer telas.
- **Não construir suíte ampla de frontend.** A 11.5 é deliberadamente pequena: contrato de API e
  ausência de estado mudo, só isso.
- **Não fazer a 11.6** (papel por paciente) sem caso de uso real. É mudança arquitetural com zero
  usuários em produção.
- **Não mergear a PR #1 sem rebase** — como está, ela reverte o guardrail de consistência.

## Ordem

**11.2 → 11.3 → 11.1a → 11.4 → 11.5.** A 11.2 (fazer a rede de proteção rodar) vem primeiro de
propósito: consertar com a verificação desligada é como o projeto chegou até aqui.

`11.1b` (provedor de e-mail) entra quando o fundador decidir. `11.6` fica adiada.

## Estado do ambiente para verificar esta fase

`NÃO VERIFICADO em 23/08/2026:` a suíte completa do api-server **não roda localmente**. O
`.env.local` aponta para um Postgres em Docker na 5433 que está fora do ar; o Postgres nativo na
5432 tem a base `zelo_dev` mas exige senha que a URL não carrega.

Antes de fechar qualquer parte desta fase, **isso precisa ser resolvido** — senão a verificação vira
a mesma afirmação sem evidência que a auditoria encontrou. Dois caminhos: subir o Docker Desktop e o
container `zelo-test-pg`, ou definir senha para o papel `zelo_dev` na instância nativa e ajustar o
`.env.local`.

O que roda hoje sem banco: `pnpm run typecheck` (exit 0, 4 pacotes), `pnpm run test:libs`
(33 casos, 33 passando) e `pnpm --filter @workspace/api-server run lint:clock`.
