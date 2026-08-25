# ZELO — contexto de continuidade

> Ponto de entrada de qualquer sessão. Se você só puder ler dois arquivos, leia
> [`CLAUDE.md`](CLAUDE.md) e este.
>
> **Regra deste arquivo:** nenhum número aqui pode ser copiado de outro documento. Ou foi medido
> na sessão que o escreveu, ou vem rotulado com a data e a origem da medição.

**Última revisão:** 23/08/2026.

---

## O que é

PWA de cuidado compartilhado para famílias com idosos: vários cuidadores coordenam o registro de
medicamentos, consultas e aferições de um paciente — sem duplicidade, sem culpa.

- **Repositório:** [Quintanilha09/Zelo-Care-Foundation](https://github.com/Quintanilha09/Zelo-Care-Foundation) — **público**
- **Clone local:** `C:\Projetos\Zelo\Zelo-Care-Foundation`
- **Branch padrão:** `main`
- **Monorepo pnpm:** `artifacts/api-server`, `artifacts/zelo`, `artifacts/mockup-sandbox`, `lib/*`, `scripts`

## Como se trabalha aqui

Desde 16/08/2026, **a implementação é direta: Claude Code edita o repositório local, roda os testes
e dá push.** O Replit deixou de ser quem escreve o código — é onde o fundador **testa** o app
publicado. Depois de cada push, o fluxo é `git pull` no Replit e reiniciar o workflow "API Server"
(não só o Preview).

O agente `story-para-replit` ficou reservado para os casos raros de algo específico da hospedagem.

---

## Estado verificado em 23/08/2026

Medido nesta data, nesta máquina:

| Fato | Valor | Como foi medido |
|---|---|---|
| Tabelas no schema | **32** | `pgTable(...)` em `lib/db/src/schema/` — medido em 25/08/2026. `media_assets` (QUI-5) ainda NÃO está em `producao-schema-completo.sql` |
| Arquivos de rota | **33** | `artifacts/api-server/src/routes/*.ts`, incluindo o `index.ts` |
| Módulos em `lib/` | **31** | `artifacts/api-server/src/lib/*.ts` |
| Middlewares | **2** | `require-auth.ts` e `require-patient-access.ts` |
| Arquivos de teste | **38** | `src/tests/*.test.ts` |
| Consistência da suíte | **limpa** | 38 referenciados no `test:all` = 38 no disco; nenhum órfão, nenhum fora |
| Typecheck do monorepo | **exit 0** | `pnpm run typecheck` — 4 pacotes, todos limpos |
| Modelo de visão | `claude-haiku-4-5-20251001` | `lib/vision.ts` |
| Fila | **pg-boss** sobre o mesmo Postgres | `lib/queue.ts` |

### Contagem de testes passando — medida em 25/08/2026

**454 testes, 452 passando, 2 pulados, zero falhas.** Executado localmente nesta máquina, contra o
Postgres em Docker descrito em [runbooks/banco-de-teste-local.md](planning/runbooks/banco-de-teste-local.md),
com `ADMIN_PANEL_SECRET` diferente do `SESSION_SECRET`. Duração: ~424 s.

Antes disso a última execução verde conhecida era de 21/08/2026, no Replit: 395 de 397.

**A suíte voltou a rodar localmente.** O bloqueio de 23/08 era o container `zelo-test-pg`
parado e o `.env.local` apontando para uma URL sem senha. Resolvido subindo o Postgres com
`POSTGRES_HOST_AUTH_METHOD=trust`, que é o que a URL do `.env.local` espera — o runbook tem
os comandos.

> `NÃO VERIFICADO`: `pnpm run build` na raiz continua falhando no `mockup-sandbox` por falta do
> binário nativo do rollup, consequência conhecida do `pnpm-workspace.yaml` excluir binários
> não-Linux. Não é regressão e não afeta a API: `pnpm --filter @workspace/api-server run build`
> termina limpo.

---

## Onde está o desenvolvimento

**41 histórias entregues.** O backlog codificável está **esgotado** — as histórias restantes
dependem de decisão de fornecedor, de trabalho comercial/jurídico do fundador, ou de um gatilho
que exige usuários reais em produção.

O trabalho disponível hoje é manutenção, correção, segurança e qualidade.

Detalhamento, fases, pendências de deploy e decisões em aberto: [`planning/STATE.md`](planning/STATE.md).

## Ambiente

**Desenvolvimento apenas.** O banco de produção está **vazio e pausado** por limite de gasto
(teto de US$ 1 atingido) — decisão do fundador em 21/08/2026 foi seguir só em DEV. O app publicado
nunca esteve funcional: servia a tela de login sem banco por trás.

Roteiro completo para montar produção quando o crédito voltar:
[`planning/runbooks/banco-de-producao.md`](planning/runbooks/banco-de-producao.md).

---

## Segurança

Auditoria completa em **21/08/2026** contra OWASP (injeção, XSS, SSRF, LLM01/05/06/10, segredos,
dados sensíveis, observabilidade, dependências): **9 achados corrigidos, 4 avaliados sem ação**.
Relatório: [`planning/auditorias/2026-08-21-seguranca.md`](planning/auditorias/2026-08-21-seguranca.md).

O achado mais grave não foi uma linha errada, foi um **padrão** errado: cinco proteções perguntavam
`process.env.NODE_ENV !== "production"`, e como `undefined !== "production"` é verdadeiro, o deploy
do Replit — que não define a variável — rodava com todas elas desligadas, incluindo **rotas de
manipulação do relógio expostas sem autenticação nenhuma**.

**Risco aceito e ainda em aberto:** refresh token em `localStorage`. Deve ser reavaliado **antes de
haver usuário real**.

---

## Consolidação do contexto — 23/08/2026

Até esta data o contexto do projeto vivia em **seis lugares**: `planning/` num vault do Obsidian
separado, `FOUNDATION.md` e `PLATFORM_DECISIONS.md` na raiz, `.agents/memory/` com seis arquivos,
`replit.md` (template em branco), um `CONTEXT.md` que existia só numa branch de CI, e a memória
global do agente.

**Isso causou dano real, verificável:**

- `.agents/memory/zelo-foundation-state.md` — citado por outro agente como fonte de verdade —
  descrevia uma tabela `patient_caregivers` e um teste `patient-role-matrix.test.ts` que
  **nunca existiram**. A referência a esse teste no `test:all` deixou a suíte inteira quebrada no
  `main` sem ninguém perceber.
- `PLATFORM_DECISIONS.md` dizia que a extração de receita usava "GPT-4o ou similar" e que a fila era
  um worker com polling de 30s sobre a tabela `alert_escalations`. Nada disso corresponde ao código:
  é Claude Haiku 4.5, é pg-boss, e `alert_escalations` foi removida do schema.
- Duas sessões de agente trabalharam simultaneamente com quadros diferentes do mesmo projeto.

**Decisão do fundador:** o contexto passa a viver **inteiramente neste repositório**. Não há mais
contexto do ZELO no vault do Obsidian. `.agents/memory/` foi consolidado e reduzido a um ponteiro.

O índice do que está onde fica no [`CLAUDE.md`](CLAUDE.md).

---

## Em aberto

- **PR #1 (`chore/github-actions-ci`)** adiciona `.github/workflows/validate.yml` (Postgres efêmero,
  typecheck, lint de relógio, suíte, build; permissão `contents: read`, segredos sintéticos).
  Está **atrasada em relação ao `main`**: reverte o guardrail de consistência da suíte e restaura o
  arquivo de memória removido. **Precisa de rebase antes de qualquer merge.**
- Só tornar o check obrigatório e proteger o `main` depois de uma execução verde e revisada.
- `admin.test.ts` depende de `ADMIN_PANEL_SECRET` externo para rodar — merece mudança separada.
- **Uma sessão de agente por vez no `main`.** Duas simultâneas já produziram um rebase preso e a
  referência órfã que quebrou a suíte.
