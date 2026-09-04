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

---

## Ambiente

- **Desenvolvimento apenas** (decisão do fundador, 21/08/2026) — todo dado que existe é de dev.
  **O banco de produção está vazio e pausado por limite de gasto** (teto de US$ 1 atingido), e o
  app publicado nunca esteve funcional: servia a tela de login sem banco por trás.
- Para montar produção quando o crédito voltar: [runbooks/banco-de-producao.md](runbooks/banco-de-producao.md)
  — schema completo já gerado e testado, trigger de imutabilidade, secrets faltando, URL do OAuth.
- **Verificação visual só acontece no Replit.** O roteamento de `/api` para o backend é da
  infraestrutura dele (`router = "application"`), não reproduzido localmente.
- **A suíte de integração não roda nesta máquina — e a causa mudou em 04/09/2026.** O diagnóstico
  antigo culpava o Smart App Control por bloquear `argon2` e `biome`; medido de novo, **os dois
  funcionam**. O que falta é só o banco: o cluster da porta 5433 não sobe (`postgres.exe` recebe
  `Permission denied` no bind), e o serviço que roda na 5432 não tem o papel `zelo_dev`. Detalhe e
  as três saídas em [../CONTEXT.md](../CONTEXT.md) — a mais barata é abrir o Docker, que já está
  instalado. **Enquanto isso o CI em Linux é a única verificação real** da integração e do
  Playwright, e todo número novo sai do log dele. Typecheck, lint, build e os testes de `lib/`
  rodam aqui e devem ser rodados antes de todo push.
- **Portões de CI** (`.github/workflows/validate.yml`, no `main` desde 26/08/2026): typecheck, lint
  de relógio, suíte do servidor, build, **Biome** e **Playwright**; o **Knip** é relatório e não
  falha o build. **Nada de código entra no `main` sem Issue e PR** — [CLAUDE.md](../CLAUDE.md) e
  [decisoes/FLUXO-GITHUB.md](decisoes/FLUXO-GITHUB.md).

---

## Onde o desenvolvimento parou

**Cinco Issues abertas, nenhum PR** — medido em 03/09/2026 com `gh`. Este bloco envelhece rápido:
se a sessão for depois disso, meça de novo.

| Issue | O quê |
|---|---|
| [#53](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/53) | foto some ao publicar no celular — espera duas respostas do fundador |
| [#46](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/46) | trocar o e-mail da conta — **destravada** desde 02/09, é trabalho disponível |
| [#76](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/76) | Termos, Privacidade e política de dados de saúde **não abrem** — os três links do cadastro estão mortos. Espera **texto do fundador**, não código |
| [#78](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/78) | não dá para saber em que conta se está: duas contas da mesma pessoa ficam idênticas na tela |
| [#79](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/79) | código ao entrar de aparelho novo — **planejada**, espera duas decisões do fundador: opcional ou obrigatório, e se 90 dias de aparelho confiável serve |

**Fechadas em 02–03/09/2026:** #73 (provedor de e-mail), #77 (código de 6 dígitos),
#81 (mensagens do cadastro), #75 (reenvio) e #84 (piso de tempo).

**O teste no aparelho mudou o rumo.** Em 31/08/2026 o fundador abriu o app no celular pela
primeira vez, e o veredito sobre Momentos foi *"nada do que foi planejado funcionou"* — com razão.
Disso saíram as Issues #63, #64 e #65. **Nove PRs entraram entre 31/08 e 01/09**, de `b81c165` a
`a2ee9b0`: galeria de verdade, deslizar para trocar de foto, várias fotos por vez, estoque de
tratamento encerrado, nome e senha da própria conta, e a exportação LGPD completa em JSON e PDF.

O relato inteiro — o que falhou, por que falhou e as cinco reprovações de CI que **nenhuma era do
produto** — está em
[historico/DIARIO-2026-09-01-teste-no-aparelho.md](historico/DIARIO-2026-09-01-teste-no-aparelho.md).
Vale ler antes de mexer em Momentos ou em teste de tela.

## O que sobrou aberto

| Issue | Estado |
|---|---|
| [#53](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/53) foto some ao publicar no celular | **A mais grave: é a única que faz PERDER TRABALHO.** Espera duas respostas do fundador — o app foi aberto pelo ícone da tela de início ou por aba? E sair da ficha e voltar SEM escolher foto também volta para a inicial? Quatro hipóteses já eliminadas por leitura de código; sobrou o `start_url: "/"` do manifesto |
| [#46](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/46) trocar o e-mail da conta | ▶️ **Destravada em 02/09/2026** pela Issue #73 (fase 11.1b): `zelocuida.com.br` verificado no Resend e o servidor manda e-mail de verdade. É trabalho disponível |


**Uma decisão do fundador ficou registrada dentro do código** (`lib/nome-de-paciente.ts`): o pedido
era limitar o nome a **exatamente** duas palavras; está implementado como **pelo menos duas**. O
paciente de teste dele chama-se "Jailson Mendes Delicia" — três palavras — e a regra estrita
recusava "Ana P Silva" e três nomes da própria suíte. O ponto de mudança é uma linha no
`superRefine`, se a decisão for outra.

As doze (**#45 a #56**) são a leva que saiu do **primeiro teste feito no aparelho**, com o app
publicado e o deploy do Replit aplicado. Refinamento, plano em quatro ondas e as discordâncias
registradas: [refinamentos/interface-apos-teste-real.md](refinamentos/interface-apos-teste-real.md).

**Comece pela onda 1**, que é onde está o custo real:

| Issue | Por que primeiro |
|---|---|
| [#53](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/53) | Publicar foto no celular recarrega o app e **perde a imagem** — o único item da leva que destrói trabalho. **Reproduzir antes de editar** |
| [#48](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/48) | A exportação diz cumprir a LGPD e **não inclui conta, cuidadores, consentimentos nem momentos**. Risco jurídico, não acabamento |

Duas entraram nesta tarde, e as duas nasceram de defeito na **rede de proteção**, não no produto:

| Issue · PR | O quê | Entrou |
|---|---|---|
| [#38](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/38) · [#39](https://github.com/Quintanilha09/Zelo-Care-Foundation/pull/39) | O `typecheck` passa a cobrir a pasta `e2e` — ela não estava em tsconfig nenhum | 16h18, commit `d95c7ee` |
| [#43](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/43) · [#44](https://github.com/Quintanilha09/Zelo-Care-Foundation/pull/44) | Três testes e2e reprovavam no último minuto do dia em São Paulo | 16h23, commit `2024369` |

Falta **tornar o check obrigatório e proteger o `main`**, depois de uma execução verde e revisada —
o PR #1, que registrava isso, foi fechado sem merge em 26/08/2026.

> **Há sessões em paralelo.** `git worktree list` mostra três worktrees ativos além desta cópia.
> Vale a regra do [CLAUDE.md](../CLAUDE.md): **uma sessão por vez no `main`** — havendo outra ativa,
> trabalhe em branch. Confira antes de commitar, não depois de o push ser recusado.

**O trabalho nomeado é a fase 11 — correção pós-auditoria**
([phases/11-correcao-pos-auditoria/](phases/11-correcao-pos-auditoria/), plano em
[auditorias/2026-08-23-gsd-secao-10.md](auditorias/2026-08-23-gsd-secao-10.md)).

**O item mais grave dela foi resolvido em 02/09/2026** (Issue #73, fase 11.1b): o cadastro por
e-mail e senha voltou a funcionar, com envio real pelo Resend, verificado em ambiente real. Até
então nenhum e-mail saía, o login exigia e-mail verificado, e só o Google entrava.

**Onde a fase 11 está** — medido em 31/08/2026 contra o código, não copiado da auditoria:

| | Estado |
|---|---|
| 11.1a destravar o cadastro · 11.2 rede de proteção · 11.3 tipografia | ✅ 23/08/2026 |
| 11.1b integrar provedor de e-mail | ✅ 02/09/2026, Issue #73. **Verificado em ambiente real:** o fundador se cadastrou, o e-mail chegou e a conta foi confirmada. Junto vieram as telas `/verificar-email` e `/redefinir-senha`, que **não existiam**. Em 03/09 a confirmação virou **código de 6 dígitos** (#77), com reenvio e teto de emissão (#75) e piso de tempo contra vazamento por cronômetro (#84) |
| **11.5 testes de contrato do frontend** | ▶️ **destravada** — era "a UI não abre aqui", e o Playwright roda no CI desde 26/08 |
| 11.4 fechar a auditoria | depende da 11.5 |
| 11.6 papel por paciente | ⏸️ `ADIÁVEL` de propósito, sem caso de uso real |

Há ainda a **fase 12** ([phases/12-feedback-de-uso/](phases/12-feedback-de-uso/)), nascida de uso
real e não de auditoria: 10 itens abertos, o mais grave sendo o `12-01` — **Consultas e Tratamento
não mostram o paywall**, então o app *parece quebrado* em vez de convidar a assinar.

**Não force uma história bloqueada só para ter o que fazer:**

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

> **Esta tabela foi remedida linha a linha em 31/08/2026, contra o código.** Três entradas eram
> falsas e uma estava pela metade: tinham sido corrigidas pelas fases 11.2 e 11.3, em 23/08, e
> ninguém voltou aqui para apagá-las. O que sobrou abaixo foi verificado nesta data, e cada linha
> diz onde a verificação pode ser refeita. **Gap que já não existe é pior que gap não registrado:**
> este arquivo mandou trabalho já feito para o topo da fila.

| Gap | Como confirmei em 31/08/2026 |
|---|---|
| **Papel é por família, não por paciente.** A spec pede "cuidador do pai, observador da mãe, mesma conta". Exigiria tabela de junção caregiver×patient e mudar o modelo de autorização do JWT, que hoje carrega um `role` único por sessão | O cabeçalho de `artifacts/api-server/src/lib/capabilities.ts` descreve o gap e ele continua lá. É a fase **11.6**, `ADIÁVEL` de propósito — não fazer sem caso de uso real |
| **Refresh token em `localStorage`.** `RISCO POTENCIAL` aceito; a alternativa é cookie `httpOnly`, que muda o fluxo de autenticação inteiro. **Avaliar antes de haver usuário real** | `artifacts/zelo/src/lib/auth-client.ts:30` — `localStorage.setItem(REFRESH_TOKEN_KEY, …)`. O access token já fica só em memória, e o próprio arquivo explica a divisão |
| **Nenhum `NN-VERIFICATION.md` existe**, apesar de o `config.json` exigir. E o `NN-PLAN.md` só existe na fase 01 (cinco arquivos) | `find planning/phases -name "*VERIFICATION*"` não devolve nada. **A parte antiga desta linha era falsa:** os artefatos não param mais na 04 — as fases 11 e 12 têm `CONTEXT.md` |
| **Frontend sem teste unitário.** O Playwright é a única cobertura de tela, e os defeitos mais caros da última leva foram todos de frontend | Não há nenhum `.test.ts`/`.test.tsx` em `artifacts/zelo/src`. É a fase **11.5**, que deixou de estar bloqueada quando o Playwright passou a rodar no CI |

**Três saíram daqui, resolvidas em 23/08/2026 pelas fases 11.2 e 11.3** e verificadas de novo hoje:
os 33 testes do motor de recorrência **rodam** (`validate.yml:107` chama `test:libs`; a execução
`33409635698` registra 33/33), a **tipografia base existe** (`artifacts/zelo/src/index.css:157`,
`font-size: 18px` no `body`), e o **`admin.test.ts` é autossuficiente** (linhas 54–55 geram segredo
efêmero com `crypto.randomBytes`). O registro de cada uma está na auditoria.

---

## Testar e-mail exige modo produção — o workflow do Replit não serve

Descoberto em 02/09/2026, testando a Issue #73.

O workflow `artifacts/api-server: API Server` roda `pnpm run dev`, e esse script
começa com `export NODE_ENV=development`. Nesse modo o cadastro **auto-verifica a
conta e nunca chama o envio de e-mail** — então nenhum teste de e-mail feito por
ele prova coisa alguma.

Para exercitar e-mail de verdade, pare o workflow e rode à mão no Shell:

```bash
cd artifacts/api-server && NODE_ENV=production PORT=8080 APP_URL=<url de preview> pnpm run start
```

A URL de preview é a do navegador (`...spock.replit.dev`), não
`zelo-care-foundation.replit.app` — **essa não existe**: o app não está publicado,
por decisão registrada em
[decisoes/ESTRATEGIA-ATE-A-VENDA.md](decisoes/ESTRATEGIA-ATE-A-VENDA.md).

## Decisões pendentes do fundador

1. **Preço** dos planos Família e Profissional — os limites já estão em vigor, falta o valor
2. ~~**Provedor de e-mail**~~ — **resolvido em 02/09/2026.** Resend, domínio `zelocuida.com.br`
   verificado, `RESEND_API_KEY` (escopo `sending_access`, presa ao domínio) nos Secrets do Replit
3. **PSP de pagamento** (QUI-12, era ZELO-39) — único fornecedor externo ainda em aberto, adiado de
   propósito para o fim do projeto: **não perguntar história a história.** SMS e ligação saíram do
   v1 em 24/08/2026 ([decisoes/PLATFORM_DECISIONS.md](decisoes/PLATFORM_DECISIONS.md) §12)
4. Persona de entrada (recomendação: cuidador de idoso)
5. **Registro da marca no INPI** — o domínio saiu da frente (`zelocuida.com.br`, registrado em
   01/09/2026) e deixou de bloquear código. A **marca**, porém, não foi pesquisada nem depositada:
   continua risco de identidade, agora sem prazo forçado por dependência técnica
6. Encarregado de dados (DPO)
7. O repositório GitHub está **público** — decidir se troca para privado
8. Aumentar o limite de gasto do Replit para destravar o banco de produção
