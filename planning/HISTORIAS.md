# HISTÓRIAS — o que cada uma entregou

> Registro durável, extraído do `STATE.md` em 23/08/2026 quando o contexto foi consolidado no repositório.
> Aqui fica **o que foi construído** e com qual commit. O estado atual do projeto está em [STATE.md](STATE.md);
> o diário cronológico de incidentes está em [historico/DIARIO-ate-2026-08-23.md](historico/DIARIO-ate-2026-08-23.md).

---

## ✅ Fases 01-03 — CONCLUÍDAS (15 histórias, backend)

## ✅ Fase 04 — Tratamento e Agenda — CONCLUÍDA (6/6 backend + UI de paciente/tratamento/cuidadores/doses-hoje/histórico/foto)

| Item | Status | Commit |
|---|---|---|
| ZELO-17 — Motor de recorrência | ✅ backend | `ab26c3e` |
| ZELO-16 — Rota de tratamento + preview | ✅ backend | `4a2e48e` |
| **UI de paciente e tratamento** | ✅ | `8ce3fc9` |
| **UI de cuidadores e convites** | ✅ | `a1e2a8d` |
| ZELO-18 — Geração de doses + pg-boss + UI "Hoje" | ✅ completa | `95447c9`, `f89c549` |
| ZELO-19 — Fuso/DST explícito | ✅ completa | `579aad5` |
| ZELO-20 — Contínuo vs. temporário | ✅ completa | `70bb733` |
| ZELO-21 — Foto via Claude Vision | ✅ completa (confirmada no Replit) | `17e1d2c`, `56852be` |

**UI entregue nesta sessão:**
- `PatientsPage` — lista + cadastro de paciente, **consentimento de saúde por paciente inline** (titular vs. representante legal), matching o que corrigi no backend na Fase 03
- `PatientDetailPage` — lista de tratamentos do paciente
- `TreatmentForm` — os 5 padrões de posologia com campos condicionais, botão "ver próximas doses" (chama o preview antes de salvar), dose como texto livre sem validação de quantidade
- Rota raiz (`/`) agora vai para lista de pacientes, não mais para a referência de design (que continua em `/design`)
- Ajuste de backend: `GET /patients/:id/treatments` agora faz join com `medications` para devolver o nome — antes só devolvia o id
- `/consentimento` (fluxo antigo, por conta) ficou sem uso — substituído pelo consentimento por paciente

**UI de cuidadores e convites entregue** (commit `a1e2a8d`): `CaregiversPage` — lista com CaregiverCard/Badge (já existiam prontos), troca de papel inline e revogação (só visível para cuidador principal), convite com link copiável + atalho WhatsApp com texto da spec, lista de convites pendentes com revogação. Nav "Cuidadores" no cabeçalho.

**ZELO-18 entregue por completo, em duas partes:**

Parte 1 (`95447c9`): `dose-generation.ts` usa o motor puro (`@workspace/scheduling`) para gerar 14 dias de doses ao criar um tratamento; editar a posologia preserva doses já registradas (histórico) e regenera só as futuras pendentes; pausar/encerrar cancela as futuras pendentes. Idempotência garantida pela constraint `UNIQUE(treatment_id, scheduled_at)` já existente desde a Fase 01. UI "Hoje" em `PatientDetailPage` (seção com as doses do dia via `GET /patients/:id/today-doses`, botões "✓ Tomou" / "Pular" via `POST /patients/:id/dose-records`).

Parte 2 (`f89c549`), fechando a ressalva que ficou pendente: `lib/queue.ts` sobe um pg-boss real sobre o mesmo Postgres. Fila `dose-scheduled` (policy "exclusive" + singletonKey por dose — reenviar é no-op se já houver job) e `extend-dose-window` (cron diário, 03:00 UTC). A inserção da dose e o envio do evento `DoseScheduled` acontecem **na mesma transação Postgres** (via `fromDrizzle`, adapter oficial do pg-boss para drizzle) — dose e job não podem divergir. `extendActiveTreatmentWindows()` é o job diário (reusa `generateDosesForTreatment`, que já calcula a janela a partir de `Clock.now()` — chamar de novo mais tarde naturalmente cobre os dias seguintes). `reconcileDoseQueue()` roda uma vez no boot (`index.ts`) como rede de segurança contra dose pendente sem job. 3 testes novos: evento por dose criada, time-travel (adiantar 15 dias e ver a janela se estender via o job diário) e reconciliação recriando um job apagado manualmente.

**ZELO-19 entregue por completo** (commit `579aad5`): o motor de recorrência (`lib/scheduling`) já fazia a parte difícil desde ZELO-17 — os 4 cenários de DST (pula hora, repete hora, cuidador em fuso diferente, paciente muda de fuso) já tinham teste no motor puro. Faltava a parte de armazenamento e um bug real:

- `scheduled_doses` ganha `scheduled_local_date` + `scheduled_local_time` ao lado de `scheduled_at` (UTC) — a intenção do usuário ("8:00"), imune a mudança futura de regra de fuso.
- **Bug real corrigido**: `GET /patients/:id/today-doses` calculava a fronteira do dia com `new Date(`${data}T00:00:00`)` — sem offset, isso é interpretado no fuso do PROCESSO, não do paciente. Trocado por `localDayBoundsUtc` (Luxon, fuso explícito).
- Mudar o fuso do paciente (`PATCH /patients/:id`) agora regenera as doses futuras pendentes de todo tratamento ativo, preservando o horário de parede — nunca toca doses já registradas.
- **Bug latente na UI corrigido**: `PatientDetailPage` reconvertia `scheduledAt` no fuso do NAVEGADOR do cuidador (mesmo bug, lado cliente). Agora usa `scheduledLocalTime` (já resolvido pelo servidor) e mostra aviso discreto quando o fuso do cuidador diverge do paciente.

8 testes novos (2 no motor puro, 6 de integração).

**Verificação no Replit de ZELO-18/19 confirmada pelo fundador** (17/08/2026) — precisou de `pnpm install` na raiz primeiro (pg-boss era dependência nova, mesmo padrão do incidente anterior com `tsx`).

**ZELO-20 entregue por completo** (commit `70bb733`): três rotinas em `lib/treatment-lifecycle.ts`, chamadas por um novo job diário pg-boss (`treatment-lifecycle`, 03:05 UTC — 5min depois do de doses, só pra não competir à toa):

- `closeExpiredTreatments` — fecha tratamento vencido (status `finished`), cancela doses futuras, mantém histórico intacto. Continua ativo no próprio dia final, só fecha a partir do dia seguinte.
- `sendEndingSoonNotices` — avisa uma vez na véspera do último dia, texto exatamente o da spec ("...Confirme com o médico se deve continuar."), idempotente via `endingNoticeSentAt`.
- `sendContinuousReviewReminders` — lembrete a cada ~6 meses pra tratamento sem data de fim ("vale conferir a receita"), resetado quando o cuidador confirma (ack) a notificação — confirmar É a revisão.

Reativar um tratamento encerrado (`PATCH /treatments/:id` com `status: active`) regenera a janela de doses; a UI sempre pede a data de fim nova nesse momento (ou deixa em branco pra virar contínuo) — sem isso o tratamento fecharia sozinho de novo no dia seguinte, já que a data antiga continuaria vencida.

UI: `PatientDetailPage` agora traduz status (Ativo/Pausado/Concluído/Cancelado) e separa tratamentos ativos de um histórico colapsável ("Tratamentos encerrados (N)"), com o botão de reativar.

8 testes novos, incluindo uma checagem programática de que nenhuma das 3 mensagens contém linguagem de recomendação clínica (lista de frases proibidas, ex: "você pode parar", "recomendamos").

**Notificações ainda sem UI própria** — igual todo outro tipo de notificação no projeto (dose_reminder, appointment_reminder, etc. também nunca tiveram tela). Fica pra quando existir de fato uma tela de notificações/inbox (provavelmente junto da Fase 06, push/SMS) — não é lacuna específica de ZELO-20, é um padrão consistente do projeto até aqui.

**ZELO-21 implementada** (commit `17e1d2c`), pendente só de verificação real:

- `lib/vision.ts` — chamada à Claude Vision (Haiku) com tool-use forçado (schema JSON garantido). Prompt: extrair, nunca inferir — campo não legível volta `null` com confiança 0; proibido sugerir dose, completar posologia ou opinar.
- Schema `photo_extractions` separa o binário da foto (nulado de propósito ao descartar) dos campos extraídos/confiança/confirmados (sobrevivem ao descarte, só pra calibrar taxa de acerto por campo depois).
- `routes/medication-photos.ts` — extract (multipart, 8MB, JPEG/PNG/WebP) + confirm (descarta por padrão, retém só se pedido) + discard. **Este router não tem nenhum caminho que crie treatment/medication** — impossível salvar vindo de foto sem passar pelo `POST /treatments` já existente, provado por teste.
- UI: `TreatmentForm` ganha upload de foto opcional, pré-preenche só com confiança boa, campo de baixa confiança fica vazio e destacado, "remover foto / prefiro digitar" sempre visível, checkbox de reter a foto (padrão desmarcado).
- `docs/lgpd.md` (novo) — documenta um **desvio deliberado da spec**: em vez de "object storage com URL assinada" (provedor externo novo), o binário fica no mesmo Postgres do produto, descartado de verdade por padrão. Justificativa registrada no próprio arquivo.

**Testado pelo fundador no Replit** (17/08/2026): extração real com uma receita de Amoxilina — nome ("Amoxilina") e dose ("500mg comprimido") vieram certos. Confirmou que a garantia central funciona de ponta a ponta.

**Refinamento pedido pelo fundador e já implementado** (commit `56852be`): ao testar, notou que tinha que montar o padrão de posologia manualmente mesmo quando a receita já dizia "a cada 8 horas, por 7 dias". Adicionado `scheduleGuess` à extração — quando a receita ESCREVE o intervalo/frequência/duração explicitamente, isso é lido como extração (não invenção) e pré-seleciona o padrão certo (a cada X horas + intervalo, ou vezes ao dia + horários padrão razoáveis) e calcula a data de fim. Mesma disciplina de confiança dos outros campos — sem intervalo/frequência claro no texto, `scheduleGuess` fica `null` e os padrões manuais continuam intactos. Aviso visível "preenchido a partir da receita — confira antes de salvar", tudo editável, confirmação continua obrigatória.

**Confirmado no Replit** (17/08/2026): fundador testou de novo com a mesma receita de Amoxilina — o padrão de posologia (a cada 8 horas) veio pré-selecionado sozinho. ZELO-21 fechada por completo, marcada Concluído no Plane.

**UI restante da Fase 04:** nenhuma pendência.

## ✅ Fase 05 — Tela Inicial e Registro de Dose — CONCLUÍDA (4/4 backend + UI)

| Item | Status | Commit |
|---|---|---|
| ZELO-22 — Tela inicial "está tudo em dia?" | ✅ completa | `71dd1bd` |
| ZELO-23 — Registro de dose idempotente | ✅ completa | `716d553` |
| ZELO-24 — Registro retroativo | ✅ completa | `88f94a7` |
| ZELO-25 — Sincronização em tempo real (SSE) | ✅ completa | `adb284b` |

**ZELO-22 entregue por completo** (`71dd1bd`): nova `HomePage` (rota raiz `/`) substitui a antiga lista de pacientes como tela de entrada — responde "está tudo em dia?" com um banner só verde ou âmbar (nunca vermelho, o invariante do produto) e três seções (Agora / Mais tarde / Já foi), com quem registrou cada dose. `GET /patients/:id/today-doses` (dashboard.ts) ganhou nome do medicamento, quem registrou (join com dose_records + caregivers), itens com estoque baixo e a próxima consulta. Paciente selecionado agora persiste no banco (`caregivers.selected_patient_id`, `PATCH /account/selected-patient`) em vez de só no estado do navegador — resolve a dívida técnica identificada no incidente do schema órfão do Replit (ver acima), que já tinha esse campo como resíduo de uma versão anterior. Seletor de paciente, skeleton de carregamento, estado vazio e aviso de offline (`navigator.onLine`) inclusos.

**ZELO-23 entregue por completo** (`716d553`): registrar dose virou estruturalmente à prova de corrida — `UNIQUE(scheduled_dose_id)` em `dose_records` + `.onConflictDoNothing()` no insert, e a rota nunca mais devolve 409: quem perde a corrida recebe 200 com o registro de quem ganhou e uma mensagem amigável, quem ganha recebe 201. `requireCapability("register_dose")` (matriz de papéis da Fase 03) foi ligado numa rota de verdade pela primeira vez. Decremento de estoque desacoplado da rota — publica no pg-boss (`dose-taken`), um worker separado (`lib/stock.ts`) decrementa. Novo `POST /dose-records/:recordId/undo` (janela de 60s, reverte a dose pra pendente, auditado). UI: registro otimista (a tela reage antes da resposta do servidor) e botão "Desfazer" por 60s.

**ZELO-24 entregue por completo** (`88f94a7`): antes, uma dose que passou da hora e não foi registrada simplesmente sumia da tela — agora tem uma seção "Perdidas" própria. Registro retroativo aceita justificativa dentro de uma janela configurável por família (`families.retroactiveWindowHours`, padrão 24h, só o cuidador principal muda em `/ajustes`); fora da janela ou pra data futura, o servidor rejeita (`JUSTIFICATION_REQUIRED`). Editor de horário inline reaproveitado tanto em "Agora → Outro horário" quanto em "Perdidas → Registrar". **Bug real encontrado e corrigido nesta história**: a rota nova tinha sido colocada em `routes/families.ts`, que nunca é importado em `routes/index.ts` — ficaria inacessível (404) e exporia de brinde duas rotas antigas sem autenticação que já estavam nesse arquivo morto. Movida para `routes/account.ts` (já montada); o arquivo `families.ts` foi removido de vez depois, por decisão própria já fora desta história (`792d739`) — as rotas não tinham uso nem UI, e o desenho delas (familyId vindo da URL, não do JWT) contrariava o invariante de isolamento por tenant do projeto.

**ZELO-25 entregue por completo** (`adb284b`): SSE por paciente (`GET /patients/:id/events`) — EventEmitter em memória (`lib/realtime.ts`), fora do pg-boss (fila é pra job assíncrono, não pra empurrar evento numa conexão HTTP aberta). Eventos: `dose_registered`, `dose_undone`, `treatment_changed`, `caregiver_joined` (família toda), `low_stock` (só ao cruzar o limite por baixo, não a cada decremento). Heartbeat a cada 20s, reautorização a cada 5s — cuidador removido da família perde a stream na hora, mesmo sem evento de revogação; revogar/rebaixar cuidador (`caregivers.ts`) também fecha a stream dele explicitamente. Frontend não usa `EventSource` nativo (não aceita header de autenticação, e o app nunca põe token na URL) — `realtime-client.ts` usa `fetch()` + parsing manual do stream, reconecta sozinho a cada 3s. Reconectar dispara reconciliação (busca o estado atual, não confia em evento perdido durante a queda) — o polling de 60s continua rodando como rede de segurança independente do SSE. Cartões de dose ganharam `AnimatePresence`/`layout` (framer-motion) pra transição suave entre as seções, sem reordenar bruscamente.

**Total de testes de backend (fim da Fase 05):** 196/198 passando, 2 pulados por falta de `ANTHROPIC_API_KEY` local (+ 33/33 no pacote `lib/scheduling`, motor puro).

## 🔵 Fase 06 — Notificação e Escalonamento ⭐ — 6/7 (+ 1 pulada)

| Item | Status | Commit |
|---|---|---|
| ZELO-26 — Infraestrutura de Web Push | ✅ completa (push de teste real pendente de confirmação em aparelho) | `abc6fec` |
| ZELO-27 — Job de lembrete de dose idempotente | ✅ completa | `fd995a6` |
| ZELO-28 — Registro em um toque pela notificação | ✅ completa | `4a67853` |
| ZELO-29 — Rastreamento de entrega | ✅ completa | `3563477` |
| ZELO-30 — Cascata de escalonamento (T+15/30/60) | ✅ completa (UI não verificada em navegador) | `aba7ecb` |
| ZELO-31 — Fallback por SMS | ⏸️ **pulada** — sem provedor decidido (ver "SMS adiado" acima) | — |
| ZELO-32 — Painel operacional + alerta | ✅ completa (UI não verificada em navegador) | `5552ffe` |

**ZELO-26 entregue por completo** (`abc6fec`): o canal de notificação, sem nenhum lembrete automático ainda (isso é ZELO-27) — só o encanamento e um botão de teste manual, exatamente o escopo pedido.

- `lib/push.ts`: par de chaves VAPID gerado uma vez (trocar invalidaria toda assinatura já criada nos navegadores — por isso fica em `.env.local`/Secret, nunca regenerado a cada boot). `sendPushToSubscription` nunca lança: 404/410 desativa a assinatura sozinha (`active=false`), erro transitório (5xx) só incrementa `failureCount` e mantém ativa — só esses dois casos existiam antes como colunas soltas em `push_subscriptions` (resíduo da fundação, nunca usadas até agora).
- `routes/push.ts`: assinar é upsert por `(userId, endpoint)` — reassinar o mesmo dispositivo nunca duplica linha. Listagem nunca devolve as chaves de criptografia (p256dh/auth), só o necessário pro cuidador reconhecer o próprio dispositivo. `POST /push/ack`, chamado pelo service worker depois de exibir a notificação, é a única rota nova sem autenticação — o evento `push` do navegador não tem acesso ao token da página, e o endpoint (URL opaca e só conhecida por quem assinou) já cumpre o papel de credencial mínima ali.
- `notification_preferences` (tabela nova): 4 categorias por paciente (dose, consulta, estoque, tratamento), sempre ativado por padrão — só existe linha quando o cuidador desliga algo, sem precisar popular uma linha por combinação de cuidador×paciente×categoria existente.
- `public/sw.js`: service worker mínimo de propósito — só `push` e `notificationclick`, nenhum cache de asset (fora do escopo, seria superfície de bug sem necessidade). `skipWaiting`/`clients.claim` não derrubam a assinatura de push de ninguém — ela vive presa ao registro (mesma URL/escopo), não ao conteúdo do arquivo; só `unregister()` a apagaria, e o código nunca chama isso.
- `public/manifest.webmanifest` + meta tags: `display: standalone`, exigência do próprio iOS pra aceitar pedido de permissão depois de instalado.
- UI: o convite "Ativar lembretes?" só aparece depois que o cuidador cadastra o primeiro tratamento (nunca no primeiro segundo), uma vez por navegador. No iPhone sem estar instalado, redireciona pro guia dedicado (`/notificacoes/ios`) em vez de chamar a permissão nativa direto — no Safari fora do modo instalado isso não funciona e ainda queima a única chance real (negar é quase irreversível no navegador). Diagnóstico "seus lembretes estão funcionando?" em Ajustes: permissão, dispositivos cadastrados, botão de teste de verdade. Painel de preferência por paciente na própria página do paciente.

**Achado da fundação reaproveitado:** a tabela `push_subscriptions` já existia desde a fase inicial (resíduo preparado, nunca usado) com exatamente as colunas certas (`active`, `lastDeliveredAt`, `failureCount`) — nenhuma migration de schema precisou tocar nela, só `notification_preferences` é nova de fato.

**Pendente só do fundador:** confirmar recebimento real de push em Chrome desktop, Chrome Android e Safari iOS instalado na Tela de Início — os 3 dispositivos do critério de aceite. Testável pelo botão "Enviar teste" em Ajustes assim que a chave VAPID estiver como Secret no Replit (ver instruções de deploy).

**ZELO-27 entregue por completo** (`fd995a6`): a história explicita a prioridade — nunca duplicar é mais importante que nunca perder (idoso que recebe o lembrete duas vezes pode tomar a dose duas vezes, dano real). O desenho todo segue essa prioridade.

- Ao gerar uma dose (`dose-generation.ts`), um job `QUEUE_DOSE_REMINDER` é enfileirado na MESMA transação do INSERT da dose, com `startAfter` no horário exato da dose e `singletonKey` `reminder:{doseId}:0` — mesma técnica de `fromDrizzle` já usada pra `DoseScheduled` desde ZELO-18.
- `lib/dose-reminders.ts`: a checagem "a dose já foi registrada?" acontece no DISPARO, não no agendamento — uma dose pode ficar pendente na fila por até 14 dias antes do job rodar.
- Idempotência de execução (a parte que realmente evita duplicar, além do enfileiramento): `UNIQUE(scheduledDoseId, caregiverId, escalationLevel)` em `notifications`. O INSERT — a "reivindicação" — acontece ANTES do envio; se o processo morrer entre reivindicar e enviar, aquele cuidador simplesmente não recebe desta vez (aceito, é o trade-off certo) em vez de arriscar reenviar pra alguém que já recebeu.
- Destinatários: todo cuidador da família com conta vinculada, exceto quem desligou a categoria "dose" pra aquele paciente — primeira vez que o painel de preferências da ZELO-26 tem efeito de verdade.
- Conteúdo do push nunca menciona o medicamento ("Está na hora do remédio de {paciente}") — a regra de privacidade é da ZELO-28, mas precisa valer já aqui porque é este módulo que escreve o payload pela primeira vez.
- Falha de infraestrutura aciona o retry com backoff exponencial da própria fila (`retryLimit`/`retryBackoff` configurados no nível da fila em `queue.ts`) — nenhuma lógica de retry própria no handler. Falha de ENVIO (não de infra) não aciona retry — é coberta pela mesma decisão "nunca duplicar > nunca perder" de cima.

8 testes novos: job enfileirado com o `startAfter` certo, 10 execuções do mesmo job geram exatamente 1 notification por cuidador, dose já registrada não gera lembrete, dose apagada não lança erro, preferência desligada exclui o cuidador certo, cuidador sem conta vinculada é ignorado.

**Total de testes de backend (fim de ZELO-27):** 220/222 passando, 2 pulados por falta de `ANTHROPIC_API_KEY` local — nenhuma falha.

**ZELO-28 entregue por completo** (`4a67853`): as duas regras que vivem na notificação — registrar com um toque, e nunca revelar o medicamento na tela de bloqueio por padrão.

- `families.showMedicationInPush` (novo, desligado por padrão): `dose-reminders.ts` só inclui o nome do medicamento quando a família liga isso explicitamente em Ajustes (motivo explicado na própria tela). Desligado, o texto continua genérico, do jeito que já saía desde a ZELO-27.
- Agrupamento: doses de tratamentos diferentes do mesmo paciente no mesmo horário compartilham um `tag` (`dose-group-{patientId}-{hora}`) — o service worker mescla numa notificação só em vez de empilhar, e suprime os botões de ação quando agrupada (um toque não pode representar duas decisões diferentes).
- "Adiar 15 min" reaproveita toda a fila da ZELO-27: reagenda `QUEUE_DOSE_REMINDER` no nível 1 (a constante que a fundação já previa pra uma cascata futura), sem tabela nem fila nova. Tocar duas vezes não duplica (mesma `singletonKey`, policy exclusive já resolve).
- **Decisão de design deliberada:** o service worker nunca guarda nem lê token de autenticação nenhum, mesmo podendo agir com o app fechado. Repassa a ação (via `postMessage`) pra uma aba alcançável (ela autentica normalmente); sem nenhuma aba aberta, grava no IndexedDB (`zelo-offline-queue`) pra a página sincronizar sozinha ao abrir. Troca deliberada: mais simples e sem expandir a superfície de autenticação pra um contexto sem interface, em vez de um Background Sync cross-browser inconsistente que teria o mesmo problema de autenticação sem solução melhor.
- Abrir a notificação (fora dos botões) leva direto pro paciente certo na tela inicial, mesmo que outro estivesse selecionado.

**Total de testes de backend (fim de ZELO-28):** 224/227 passando, 2 pulados (chave Anthropic local ausente), 1 falha pré-existente e sem relação (`treatment-lifecycle.test.ts`, confirmada contra o commit anterior a ZELO-27 — mesma falha lá; flagrada como tarefa separada, não bloqueia nada aqui).

**ZELO-29 entregue por completo** (`3563477`): o serviço de push aceitar o envio não prova que o aparelho recebeu — sem confirmação real a falha é silenciosa, o pior modo de falha possível pra um lembrete de remédio.

- `notifications.deliveredAt` existia desde a fundação mas nunca era escrito por ninguém — é isto que passa a ser preenchido de verdade, via o beacon do service worker (`POST /push/ack` com `notificationId`, chamado ANTES de exibir a notificação — a única prova real de entrega que a web oferece).
- Job `QUEUE_DELIVERY_CHECK`: agendado 3 minutos depois de todo envio de nível 0. Sem confirmação até lá, e com a dose ainda pendente, escala pro nível 1 automaticamente ("aciona a cascata" da história) — reaproveita o mesmo caminho do botão manual "Adiar 15 min" (ZELO-28), sem fila nem tabela nova. Só um salto (0→1) — níveis 2/3 ficam pra uma cascata futura.
- `push_subscriptions.platform` (ios/android/desktop/unknown) + `notifications.deliveredViaPlatform`: base pra métrica "iOS entrega pior que Android?" — escopo deliberadamente contido, não é uma taxa por dispositivo com denominador exato (precisaria de 1 linha por dispositivo por envio).
- `GET /push/delivery-stats`: taxa de entrega por período, rápida por causa de um índice novo em `notifications(familyId, type, sentAt)` — sem ele, a consulta viraria varredura completa conforme a tabela cresce.
- `lib/push.ts` agora distingue 429 (rate_limited) de 404/410 (expired) e 5xx (error) pra métrica precisa — nenhum aciona retentativa própria, o job de verificação de 3min já cobre "não confirmou entrega" de forma uniforme.

**Achado incidental:** os dois testes antes instáveis por horário real (`home.test.ts`, `treatment-lifecycle.test.ts`) passaram limpos na rodada completa desta história — a correção feita numa sessão paralela (ver "Bug de produção corrigido" acima) se mantém estável.

**Total de testes de backend (fim de ZELO-29):** 237/239 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

**ZELO-30 entregue por completo** (`aba7ecb`): a spec chama esta história de "o que faz o produto valer a assinatura" — os 4 níveis da cascata (T+0/15/30/60), agora todos de uma vez.

- Os 4 níveis passam a ser agendados **upfront**, na mesma transação da dose (antes só o nível 0 nascia junto; níveis 1/2/3 não existiam até a ZELO-30). Cada nível se autoverifica no disparo — nenhum depende do anterior ter rodado de fato, todos convergem no mesmo destino se a dose seguir pendente.
- Destinatário muda por nível: T+0/T+15 avisam só o(s) cuidador(es) principal(is) ("de plantão" — mapeado pro papel `primary_caregiver` já existente, não existe agenda de plantão no produto). T+30 transmite pra todo cuidador com capacidade de registrar (`hasCapability(role, "register_dose")`, ZELO-14). T+60 marca a dose como `late` (reaproveitando o mecanismo que a sessão paralela fechou em `markOverdueDosesAsLate`, não um conceito novo de "perdida") e avisa de novo o(s) principal(is).
- `treatments.escalationProfile` (silencioso/padrão/crítico) + `families.quietHours*` (liga/desliga + início/fim, formato "HH:mm", cruza meia-noite): "silencioso" nunca transmite no T+30; "padrão" transmite exceto durante o silêncio noturno da família; "crítico" ignora o silêncio noturno de propósito — é o perfil pra quando a dose importa a ponto de acordar alguém.
- Todo texto revisado item a item pra nunca atribuir a falta de registro a uma pessoa — o T+30 usa literalmente a frase da spec ("...ainda não foi registrada. Alguém consegue verificar?"), nunca nomeia um cuidador.
- **Bug real encontrado e corrigido no caminho:** o agendamento upfront quebrou silenciosamente o "Adiar 15 min" da ZELO-28. A policy "exclusive" da fila (`queue.ts`) usa `ON CONFLICT DO NOTHING` por `singletonKey` — como o nível 1 agora *sempre* já existe desde a criação da dose (às vezes disparando só horas depois), o clique em "Adiar" tentava criar um segundo job com a mesma chave e o Postgres simplesmente descartava, sem erro nenhum: o lembrete continuava agendado pro horário antigo, não pros +15min prometidos. Corrigido apagando o job pendente daquele nível antes de recriar (`routes/dose-records.ts`) — encontrado porque o teste existente da ZELO-28 passou a falhar (`846min` de diferença em vez de `~15min`), não por inspeção manual.
- UI: seletor de perfil de escalonamento no cadastro de tratamento (`TreatmentForm`), e card de silêncio noturno (liga/desliga + horário) em Ajustes — **escrita e com typecheck limpo, mas não aberta num navegador nesta sessão** (o fluxo de teste local exigiria subir os dois servidores + uma conta nova só pra isso; o fundador já vinha testando o lote inteiro no Replit ao final, então fica junto do resto).

12 testes novos: agendamento dos 4 níveis com `startAfter` correto, destinatário certo por nível (0/1 só principal, 2 todos capazes, 3 só principal + marca `late`), reprocessar um nível não duplica, perfil silencioso nunca transmite, perfil padrão respeita o silêncio noturno mas transmite fora dele (via `Clock.freezeAt`, sem depender da hora real), registrar a dose no meio da cascata cancela os níveis restantes, eventos `escalation_triggered`/`dose_missed` publicados nos níveis certos, revisão de que nenhum corpo de notificação cita nome de cuidador.

**Total de testes de backend (fim de ZELO-30):** 243 no total, 241 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

**ZELO-32 entregue por completo** (`5552ffe`): "a operação precisa saber antes do usuário" — até aqui, uma queda de entrega só apareceria se o fundador reparasse sozinho.

- Autenticação do painel (`lib/admin-auth.ts`) inteiramente separada da de cuidador: senha compartilhada (`ADMIN_PANEL_SECRET`, um só operador por enquanto) assina um JWT com um segredo DIFERENTE de `SESSION_SECRET` — não é uma checagem de campo que alguém possa esquecer, é `jwt.verify` rejeitando por assinatura errada. Testado nos dois sentidos: token de cuidador não abre `/admin/*`, token de admin não abre rota de cuidador.
- `lib/operational-monitor.ts`, cron a cada 2min (a história pede detecção em <5min), 3 checagens contra o serviço INTEIRO (sem recorte de família — é pergunta de operação, não de família): taxa de entrega da última hora <95% (com amostra mínima, senão hora vazia alarmaria à toa), fila com job vencido há >5min sem processar (query direta em `pgboss.job`, fora do schema do drizzle), dose agendada numa janela passada sem nenhum lembrete de nível 0 (falha de AGENDAMENTO, pior que falha de entrega — nem tentativa houve). No máximo 1 alerta ativo por tipo (`operational_alerts`, tabela nova, também sem familyId); "canal do operador" é log de servidor (`logger.error`) — sem provedor pago novo, como a própria história pediu.
- `routes/admin.ts`: `/admin/metrics` (taxa de entrega/ação, latência nível 0, falhas por motivo, volume por plataforma, assinaturas ativas/inativas, série por dia/hora) e `/admin/alerts`. **Disciplina de zero PII**: nenhuma dessas consultas seleciona `notifications.title`/`body` (têm nome de paciente/medicamento nos templates) nem faz join com nome de paciente/cuidador/medicamento — só contagem, taxa, timestamp, enum. Testado de forma concreta: cria paciente/medicamento com nome bem distintivo, dispara lembrete de verdade, confirma que o nome não aparece em nenhuma resposta JSON do painel. `/status`, público, sem PII, só "operational"/"degraded".
- `notifications.lastFailureReason` (novo): até ZELO-29, o motivo preciso de uma falha de envio (expirado vs limite de taxa vs erro) já vinha de volta de `sendPushToUser` mas nunca era gravado — só o agregado (sent/expired/failed) importava pra decidir o próximo passo. Preenchido em `claimAndSendReminder`, é a base de "falhas por motivo" no painel.
- UI: `/admin` (login + painel, visual escuro deliberadamente diferente do resto do app — nunca reaproveita o cabeçalho/nav de cuidador) e `/status` (pública). Ambas checadas ANTES do gate de autenticação de cuidador em `App.tsx` — sem isso, ficariam inacessíveis (engolidas pela tela de login sempre).
- **Achado no caminho, fora do escopo, sinalizado à parte:** `lib/db/src/schema/alert-escalations.ts` definia uma tabela de escalonamento por dose nunca referenciada em lugar nenhum do código — sobra de uma versão anterior (provavelmente pré-pivô, Replit Agent), redundante e num formato incompatível com o que a ZELO-27/30 de fato construíram (`notifications.escalationLevel`). Sinalizado como tarefa separada; o fundador aceitou e a sessão paralela removeu (`acc65de`).
- **Bug de teste (não de produto) encontrado e corrigido no caminho:** a checagem de fila travada é global (sem recorte por fila/família, de propósito). O teste que prova "apagar o job travado resolve o alerta" quebrava porque OUTROS arquivos de teste (que criam tratamento de verdade) sempre deixaram pra trás jobs de lembrete não consumidos — inofensivo até agora, ninguém nunca tinha ido procurar. Corrigido limpando a "sujeira" de qualquer execução anterior antes de afirmar "nenhum job travado restante".

13 testes novos: separação de autenticação (4), agregação/PII (3), status público (1), detecção+resolução de cada um dos 3 tipos de alerta + não-duplicação ao reprocessar (5).

**Total de testes de backend (fim de ZELO-32):** 256 no total, 254 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

## ✅ Fase 07 — Histórico, Estoque e Relatório — CONCLUÍDA (3/3)

| Item | Status | Commit |
|---|---|---|
| ZELO-33 — Calendário de adesão em tom não punitivo | ✅ completa (UI não verificada em navegador) | `a6c0947` |
| ZELO-34 — Controle de estoque e alerta calmo de reposição | ✅ completa (UI não verificada em navegador) | `ce23df4` |
| ZELO-35 — Relatório de adesão para o médico em PDF | ✅ completa (UI não verificada em navegador) | `ac1ee38` |

**ZELO-33 entregue por completo** (`a6c0947`): a spec chama de "a decisão de tom mais importante do produto" — mostrar o que aconteceu sem virar boletim de notas.

- Calendário com 1 ponto por dia, só 3 cores possíveis (vermelho não é um valor que a API consegue nem produzir): verde (todo dose do dia foi RESOLVIDA — tomada, pulada ou adiada, qualquer decisão registrada), âmbar (sobrou pelo menos 1 sem nenhum registro), cinza (não havia dose agendada). "Resolvido" (cor) e "adesão" (percentual, taken/total) são conceitos DIFERENTES de propósito — pular uma dose resolve o dia mas não conta como adesão; testado explicitamente (3 doses, 1 taken + 1 skipped + 1 postponed, dia fica verde mas o percentual é 33%, não 100%).
- `GET /patients/:id/adherence-calendar`: 1 query agregada (`count(*) filter (where ...)`, group by dia) cobrindo o intervalo inteiro pedido — não 1 query por dia — pra caber no critério de aceite de <1s em 90 dias. Resumo com percentual por medicamento e "quem registrou" por cuidador, **sempre ordenado por id, nunca por contagem** — reconhecer contribuição é o pedido explícito da história, ranquear é o oposto do que ela pede.
- Primeira vez que o app checa **plano de verdade** (`lib/subscription.ts`, `hasPaidAccess`): família sem assinatura paga (a maioria hoje — nenhuma rota ainda cria essa linha no cadastro normal) enxerga só os últimos 7 dias, sempre `200` com o que pode mostrar (nunca `402`/`403`) — "convite calmo, não parede", literalmente o texto da história. O sistema de limite/paywall completo é história futura (Monetização, E8); este helper já fica pronto pra ser reaproveitado lá, não precisa ser reinventado.
- "Percentual bate com o dado bruto, incluindo doses recuperadas retroativamente" (critério de aceite): testado via a rota de verdade — dose `late`, registra retroativamente via `POST /dose-records` (mesmo caminho da ZELO-24), o dia vira verde e o percentual sobe, sem nenhum cache/foto congelada no meio.
- UI (`/pacientes/:id/historico`): grade de mês com navegação, alternância semana/mês, filtro por medicamento e cuidador, painel de detalhe ao tocar o dia, banner calmo quando o plano gratuito limita o período.
- **Achado incidental durante os testes, não é bug de produto:** o primeiro teste do arquivo pareceu travar o processo pra sempre (sem terminar, sem erro) — na real, os testes rodavam e terminavam em segundos, só o `after()` esquecia de chamar `boss.stop()` (o registro retroativo de dose liga o pg-boss por baixo) e os timers internos da fila mantinham o processo Node vivo indefinidamente. Corrigido; registrado porque o sintoma ("sem saída nenhuma por minutos") é enganoso e vale reconhecer rápido numa sessão futura.

18 testes novos: cores corretas em cada cenário, filtro por medicamento recortando calendário e resumo juntos, recuperação retroativa via rota real, limite de 7 dias do plano gratuito (com e sem assinatura), detalhe do dia, 90 dias em <1s, isolamento das 2 rotas novas, varredura da cópia da tela contra linguagem de culpa.

**Total de testes de backend (fim de ZELO-33):** 267 no total, 265 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

**ZELO-34 entregue por completo** (`ce23df4`): "ninguém deveria descobrir que o remédio acabou no domingo à noite."

- "Dias restantes" vem do CONSUMO PRESCRITO pela posologia (via `expandSchedule`, o mesmo motor de recorrência já testado desde ZELO-17/18), nunca de quantidade absoluta nem de histórico real de registro — reaproveitar o motor evita reimplementar a conta de doses/dia pros 5 tipos de posologia (cada um com fórmula própria, fácil de errar um). `computeDaysRemaining` combina dias-por-consumo com dias-até-a-receita-vencer (o menor dos dois manda); alerta em ≤5 dias, igual à ZELO-33.
- `POST /treatments` aceita `initialStock` opcional (quantidade, unidade, validade da receita) — upsert por `(patientId, medicationId)`, represcrever o mesmo medicamento atualiza em vez de duplicar. `GET`/`PATCH` de estoque por paciente (ajuste manual com `setQuantity` XOR `addQuantity`, motivo opcional).
- **Achado no caminho, fora do escopo direto:** `/dashboard`'s contagem de estoque baixo estava sem NENHUM filtro de família — corrigido de passagem (join por `patientsTable`) por ser o mesmo tipo de bug de isolamento que o projeto trata como bloqueante em qualquer lugar que apareça.
- UI: seção opcional "Acompanhar estoque" no cadastro de tratamento, card de estoque com ajuste inline na ficha do paciente, banner âmbar "já comprou?" com reposição de um toque na tela inicial.
- **Suíte completa travou de verdade ao rodar `stock.test.ts`** (não só demorou — processo em 0% de CPU por 40+ minutos): mesma causa já vista na ZELO-33, `after()` esquecendo `boss.stop()` (criar um tratamento aqui também liga o pg-boss por baixo, pro lembrete de dose). Corrigido; matei também 3 processos node.exe zumbis de tentativas anteriores presas no mesmo bug (com autorização do fundador, já que matar processo é ação que passa pelo crivo de confirmação).
- **Teste flaky encontrado depois de corrigir o travamento:** "receita vencendo antes do estoque acabar antecipa o alerta" construía a data de vencimento via `Clock.now() + 3 dias` em UTC (`.toISOString()`), mas `computeDaysRemaining` compara contra o dia civil do paciente (`Clock.todayInTimezone`, America/Sao_Paulo) — perto da meia-noite UTC (fim de tarde/noite no Brasil) os dois calendários divergem em 1 dia, fazendo o teste falhar dependendo só da hora em que roda. Não era bug de produto, era bug de teste; corrigido construindo a data a partir do dia civil do paciente, igual o código de produção faz. Blindado também um `afterEach` no describe block: como cada teste usa o mesmo par paciente+medicamento (chave única real em `stock_entries`), uma falha de assertion ANTES da linha de limpeza deixava linha órfã que derrubava em cascata todo teste seguinte — foi exatamente o que aconteceu na primeira rodada (1 falha real virou 3 falhas reportadas).

25 testes novos + 2 entradas de isolamento (`GET`/`PATCH` de estoque).

**Total de testes de backend (fim de ZELO-34):** 286 no total, 284 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

**ZELO-35 entregue por completo** (`ac1ee38`): "a tela subestimada" (spec) — o gatilho de conversão mais forte depois do segundo cuidador, e a porta de entrada do B2B com operadoras.

- PDF gerado no servidor com `pdfkit` (texto puro, sem headless browser/Chromium — mais leve pro Replit) — legível em preto e branco, tipografia grande.
- Reaproveita as mesmas colunas do calendário de adesão (ZELO-33): por medicamento, posologia prescrita, tomadas/puladas/sem-registro, % de adesão. "Adiada" conta como "pulada" no relatório — no produto, uma dose adiada nunca vira "tomada" sozinha (`postponedTo` é só informativo), então na prática é remédio não tomado, mesma classificação.
- **Padrão de horário real vs. prescrito** — o diferencial que a spec credita como "nenhum concorrente entrega": delta médio em minutos entre o horário prescrito e o horário real de registro, calculado só sobre as doses efetivamente tomadas (uma pulada não entra na média).
- Aferições de saúde do período (`health_measurements`) entram cruas na tabela, sem faixa de referência nem cor de risco — mesma disciplina que já vale pro registro desde a fundação.
- Rodapé obrigatório fixo em toda página ("Documento gerado por relato do cuidador. Não é prontuário nem substitui avaliação médica.") — não é decorativo, é o que mantém o produto fora do enquadramento de dispositivo médico.
- **Paywall DURO** (403 sem plano pago) — diferente de propósito do "convite calmo, nunca parede" da ZELO-33: a spec desta história diz "exclusivo do plano pago" sem nenhuma ressalva de nunca bloquear, então o comportamento muda deliberadamente entre as duas histórias irmãs.
- Link assinado e expirável (`adherence_reports`, mesmo padrão de `export_tokens` da exportação LGPD — token hash, nunca o valor cru no banco) — mas 7 dias em vez de 1 hora, e **não é de uso único** (o médico pode abrir mais de uma vez dentro da janela). Expirado responde 410, nunca 404 (o link existiu, só não serve mais). Toda geração e todo acesso entram na trilha de auditoria imutável já existente desde a fundação.
- UI: botão "Gerar relatório em PDF" na própria tela de histórico (`/pacientes/:id/historico`), usa o período em exibição (mês ou semana), devolve link copiável + botão de abrir.
- **Achado técnico no caminho:** `api-server` usa referências de projeto do TypeScript que resolvem `@workspace/db` pelos `.d.ts` compilados em `lib/db/dist`, não pelo código-fonte direto — todo schema novo em `lib/db` precisa de `npx tsc -b --force` ali ANTES do typecheck do `api-server` enxergar o export novo (senão dá erro de "member não existe" mesmo com o código-fonte certo). Vale pra qualquer história futura que crie tabela nova.
- **Achado de teste:** o pdfkit escreve texto em fragmentos hexadecimais dentro do operador `TJ`, quebrados pelo ajuste de kerning entre letras — uma busca direta de substring nos bytes do PDF nunca bate com o texto original. Resolvido gerando o PDF sem compressão (`compress: false`, só pra isto ser testável) e reconstruindo o texto real a partir dos fragmentos hex por bloco `BT..ET`, permitindo provar de verdade (não só por inspeção de código) que o rodapé está presente e nenhuma frase de interpretação clínica aparece no documento gerado.

13 testes novos + 1 de isolamento: paywall duro com e sem plano, números batendo com o histórico (incluindo adiada=pulada), padrão de horário real vs. prescrito calculado certo, aferições sem interpretação, 90 dias em <5s (critério de aceite), PDF válido com rodapé sempre presente e zero linguagem clínica, link expirado vs. reutilizável dentro da validade, isolamento entre famílias.

**Total de testes de backend (fim de ZELO-35, fechando a Fase 07):** 300 no total, 298 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

## ✅ Fase 08 — Consultas e Rotina — CONCLUÍDA (2/2)

| Item | Status | Commit |
|---|---|---|
| ZELO-36 — Agenda de consultas e exames com lembretes escalonados | ✅ completa (UI não verificada em navegador) | `1f23c0b` |
| ZELO-37 — Registro de rotina e aferições, sem nenhuma interpretação | ✅ completa (UI não verificada em navegador) | `8f3d25d` |

**ZELO-36 entregue por completo** (`1f23c0b`): "a segunda maior fonte de ansiedade do cuidador, depois do remédio" (spec).

- `appointments` ganha tipo (consulta/exame/procedimento), `preparationNotes` (sempre relato do que o MÉDICO disse — nunca orientação do app, testado por varredura de linguagem na própria tela, mesmo padrão da ZELO-33/20), `questionsForDoctor` (lista livre que o cuidador vai preenchendo), `postAppointmentNotes` e anexo (base64, mesmo padrão de medication-photos — protegido por autenticação+família, NÃO é link público como o relatório da ZELO-35, porque não é feito pra sair do app, é referência interna).
- `lib/appointment-reminders.ts`: 3 níveis FIXOS (1 semana/1 dia/2h antes), sempre pra toda a família — sem cascata condicional por papel como a de dose (ZELO-30), reaproveitando 100% da infraestrutura de fila e push já construída (nenhum código novo de envio). Só agenda os níveis cujo horário ainda está no futuro (consulta marcada pra amanhã não dispara "1 semana antes" na hora). Idempotência nas mesmas duas camadas do lembrete de dose (singletonKey no pg-boss + `UNIQUE(appointmentId, caregiverId, escalationLevel)` em `notifications`). Nível de 2h inclui "o que perguntar ao médico" em destaque no corpo do push.
- Remarcar (nova data) cancela os 3 lembretes antigos e reagenda a partir da nova; qualquer mudança de status que não seja "scheduled" só cancela — nunca deixa lembrete órfão.
- **Achado técnico reaproveitado:** `@workspace/scheduling` já tinha `localToUtc` (data civil + hora + fuso → instante UTC) internamente no motor de recorrência desde a ZELO-17/18, só nunca tinha sido exportado — exportar e reaproveitar evitou reimplementar a mesma conversão de fuso pra consulta (mesma regra da ZELO-19: "14h" é 14h no relógio de parede de onde a consulta acontece, não no fuso de quem cadastra). `GET /appointments` devolve `scheduledLocalDate`/`scheduledLocalTime` já resolvidos no fuso do paciente, pelo mesmo motivo que a ZELO-19 existe (nunca deixar o cliente reconverter o instante UTC sozinho).
- UI: tela de consultas (`/pacientes/:id/consultas` — lista + formulário + lista de perguntas editável + anexo + notas pós-consulta com atalho pro formulário de tratamento), link "Consultas" na ficha do paciente.
- **Quatro bugs de produção reais encontrados e corrigidos durante o teste ao vivo do fundador nesta história** (não são bugs da ZELO-36 em si, mas foram descobertos testando o app nesse momento) — ver seção "🔴 Quatro bugs de produção" no topo deste arquivo para detalhe completo: sessão não trocava de família ao aceitar convite, `<html lang="en">` quebrando com Chrome Translate, estado vazio da tela inicial nunca aparecendo, e build de produção quebrado por `@swc/helpers` mal externalizado no esbuild.
- **Achado de processo:** Postgres local parou de aceitar conexão no meio desta história (bloqueio de permissão do Windows, causa raiz não identificada) — contornado com um Postgres descartável via Docker Desktop, ver "🐘 Incidente do Postgres local" acima. No caminho, achei e corrigi um bug real no PRÓPRIO teste de isolamento (não no app): token gerado com o relógio de teste (`Clock.freezeAt`) ainda congelado numa data passada — o JWT nascia expirado pra validação real (o `jsonwebtoken` não conhece nosso `Clock` injetável, valida contra o relógio de verdade do sistema).

9 testes novos + 2 de isolamento: os 3 níveis agendados no horário certo (incluindo pular níveis já no passado), remarcar cancela e reagenda sem duplicar, cancelar remove os pendentes, perguntas aparecem só no lembrete de 2h, idempotência ao reprocessar, anexo aceito e servido de volta, isolamento entre famílias, varredura de linguagem de preparo.

**Total de testes de backend (fim de ZELO-36):** 311 no total, 309 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha. Verificado contra o Postgres em Docker (`zelo-test-pg`), não contra o serviço nativo (fora do ar).

**ZELO-37 entregue por completo** (`8f3d25d`), fechando a Fase 08: "a story onde é mais fácil cruzar a linha do dispositivo médico" (spec) — a fronteira precisa estar explícita no código, não só na intenção.

- `health_measurements` já existia desde a fundação (só era lida pela exportação LGPD e pelo relatório em PDF, ZELO-35) — ganhou rota própria de verdade agora (`GET`/`POST`/`DELETE`). `value` é sempre texto bruto, nunca convertido pra número, comparado ou classificado em NENHUM lugar do router — é o que torna estruturalmente impossível reagir ao valor, não só uma promessa de não fazer isso.
- `activities` (tabela nova): registro simples de feito/não-feito (fisioterapia, banho, alimentação, caminhada) — sem meta, sem streak, sem consequência diferente entre feito e não-feito, mesma filosofia neutra de toda outra tela do produto.
- `patients` ganha `emergencyContactName`/`emergencyContactPhone` — "se o cuidador achar algo preocupante, escreve na observação; a ação do app é oferecer o contato de emergência já cadastrado, encaminhar, nunca avaliar" (texto da própria história). Sem tela de edição de paciente existente ainda no app pra pendurar isso — mini-formulário dedicado só a esse campo na própria tela de rotina, sem inventar uma tela cheia de edição fora do escopo.
- UI (`/pacientes/:id/rotina`): gráfico de linha puramente descritivo via `recharts` direto (sem o `ChartContainer` de tema do design system — controle total pra garantir zero zona colorida/linha de referência/seta de tendência), só pros tipos numéricos puros (pressão arterial é "120/80", não plotável como número único sem inferir sozinho qual metade importa — decisão deliberada de não fazer essa inferência).
- **Critério de aceite central é negativo, testado de forma concreta:** registra valores clinicamente extremos (pressão 220/140, glicemia 500, saturação 60, frequência cardíaca 220, temperatura 42°C) e prova que NENHUMA notificação nasce disso; a resposta da API nunca tem campo de classificação/risco/status; varredura de linguagem na própria tela proibindo frases como "pressão alta"/"procure um médico"/"fora do normal". A própria varredura pegou um falso-positivo no meu comentário de documentação (que citava "faixa de referência" explicando a REGRA, não violando ela) — reescrito pra não colidir, ficando mais preciso no processo.

8 testes novos + 4 de isolamento.

**Total de testes de backend (fim de ZELO-37, fechando a Fase 08):** 323 no total, 321 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha.

## 🔵 Fase 09 — Monetização — 1/2

| Item | Status | Commit |
|---|---|---|
| ZELO-38 — Planos, limites e paywall no convite do segundo cuidador | ✅ completa (UI não verificada em navegador) | `5a6cbde` |
| ZELO-39 — Assinatura pela web, fora da comissão das lojas | ⏸️ **pulada** — sem PSP decidido (ver "Fornecedores adiados" acima) | — |

**ZELO-38 entregue por completo** (`5a6cbde`): "o paywall é social, não funcional" (decisão de PM) — o gratuito é generoso o bastante pra virar hábito, e limita exatamente onde a dor aparece: quando o irmão quer entrar.

- `lib/plan-limits.ts` — fonte ÚNICA dos números (1 paciente/1 cuidador/3 medicamentos/7 dias de histórico no gratuito; 5 pacientes e o resto ilimitado no plano Família), exatamente como a história pede ("testar preço e limite sem tocar em regra de negócio"). Reaproveita `hasPaidAccess` (ZELO-33) como base — a distinção grátis/pago já existia desde o calendário de adesão, só nunca tinha limites de verdade em cima.
- Limites aplicados NO SERVIDOR em cada rota que cria o recurso contado (pacientes, convites, medicamentos) — nunca só escondendo botão. Reativar um paciente arquivado conta igual cadastrar um novo, senão seria um contorno óbvio do limite.
- **O momento do paywall é literalmente ao convidar o 2º cuidador** — `POST /invites` bloqueia ANTES de criar a linha (nenhum convite fica pendente pra trás), com o texto exato da história ("Cuidar junto é melhor. O plano Família libera cuidadores ilimitados.") numa tela quente na UI — ícone de coração, sem vermelho, sem contagem regressiva, bem diferente de um alerta de erro comum.
- Consultas (ZELO-36) e alerta de estoque baixo (ZELO-34) viram recursos do plano Família — mesma disciplina já usada no relatório em PDF (ZELO-35, paywall duro) e no histórico de 7 dias (ZELO-33, soft-limit). O CONTROLE de estoque em si continua liberado no gratuito, só o alerta calmo é que é gated — a spec só cita "alerta de estoque baixo" na tabela, não o controle, distinção deliberada.
- **Downgrade nunca apaga dado**: paciente excedente do limite atual (os mais antigos por `createdAt` continuam editáveis, ranking determinístico e sempre o mesmo) vira somente-leitura — bloqueado em registrar dose e criar tratamento novo, mas sempre visível e legível por completo em qualquer rota de leitura.
- Estado do plano exposto em `GET /account/me` e visível em Ajustes, sem banner nem lembrete recorrente ("sem martelar no dia a dia" — texto da própria história).
- **Achado no caminho, o mais relevante desta história:** os limites novos quebraram 3 arquivos de teste PRÉ-EXISTENTES (`isolation.test.ts`, `appointments.test.ts`, `home.test.ts`) cujas famílias-fixture nunca tinham plano definido explicitamente (gratuito por padrão) e cujos testes assumiam sucesso ao criar um 2º paciente/cuidador ou ver o alerta de estoque. Corrigido dando plano pago de baseline onde a história em si não é sobre limite — mesmo padrão já usado em `stock.test.ts`/`adherence-calendar.test.ts`. Vale de lição pra qualquer história futura que module algo atrás de `hasPaidAccess`: checar se fixtures antigas dependem do comportamento antigo antes de assumir que só os testes novos importam.

9 testes novos: limite de paciente (incluindo reativação contando pro limite), o paywall do convite provando que nenhuma linha é criada, limite de medicamento, consulta bloqueada por inteiro, alerta de estoque escondido mas controle preservado, downgrade preservando dado em modo leitura (dois testes, um por ângulo), estado do plano no perfil. Nenhuma mudança de schema nesta história.

**Total de testes de backend (fim de ZELO-38):** 332 no total, 330 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha. Verificado contra o Postgres em Docker (`zelo-test-pg`).

## 🔵 Fase 10 — Alcance ao Paciente e App Nativo (+ Cuidado Institucional) — 1/4

| Item | Status | Commit |
|---|---|---|
| ZELO-40 — Modo idoso: interface simplificada para o próprio paciente | ✅ completa (UI não verificada em navegador) | `a88420f` |
| *(demais itens da fase ainda não detalhados — ver Plane, módulo "E9 — Alcance ao Paciente e App Nativo")* | ⬜ pendente | — |

**ZELO-40 entregue por completo** (`a88420f`), pulando a ZELO-39 adiada e seguindo a ordem numérica a partir do próximo item disponível: "para o idoso que *quer* participar — continua sendo reforço, jamais dependência" (texto da própria história).

- `patients.elderModeEnabled` (liga/desliga por paciente, só o cuidador principal muda — `PATCH /patients/:id/elder-mode`) é só a PERMISSÃO. Ativar de fato num aparelho é uma ação separada, física, feita no dispositivo do próprio idoso: o cuidador loga nele normalmente e aperta "Ativar neste dispositivo agora" — grava só um `patientId` no `localStorage` daquele aparelho específico. **Decisão de desenho central:** o modo idoso NÃO é uma conta própria do paciente — o dispositivo travado reaproveita a MESMA sessão do cuidador que o ativou. Mais simples que inventar autenticação por PIN/token separada, e reaproveita 100% da infraestrutura de registro de dose e autorização já existente, sem abrir superfície nova de autenticação.
- `App.tsx` intercepta a navegação inteira: se o `localStorage` tem um `patientId` de modo idoso, TODA rota (URL digitada, botão voltar, notificação) cai na tela única do modo idoso — checado depois do gate de autenticação normal, antes de qualquer `<Route>`. É isso que cumpre o critério de aceite "nenhum caminho leva a uma tela complexa por engano", não uma promessa de UI.
- Tela única: nome do medicamento + horário em fonte grande, botão "Tomei" gigante, botão "Ouvir" (lê o lembrete em voz alta via Web Speech API do navegador, `pt-BR`) — nada de percentual de adesão, estoque ou histórico, isso é ferramenta de cuidador, não desta tela. Tamanhos em unidade relativa (rem, via as classes padrão do Tailwind) de propósito — é o que faz funcionar com a fonte do sistema no máximo sem quebrar layout, sem precisar de nenhum código extra de detecção.
- Sair exige a senha do cuidador, atrás de um toque longo (3s) discreto num canto sem nada visível — nunca aparece como um botão pra quem está usando o modo idoso, só quem já sabe que existe (o cuidador) consegue acionar.
- **Atribuição na tela inicial:** `dose_records.registeredViaElderMode` (novo) — quando uma dose é registrada pelo modo idoso, `GET /patients/:id/today-doses` troca o nome exibido pelo do PRÓPRIO PACIENTE ("✓ 08:00 — Dona Maria" em vez do cuidador logado no aparelho, texto literal da história). Mas só o RÓTULO da vitrine do dia muda — o `caregiverId` de auditoria real (quem de fato estava logado) continua intacto no banco e é o que `GET /dose-records` (auditoria/histórico) sempre mostra. Decisão deliberada, não descuido: a tela inicial é "quem cuidadores veem no dia a dia", a auditoria é "o que de fato aconteceu por trás".
- Nenhuma tabela nem rota nova de autenticação — só os dois campos novos (`elderModeEnabled`, `registeredViaElderMode`) e um endpoint de toggle. `POST .../dose-records` ganhou o campo opcional `viaElderMode`, sem mudar nada do comportamento pra quem não manda esse campo.

5 testes novos (`elder-mode.test.ts`): liga/desliga com isolamento entre famílias (404 pra paciente de outra família) e 403 pra cuidador não-principal, atribuição ao paciente na tela inicial vs. cuidador real na auditoria (registrado num teste só, provando as duas leituras do mesmo evento), e o caminho sem `viaElderMode` continua mostrando o cuidador normalmente (prova de que nada regrediu pro fluxo padrão).

**Total de testes de backend (fim de ZELO-40):** 337 no total, 335 passando, 2 pulados (chave Anthropic local ausente) — nenhuma falha. Verificado contra o Postgres em Docker (`zelo-test-pg`).

**UI não verificada em navegador real, por um motivo diferente do de sempre:** a separação frontend/backend deste app só existe de fato atrás do roteamento do Replit (dois serviços, uma origem pública) — não há proxy local equivalente, então testar de ponta a ponta localmente exigiria montar essa infraestrutura só pra isto, fora do escopo da história. Fica pro roteiro de teste do fundador no Replit, junto do resto do lote pendente.

## QUI-5 — Fundação de mídia: guardar arquivo fora do banco (25/08/2026)

Primeira história do projeto **ZELO — Momentos**. **Sem tela nenhuma**, de propósito: é a base para
as outras seis, e sozinha não entrega nada ao usuário.

- **Tabela `media_assets`** guarda só o CATÁLOGO — família, paciente, quem enviou, tipo, MIME,
  tamanho e a chave no bucket. **Nunca o binário.** É a diferença deliberada em relação a
  `photo_extractions.photo_data` e `appointments.attachment_data`, que guardam base64 dentro do
  Postgres. Os dois legados ficaram onde estão: migrar junto misturaria dois riscos.
- **Sem coluna `deletedAt`.** Apagar apaga o objeto no bucket e a linha. Marcar como excluída
  convidaria a "recuperar" depois um arquivo que o consentimento já não cobre.
- **`lib/media-storage.ts` — armazenamento atrás de uma interface**, com duas implementações:
  Object Storage do Replit e memória. Não é abstração por elegância: sem a de memória, nenhum teste
  de mídia rodaria (o CI não tem bucket), e o `dev` local também não.
- **Falha fechada em produção:** sem `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, produção **não** cai para
  memória — a rota responde **503** dizendo o que falta. Cair para memória aceitaria o upload,
  responderia 201 e perderia o arquivo no restart: perda de dado disfarçada de sucesso. Mesma regra
  do `getAdminSecret()`.
- **`lib/media-links.ts` — link curto e assinado, sem estado.** A sessão é `Bearer` em memória e
  `<img src>` não manda header, então rota atrás de `requireAuth` simplesmente não renderiza. O
  token é `id.exp.assinatura`, válido por **10 minutos**, e nada é gravado — um mural de 20 fotos
  gravaria 20 linhas por rolagem se seguisse o padrão de `export_tokens`.
- **A chave do HMAC é derivada do `SESSION_SECRET` com separação de domínio**, e isso NÃO repete o
  erro de 23/08 (`ADMIN_PANEL_SECRET === SESSION_SECRET`): lá o problema eram chave igual **e**
  formato igual, então um token passava pelo verificador do outro. Aqui a chave é outra (derivação
  de mão única) e o formato é outro (não é JWT). Testado **nos dois sentidos**.
- **O tipo vem do MIME, nunca do cliente.** Se o cliente mandasse `kind`, mandaria um vídeo de 8 MB
  declarando "image" e escaparia do teto de 2 MB. Tetos: imagem 2 MB, áudio 1 MB, vídeo 8 MB.
  **SVG está fora do allowlist** — é documento executável e viraria XSS ao ser servido de volta.
- **Ordem das operações é explícita nos dois sentidos.** No envio: objeto primeiro, linha depois, e
  o objeto é removido se a linha falhar. Na exclusão: objeto primeiro, e se falhar a linha
  **continua lá** para poder tentar de novo — apagar a linha antes deixaria um arquivo pessoal
  órfão no bucket, que é o oposto do que alguém pediu ao mandar apagar.
- Isolamento por família como toda rota: mídia de outra família responde **404, nunca 403**.

**25 testes novos** (`media.test.ts`), incluindo: o link expira de verdade com o relógio andando;
token adulterado morre; apagar remove o objeto do bucket (conferido no armazenamento, não só no
banco); SVG recusado com 415; imagem acima do teto recusada com 413; cuidador de outra família
recebe 404 no link e no delete; e nenhuma coluna da tabela contém o binário.

**Suíte completa depois desta história:** **432 testes, 430 passando, 2 pulados, zero falhas** —
medido em 25/08/2026 contra o Postgres em Docker
([runbooks/banco-de-teste-local.md](runbooks/banco-de-teste-local.md)).

**Pendente de deploy:** `media_assets` ainda não está em `sql/producao-schema-completo.sql`, e o
`pnpm --filter @workspace/db run push` precisa rodar no Replit.

---

## Fases

| # | Fase | Status |
|---|---|---|
| 01-03 | Fundação, Identidade, Paciente/Cuidadores | ✅ 15/15 |
| 04 | Tratamento e Agenda | ✅ 6/6 |
| 05 | Tela Inicial e Registro de Dose | ✅ 4/4 |
| 06 | Notificação e Escalonamento ⭐ | 🔵 6/7 (ZELO-31 pulada, ver "SMS adiado") |
| 07 | Histórico, Estoque e Relatório | ✅ 3/3 |
| 08 | Consultas e Rotina | ✅ 2/2 |
| 09 | Monetização | 🔵 1/2 (ZELO-39 pulada, ver "Fornecedores adiados") |
| 10 | Restante (Alcance/App Nativo, Cuidado Institucional) | 🔵 1/4 |

