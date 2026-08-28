# STATE — onde o ZELO está

> **Isto é *estado*, não diário.** O que aconteceu está em
> [historico/DIARIO-ate-2026-08-23.md](historico/DIARIO-ate-2026-08-23.md); o que cada história
> entregou, em [HISTORIAS.md](HISTORIAS.md); os números verificados, em
> [../CONTEXT.md](../CONTEXT.md).
>
> **Regra:** atualizar ao finalizar qualquer implementação, antes de encerrar a sessão.
> Se este arquivo voltar a passar de ~150 linhas, mova o excedente para `historico/` — foi
> justamente por virar diário de 609 linhas que ele parou de ser lido.
>
> Última revisão: 27/08/2026.

---

## O que mudou no processo em 25–26/08/2026 — leia antes de tocar em código

**Nenhuma mudança de código entra no `main` sem Issue e PR.** Regra do fundador,
e vale para qualquer agente de qualquer modelo. O ciclo inteiro está em
[decisoes/FLUXO-GITHUB.md](decisoes/FLUXO-GITHUB.md); o resumo está no
`CLAUDE.md`, que é carregado sozinho.

Ferramentas que passaram a existir:

| | O quê | Estado |
|---|---|---|
| `gh` (GitHub CLI) | abre Issue e PR pela linha de comando | instalado e autenticado |
| **Biome** | revisor de código | **portão de CI** — falha o build |
| **Knip** | detector de código morto | **relatório** — não falha o build |
| `design-motion-principles` | skill de movimento | instalada em `.agents/skills/`, fora do git |
| **Playwright** | teste de ponta a ponta na interface | **portão de CI** — 42 testes, Desktop Chrome e Pixel 7 |

**O passo de Build do CI nunca tinha passado** antes de 26/08/2026 — faltavam
`PORT` e `BASE_PATH` no ambiente do workflow, e a falha não tinha relação com
o código em revisão. Corrigido na Issue #8.

---

## Posição

**47 histórias entregues:** 38 das 42 do backlog original, mais ZELO-56, ZELO-57 e ZELO-58,
criadas depois a partir de refinamento, mais **QUI-5** (fundação de mídia), **QUI-6**
(consentimento de imagem), **QUI-7** (Momentos do paciente), **QUI-8** (recado em áudio) e
**QUI-11** (retenção de 90 dias), as cinco em 25/08/2026, e **QUI-10** (aviso de momento novo e
o coração) em 27/08/2026 — que **fecha o projeto ZELO — Momentos**.

| Fase | Situação |
|---|---|
| 01–03 — Fundação, Identidade, Paciente/Cuidadores | ✅ 15/15 |
| 04 — Tratamento e Agenda | ✅ 6/6 |
| 05 — Tela Inicial e Registro de Dose | ✅ 4/4 |
| 06 — Notificação e Escalonamento ⭐ | 🔵 6/7 — ZELO-31 pulada de propósito |
| 07 — Histórico, Estoque e Relatório | ✅ 3/3 |
| 08 — Consultas e Rotina | ✅ 2/2 |
| 09 — Monetização | 🔵 1/2 — ZELO-39 pulada de propósito |
| 10 — Alcance ao Paciente e App Nativo | 🔵 1/4 |
| — Fora de fase | ✅ ZELO-56, ZELO-57 (planos), ZELO-58 (acesso do paciente) |

---

## O backlog codificável voltou a se esgotar — 27/08/2026

Ficou esgotado entre 19 e 24/08/2026; **deixou de estar** quando o refinamento de Momentos
([refinamentos/momentos-fotos-e-videos.md](refinamentos/momentos-fotos-e-videos.md)) produziu
7 histórias novas, hoje no Linear como QUI-5 a QUI-11. Em 27/08/2026 **esgotou de novo**: as seis
que seriam feitas foram feitas, e a sétima foi cancelada.

**O recurso de Momentos está completo, ponta a ponta:** o cuidador publica foto com legenda, o
paciente grava recado do aparelho dele, a família vê no mural com autor e horário no fuso do
paciente, recebe aviso quando há coisa nova, responde com um coração, guarda o que quer manter, e
o resto some sozinho em 90 dias.

**A QUI-9 (vídeo) foi CANCELADA no Linear em 27/08/2026**, depois de ter sido adiada em 25/08.
O motivo da primeira decisão: é o único recurso cujo custo dispara com mudança de comportamento do
usuário — um vídeo pesa 16× uma foto, e o fundador declarou não haver orçamento. O motivo do
cancelamento é outro: com o vídeo deliberadamente deixado para depois da venda, o projeto ficaria
em 86% para sempre, e **quadro que mostra trabalho pendente que ninguém pretende fazer vira ruído**.
A fundação já aceita vídeo (teto de 8 MB, MIME na allowlist); falta só a tela e a compressão no
aparelho, se o comprador quiser. Ver [decisoes/CUSTOS-APIS.md](decisoes/CUSTOS-APIS.md).

**Com a QUI-10 entregue em 27/08/2026, o projeto ZELO — Momentos fecha:** tudo que foi decidido
foi feito.

### Trabalho no GitHub — atualizado em 27/08/2026

Todas as Issues da leva de padrões estão fechadas:

| Issue | O quê | Estado |
|---|---|---|
| [#5](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/5) | Movimento na interface | ✅ PR #12 e PR #23 |
| [#7](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/7) | Playwright no CI | ✅ PR #18 |
| [#10](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/10) | Código morto (Knip) | ✅ 11 dependências mortas → 0 |
| [#13](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/13) | Feed de atividade órfão | ✅ PR #22 |
| [#15](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/15) | Painel indisponível ≠ senha errada | ✅ PR #16 |
| [#17](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/17) | Botões sobrepostos no celular | ✅ PR #19 — achado pelo Playwright, não por gente |
| [#24](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/24) | Aviso de momento novo e coração (QUI-10) | ✅ PR #25 |

**Não há Issue aberta no GitHub** — verificado em 27/08/2026 com `gh issue list`.

Uma delas foi fechada **por decisão, não por entrega**, e vale saber qual:

| Issue | O quê | Por que foi fechada sem código |
|---|---|---|
| [#6](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/6) | Sentry com filtro de dado sensível | Ele não monitoraria nada: zero usuários, e a estratégia é ficar em dev até vender. O texto de fechamento guarda o plano pronto — inclusive o cuidado principal, que é o Sentry capturar contexto automático e **arrastar nome de medicamento para o servidor dele**, violando o invariante 3 |

`NÃO VERIFICADO`: a compressão no aparelho (5 MB → menos de 500 KB) é critério de aceite da QUI-7
e **só pode ser medida num navegador de verdade**. O componente escreve os dois números no console
a cada foto escolhida; falta o fundador abrir o console no Replit e ler.

Das antigas, as duas que atravessaram para o Linear continuam paradas pelos mesmos motivos:

| História | Por que está parada |
|---|---|
| **QUI-12** (assinatura, era ZELO-39) | PSP não escolhido. A pesquisa está feita — Mercado Pago é a recomendação, ver [decisoes/CUSTOS-APIS.md](decisoes/CUSTOS-APIS.md) — mas falta confirmar se o Pix Automático cobra sozinho, e falta conta e KYC do fundador |
| **QUI-13** (app nativo, era ZELO-42) | **Bloqueada pelos próprios critérios de aceite**: exige gatilho medido — entrega iOS <95%, ou instalação PWA provada como barreira, ou loja virar requisito. Com zero usuário em produção, nenhum pode ter sido atingido |
| ZELO-31, ZELO-41 (SMS e ligação) | Fora do v1 desde 24/08/2026 — viraram trabalho do comprador. Não migradas para o Linear |
| ZELO-43 a ZELO-55 (trilha institucional) | Não migradas. Os dois portões são pré-condição de negócio, não código; as 11 de implementação estão atrás deles. Desenho preservado em [referencia/EXTENSAO-B2B.md](referencia/EXTENSAO-B2B.md) |

**Consequência prática:** o esgotamento durou poucas horas. Na mesma noite de 27/08/2026 o fundador
mandou capturas de tela do app publicado, e a revisão delas produziu **seis histórias novas** — o
projeto **ZELO — Interface e Conta**, QUI-14 a QUI-19. Detalhe e justificativa de cada uma em
[BACKLOG.md](BACKLOG.md).

**A próxima é a QUI-14**, e é de dez linhas: a dose já registrada mostra `às  por`, sem hora e sem
nome, porque `dose-card.tsx:51` escreve `às {takenAt} por {takenBy}` e `PatientDetailPage.tsx:393`
não passa nenhum dos dois. Está quebrada exatamente no que o produto vende.

As duas histórias do Linear que continuam paradas (QUI-12 e QUI-13) seguem bloqueadas por decisão
do fundador ou por gatilho que exige produção. **Não force uma história bloqueada só para ter o que
fazer.**

**E esse trabalho agora tem nome.** A auditoria §10 do GSD
([auditorias/2026-08-23-gsd-secao-10.md](auditorias/2026-08-23-gsd-secao-10.md)) produziu um plano de
correção, e a execução é a **fase 11** ([phases/11-correcao-pos-auditoria/](phases/11-correcao-pos-auditoria/)).
O item mais grave: **o cadastro por e-mail e senha não funciona em produção** — nenhum e-mail é
enviado e o login exige e-mail verificado. Só o Google entra.

---

## Ambiente

- **Desenvolvimento apenas.** Decisão do fundador em 21/08/2026.
- **O banco de produção está vazio e pausado por limite de gasto** (teto de US$ 1 atingido).
  O app publicado nunca esteve funcional — servia a tela de login sem banco por trás.
- Os dados que existem (auditoria, cuidadores, pacientes) estão todos em **desenvolvimento**.
- Para montar produção quando o crédito voltar: [runbooks/banco-de-producao.md](runbooks/banco-de-producao.md)
  — schema completo já gerado e testado, trigger de imutabilidade, secrets faltando, URL do OAuth.
- **Verificação visual só acontece no Replit.** O roteamento de `/api` para o backend é da
  infraestrutura dele (`router = "application"`), não reproduzido localmente.
- **A suíte de integração VOLTOU a rodar localmente** em 25/08/2026: 513 testes, 511 passando,
  2 pulados. Passo a passo em [runbooks/banco-de-teste-local.md](runbooks/banco-de-teste-local.md).
  O bloqueio anterior era só o container `zelo-test-pg` parado.

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
   `NÃO VERIFICADO`: falta abrir `/admin` e confirmar que a senha entra. Estava **confirmado ausente
   em 23/08/2026** na lista real de Secrets, então a confirmação importa. Se o painel recusar,
   as duas causas prováveis são o workflow não ter sido reiniciado depois de criar o Secret
   (Secret só é lido quando o processo sobe) ou o valor ser **igual ao `SESSION_SECRET`** — nesse
   caso o painel se desabilita sozinho e escreve `[SEGURANCA] ...` no log.
   Com o painel aberto, REQ-027 (taxa de entrega) passa a ter como ser medida.
   Demais secrets: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` se ainda não foram
6. **Google OAuth:** adicionar `https://zelo-care-foundation.replit.app/api/auth/google/callback`
   como redirect URI autorizado
7. Reiniciar o workflow "API Server" — não só o Preview

---

## Roteiro de teste pendente do fundador

Nada disto foi aberto num navegador real ainda — só typecheck e teste automatizado:

- ZELO-30 — seletor de perfil de escalonamento e silêncio noturno
- ZELO-32 — painel `/admin` (senha = `ADMIN_PANEL_SECRET`) e página `/status`
- ZELO-34 — tela de estoque e alerta "já comprou?"
- ZELO-35 — botão "Gerar relatório em PDF"
- ZELO-36 — tela de consultas com lembretes escalonados
- ZELO-37 — tela de rotina/aferições e gráfico descritivo
- ZELO-38 — paywall ao convidar o 2º cuidador, estado do plano em Ajustes
- ZELO-40 / ZELO-58 — modo idoso e o fluxo de link para o aparelho do paciente
- ZELO-56 / ZELO-57 — tela de planos com três tiers, painel do dia com 2+ pacientes

---

## Gaps conhecidos, registrados de propósito

| Gap | Onde está documentado |
|---|---|
| **Papel é por família, não por paciente.** A spec pede "cuidador do pai, observador da mãe, mesma conta". Exigiria tabela de junção e mudar o modelo de autorização do JWT | Cabeçalho de `artifacts/api-server/src/lib/capabilities.ts` |
| **Refresh token em `localStorage`.** `RISCO POTENCIAL` aceito; a alternativa é cookie `httpOnly`, que muda o fluxo de autenticação inteiro. **Avaliar antes de haver usuário real** | [decisoes/PLATFORM_DECISIONS.md](decisoes/PLATFORM_DECISIONS.md) §9 |
| **Artefatos de fase param na 04** enquanto o projeto está na 10. Nenhum `NN-VERIFICATION.md` foi criado, apesar de o `config.json` exigir. A fase 11 nasce já sob o padrão | [phases/](phases/) e [config.json](config.json) |
| **REQ-F03 — não existe tipografia base.** O `body` não define `font-size` e herda 16px do navegador; os tamanhos são 72 classes à mão em 18 arquivos, a mais comum sendo `text-[15px]`, num app para idosos | [auditorias/2026-08-23-gsd-secao-10.md](auditorias/2026-08-23-gsd-secao-10.md) |
| **Os 33 testes do motor de recorrência não rodam no CI.** Existem, passam, e nunca são exercidos — o workflow nunca chama `test:libs` | idem |
| **Frontend sem nenhum teste.** Os quatro bugs que mais custaram nesta história foram todos de frontend | idem |
| **`admin.test.ts` depende de variável de ambiente externa** — falha sozinho sem `ADMIN_PANEL_SECRET`. Apontado pelo Codex; merece mudança separada e testada | `artifacts/api-server/src/tests/admin.test.ts` |

---

## Decisões pendentes do fundador

1. **Preço** dos planos Família e Profissional — os limites já estão em vigor, falta o valor
2. **Provedor de e-mail: decidido — Resend** (23/08/2026, a pedido do fundador). Falta criar a conta,
   verificar o domínio e provisionar `RESEND_API_KEY`. **Bloqueado pela decisão de domínio abaixo.**
3. **PSP de pagamento** (ZELO-39) — único fornecedor externo ainda em aberto. **SMS e ligação
   automática saíram do escopo do v1** em 24/08/2026 e viraram trabalho do comprador
   (ver [decisoes/PLATFORM_DECISIONS.md](decisoes/PLATFORM_DECISIONS.md) §12). Contexto original:
   (ZELO-39). Decisão adiada de propósito para o fim do projeto — **não perguntar história a história**
4. Persona de entrada (recomendação: cuidador de idoso)
5. **Nome definitivo (INPI e domínio)** — deixou de ser só identidade: **todo provedor de e-mail exige
   domínio verificado por DNS**, então esta decisão bloqueia o conserto do cadastro (fase 11.1b)
6. Encarregado de dados (DPO)
7. O repositório GitHub está **público** — decidir se troca para privado
8. Aumentar o limite de gasto do Replit para destravar o banco de produção

---

## Em aberto no código

- **PR #1 (`chore/github-actions-ci`)** — adiciona `.github/workflows/validate.yml`. Está em
  rascunho e **atrasada em relação ao `main`**: reverte o guardrail de consistência da suíte em
  `environment-hardening.test.ts` e traz a versão antiga de `.agents/memory/zelo-foundation-state.md`,
  arquivo que foi removido na consolidação de 23/08. **Precisa de rebase antes de qualquer merge** —
  aceitar como está reintroduz o problema que quebrou a suíte.
- Só tornar o check obrigatório e proteger o `main` depois de uma execução verde e revisada.
