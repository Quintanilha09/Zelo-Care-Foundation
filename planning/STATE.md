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
> Última revisão: 23/08/2026.

---

## Posição

**41 histórias entregues:** 38 das 42 do backlog original, mais ZELO-56, ZELO-57 e ZELO-58,
criadas depois a partir de refinamento.

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

## O backlog codificável está esgotado

Verificado história a história em 19/08/2026 e ainda válido. **Nenhuma das restantes tem código
para escrever agora** — e nenhuma depende de mim:

| História | Por que está parada |
|---|---|
| ZELO-31, ZELO-41 | Provedor de SMS e de ligação automática não escolhidos |
| ZELO-39 | PSP de pagamento não escolhido (conta, KYC e chaves são do fundador) |
| ZELO-42 (app nativo) | **Bloqueada pelos próprios critérios de aceite**: exige gatilho medido — entrega iOS <95%, ou instalação PWA provada como barreira, ou loja virar requisito. Com zero usuário em produção, nenhum pode ter sido atingido |
| ZELO-43 | Portão comercial — 5 conversas com ILPI, um turno presencial, carta de intenção. Trabalho de campo, marcada `sem-código` |
| ZELO-44 | Portão jurídico — advogado de LGPD em saúde. `sem-código`, e depende da ZELO-43 fechar |
| ZELO-45+ | Não existem ainda. O texto da ZELO-43 é explícito: nenhuma história nova até ela fechar |

**Consequência prática:** o trabalho disponível hoje é manutenção, correção, segurança e
qualidade — não história nova. Não force uma história bloqueada só para ter o que fazer.

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

---

## Pendências acumuladas de deploy

Checar tudo de uma vez no Replit:

1. `git pull`
2. `pnpm install` na raiz
3. `pnpm --filter @workspace/db run push` — schema acumulado de ZELO-26 em diante
4. `pnpm --filter @workspace/db run push:raw` — trigger de imutabilidade (idempotente)
5. Secrets faltando: **`ADMIN_PANEL_SECRET`** (valor próprio, forte, gerado lá — não o do
   `.env.local`), e `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` se ainda não foram
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
3. **Fornecedores, em lote:** SMS (ZELO-31), ligação automática (Épico 9), PSP de pagamento
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
