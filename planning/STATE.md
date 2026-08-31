# STATE — onde o ZELO está

> **Isto é *estado*, não diário.** O que aconteceu está em `historico/`:
> [DIARIO-ate-2026-08-23.md](historico/DIARIO-ate-2026-08-23.md) cobre 16/08 a 23/08, e
> [DIARIO-2026-08-24-a-2026-08-31.md](historico/DIARIO-2026-08-24-a-2026-08-31.md), 24/08 a 31/08.
> O que cada história entregou está em [HISTORIAS.md](HISTORIAS.md); os números verificados, em
> [../CONTEXT.md](../CONTEXT.md).
>
> **Regra:** atualizar ao finalizar qualquer implementação, antes de encerrar a sessão. Se este
> arquivo voltar a passar de ~150 linhas, mova o excedente para `historico/` — foi por virar diário
> que ele parou de ser lido. **Já aconteceu duas vezes:** 609 linhas em 23/08, 286 em 31/08/2026.
>
> Última revisão: 31/08/2026.

---

## Posição

**53 histórias entregues:** 38 das 42 do backlog original; ZELO-56, ZELO-57 e ZELO-58, criadas
depois a partir de refinamento; QUI-5, QUI-6, QUI-7, QUI-8 e QUI-11 em 25/08/2026; QUI-10 e QUI-14
em 27/08/2026; QUI-15 a QUI-19 em 30–31/08/2026.

Os dois projetos abertos no Linear depois do backlog original estão **fechados**: **ZELO — Momentos**
em 27/08/2026, com a QUI-9 (vídeo) cancelada por decisão, e **ZELO — Interface e Conta** em
31/08/2026. Como cada um chegou lá está no [diário](historico/DIARIO-2026-08-24-a-2026-08-31.md).

Das 10 fases do backlog original só sobraram três buracos, todos deixados de propósito: **ZELO-31**
(SMS) na fase 06, **ZELO-39** (assinatura) na 09, e a **fase 10 em 1/4**. A tabela por fase vive em
[HISTORIAS.md](HISTORIAS.md#fases) — não duplicar aqui.

> **A contagem passou de 52 para 53 em 31/08/2026:** a QUI-14 nunca tinha entrado, embora entregue
> em 27/08 (Issue #26, PR #27, commit `610f4d3`). O `CONTEXT.md` ainda diz 47 — certo quando foi
> escrito, defasado desde então.

---

## Ambiente

- **Desenvolvimento apenas** (decisão do fundador, 21/08/2026) — todo dado que existe é de dev.
  **O banco de produção está vazio e pausado por limite de gasto** (teto de US$ 1 atingido), e o
  app publicado nunca esteve funcional: servia a tela de login sem banco por trás.
- Para montar produção quando o crédito voltar: [runbooks/banco-de-producao.md](runbooks/banco-de-producao.md)
  — schema completo já gerado e testado, trigger de imutabilidade, secrets faltando, URL do OAuth.
- **Verificação visual só acontece no Replit.** O roteamento de `/api` para o backend é da
  infraestrutura dele (`router = "application"`), não reproduzido localmente.
- **A suíte não roda mais nesta máquina**, desde 31/08/2026: o Smart App Control do Windows bloqueia
  `argon2.glibc.node` e `biome.exe`, e sem o argon2 a API nem sobe — vão junto a integração e o
  Playwright. **O CI em Linux é a única verificação real**, e todo número novo sai do log dele, com
  o id da execução ([../CONTEXT.md](../CONTEXT.md)). O runbook do banco de teste local segue válido
  para quando destravar: [runbooks/banco-de-teste-local.md](runbooks/banco-de-teste-local.md).
- **Portões de CI** (`.github/workflows/validate.yml`, no `main` desde 26/08/2026): typecheck, lint
  de relógio, suíte do servidor, build, **Biome** e **Playwright**; o **Knip** é relatório e não
  falha o build. **Nada de código entra no `main` sem Issue e PR** — [CLAUDE.md](../CLAUDE.md) e
  [decisoes/FLUXO-GITHUB.md](decisoes/FLUXO-GITHUB.md).

---

## Onde o desenvolvimento parou

**Aberto no GitHub** — verificado em 31/08/2026 com `gh`:

| | O quê | Estado |
|---|---|---|
| Issue [#38](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/38) | O typecheck não cobre a pasta `e2e` | aberta |
| PR [#39](https://github.com/Quintanilha09/Zelo-Care-Foundation/pull/39) | O typecheck passa a cobrir a pasta `e2e` | aberto, **em conflito com o `main`**, check do CI **vermelho** (execução `33351822697`) |

É o único trabalho de código em andamento e **não está pronto para merge**: precisa de rebase e de
uma execução verde. Falta também **tornar o check obrigatório e proteger o `main`**, depois de uma
execução verde e revisada — o PR #1, que registrava isso, foi fechado sem merge em 26/08/2026.

**O trabalho nomeado é a fase 11 — correção pós-auditoria**
([phases/11-correcao-pos-auditoria/](phases/11-correcao-pos-auditoria/), plano em
[auditorias/2026-08-23-gsd-secao-10.md](auditorias/2026-08-23-gsd-secao-10.md)). O item mais grave:
**o cadastro por e-mail e senha não funciona em produção** — nenhum e-mail é enviado e o login exige
e-mail verificado. Só o Google entra. Fora isso, o disponível é manutenção, correção, segurança e
qualidade. **Não force uma história bloqueada só para ter o que fazer:**

| História | Por que está parada |
|---|---|
| **QUI-12** (assinatura, era ZELO-39) | PSP não escolhido. A pesquisa está feita — Mercado Pago é a recomendação, ver [decisoes/CUSTOS-APIS.md](decisoes/CUSTOS-APIS.md) — mas falta confirmar se o Pix Automático cobra sozinho, e falta conta e KYC do fundador |
| **QUI-13** (app nativo, era ZELO-42) | **Bloqueada pelos próprios critérios de aceite**: exige gatilho medido — entrega iOS <95%, ou instalação PWA provada como barreira, ou loja virar requisito. Com zero usuário em produção, nenhum pode ter sido atingido |
| ZELO-31, ZELO-41 (SMS e ligação) | Fora do v1 desde 24/08/2026 — viraram trabalho do comprador. Não migradas para o Linear |
| ZELO-43 a ZELO-55 (trilha institucional) | Não migradas. Os dois portões são pré-condição de negócio, não código; as 11 de implementação estão atrás deles. Desenho preservado em [referencia/EXTENSAO-B2B.md](referencia/EXTENSAO-B2B.md) |

---

## Pendências acumuladas de deploy

Checar tudo de uma vez no Replit:

1. `git pull`
2. `pnpm install` na raiz
3. `pnpm --filter @workspace/db run push` — schema acumulado de ZELO-26 em diante. Da leva de
   Momentos: `media_assets` e `kept_at` (QUI-5/QUI-11), a tabela `media_reactions` e os valores
   `moment` em `notification_category` e `moment_new` em `notification_type` (QUI-10)
4. `pnpm --filter @workspace/db run push:raw` — trigger de imutabilidade (idempotente)
5. **`ADMIN_PANEL_SECRET` — o fundador informou em 25/08/2026 que já está configurado** no Replit.
   `NÃO VERIFICADO`: falta abrir `/admin` e confirmar que a senha entra — estava **confirmado
   ausente em 23/08/2026** na lista real de Secrets. Se recusar: ou o workflow não foi reiniciado
   depois de criar o Secret (só é lido quando o processo sobe), ou o valor é **igual ao
   `SESSION_SECRET`** e o painel se desabilita sozinho, escrevendo `[SEGURANCA] ...` no log. Com ele
   aberto, REQ-027 (taxa de entrega) passa a ter como ser medida. Faltam também `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT`
6. **Google OAuth:** adicionar `https://zelo-care-foundation.replit.app/api/auth/google/callback`
   como redirect URI autorizado
7. Reiniciar o workflow "API Server" — não só o Preview

---

## Roteiro de teste pendente do fundador

Nada disto foi aberto num navegador real ainda — só typecheck e teste automatizado:

- ZELO-30 / ZELO-32 — perfil de escalonamento e silêncio noturno; painel `/admin` (senha =
  `ADMIN_PANEL_SECRET`) e página `/status`
- ZELO-34 / ZELO-35 — tela de estoque com alerta "já comprou?"; botão "Gerar relatório em PDF"
- ZELO-36 / ZELO-37 — consultas com lembretes escalonados; rotina/aferições e gráfico descritivo
- ZELO-38 — paywall ao convidar o 2º cuidador, estado do plano em Ajustes
- ZELO-40 / ZELO-58 — modo idoso e o fluxo de link para o aparelho do paciente
- ZELO-56 / ZELO-57 — planos com três tiers; painel do dia com 2+ pacientes

`NÃO VERIFICADO`: a compressão no aparelho (5 MB → menos de 500 KB) é critério de aceite da QUI-7 e
**só pode ser medida num navegador de verdade** — o componente escreve os dois números no console a
cada foto escolhida, e falta o fundador abrir o console no Replit e ler.

---

## Gaps conhecidos, registrados de propósito

| Gap | Onde está documentado |
|---|---|
| **Papel é por família, não por paciente.** A spec pede "cuidador do pai, observador da mãe, mesma conta". Exigiria tabela de junção e mudar o modelo de autorização do JWT | Cabeçalho de `artifacts/api-server/src/lib/capabilities.ts` |
| **Refresh token em `localStorage`.** `RISCO POTENCIAL` aceito; a alternativa é cookie `httpOnly`, que muda o fluxo de autenticação inteiro. **Avaliar antes de haver usuário real** | [decisoes/PLATFORM_DECISIONS.md](decisoes/PLATFORM_DECISIONS.md) §9 |
| **Artefatos de fase param na 04** enquanto o projeto está na 10. Nenhum `NN-VERIFICATION.md` foi criado, apesar de o `config.json` exigir. A fase 11 nasce já sob o padrão | [phases/](phases/) e [config.json](config.json) |
| **REQ-F03 — não existe tipografia base.** O `body` não define `font-size` e herda 16px do navegador; os tamanhos são 72 classes à mão em 18 arquivos, a mais comum sendo `text-[15px]`, num app para idosos | [auditorias/2026-08-23-gsd-secao-10.md](auditorias/2026-08-23-gsd-secao-10.md) |
| **Os 33 testes do motor de recorrência não rodam no CI.** Existem, passam, e nunca são exercidos — o workflow nunca chama `test:libs` | idem |
| **Frontend sem teste unitário.** O Playwright é a única cobertura de tela, e os defeitos mais caros da última leva foram todos de frontend | idem |
| **`admin.test.ts` depende de variável de ambiente externa** — falha sozinho sem `ADMIN_PANEL_SECRET`. Apontado pelo Codex; merece mudança separada e testada | `artifacts/api-server/src/tests/admin.test.ts` |

---

## Decisões pendentes do fundador

1. **Preço** dos planos Família e Profissional — os limites já estão em vigor, falta o valor
2. **Provedor de e-mail: decidido — Resend** (23/08/2026). Falta criar a conta, verificar o domínio
   e provisionar `RESEND_API_KEY`. **Bloqueado pela decisão de domínio, abaixo.**
3. **PSP de pagamento** (QUI-12, era ZELO-39) — único fornecedor externo ainda em aberto, adiado de
   propósito para o fim do projeto: **não perguntar história a história.** SMS e ligação saíram do
   v1 em 24/08/2026 ([decisoes/PLATFORM_DECISIONS.md](decisoes/PLATFORM_DECISIONS.md) §12)
4. Persona de entrada (recomendação: cuidador de idoso)
5. **Nome definitivo (INPI e domínio)** — deixou de ser só identidade: **todo provedor de e-mail
   exige domínio verificado por DNS**, então bloqueia o conserto do cadastro (fase 11.1b)
6. Encarregado de dados (DPO)
7. O repositório GitHub está **público** — decidir se troca para privado
8. Aumentar o limite de gasto do Replit para destravar o banco de produção
