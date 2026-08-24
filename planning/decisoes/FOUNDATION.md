# ZELO — Documentação de Fundação

> Documento estrutural: o que o produto é, como está organizado e o que nunca pode mudar.
> **Não contém números que envelhecem** (contagem de testes, progresso) — isso vive em
> [../../CONTEXT.md](../../CONTEXT.md) e [../STATE.md](../STATE.md).
>
> Mapa de módulos e lista de tabelas conferidos contra o código em 23/08/2026.

## O produto em 3 linhas

ZELO é um app de cuidado compartilhado para famílias com idosos.
Permite que múltiplos cuidadores coordenem o registro de medicamentos, consultas e
aferições de saúde de um paciente — sem duplicidade, sem culpa, com clareza.

---

## Stack tecnológica fechada

| Camada | Tecnologia | Notas |
|---|---|---|
| Frontend | React + Vite + TypeScript | PWA instalável, sem app nativo |
| Backend | Node.js 24 + Express 5 + TypeScript | esbuild para produção |
| Banco | PostgreSQL | Drizzle ORM, schema-first |
| Fila | pg-boss | roda sobre o mesmo Postgres da aplicação |
| IA de visão | Claude Haiku 4.5 (SDK Anthropic) | leitura de receita, saída validada com Zod |
| Senhas | Argon2id | parâmetros OWASP (64MB, 3 iterações) |
| Validação | Zod + Orval codegen | spec OpenAPI → types + hooks |
| Monorepo | pnpm workspaces | `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts` |
| Testes | `node:test` (unit) + `tsx` (integração) | `--test-concurrency=1` obrigatório |
| Deploy | Replit (PWA web + API) | segredos no vault do Replit |

---

## Mapa dos módulos do backend (`artifacts/api-server/src/`)

### `routes/` — 30 arquivos

| Domínio | Arquivos |
|---|---|
| Identidade e conta | `auth.ts`, `google-auth.ts`, `account.ts`, `consent.ts` |
| Família e cuidadores | `caregivers.ts`, `invites.ts` |
| Paciente e tratamento | `patients.ts`, `medications.ts`, `treatments.ts`, `medication-photos.ts` |
| Dose | `dose-records.ts`, `adherence-calendar.ts`, `adherence-report.ts` |
| Rotina e saúde | `appointments.ts`, `activities.ts`, `activity.ts`, `health-measurements.ts` |
| Estoque | `stock.ts` |
| Notificação | `notifications.ts`, `notification-preferences.ts`, `push.ts`, `realtime.ts` |
| Painel e operação | `dashboard.ts`, `admin.ts`, `health.ts`, `audit.ts` |
| LGPD | `export.ts` |
| Acesso do paciente | `patient-access.ts` |
| Dev | `dev-clock.ts` — **atrás de `allowsDevelopmentShortcuts()`; não existe em produção** |
| Montagem | `index.ts` |

### `lib/` — 27 arquivos

| Arquivo | Responsabilidade |
|---|---|
| `environment.ts` | **Fonte única de detecção de ambiente.** Ausência de `NODE_ENV` = produção |
| `clock.ts` | Relógio controlável (`Clock.now()`, `freezeAt`, `advance`) |
| `safe-logger.ts` | Logger com allowlist; campo fora da lista vira `[REDACTED]` |
| `logger.ts` | Pino com redact de cookies/auth |
| `family-access.ts` | Isolamento multi-tenant — retorna 404, nunca 403 |
| `capabilities.ts` | Matriz papel × capacidade. **Fonte única** de quem pode o quê |
| `auth-types.ts` | `getAuth(req)` — ver armadilha de module augmentation |
| `tokens.ts`, `password.ts` | JWT (usando `Clock`) e Argon2id |
| `active-family.ts` | Resolve o vínculo ativo de quem tem 2+ famílias, de forma determinística |
| `rate-limit.ts` | Limitadores por rota, incluindo os de endpoint pago e público |
| `vision.ts` | Claude Vision + validação Zod da saída + defesa contra injeção por imagem |
| `queue.ts` | pg-boss |
| `dose-generation.ts`, `dose-reminders.ts`, `treatment-lifecycle.ts` | Motor de doses |
| `appointment-reminders.ts`, `operational-monitor.ts` | Lembretes e alerta operacional |
| `plan-limits.ts`, `subscription.ts` | Tiers de plano e assinatura |
| `stock.ts`, `adherence-report.ts` | Estoque e relatório |
| `push.ts`, `realtime.ts`, `email.ts` | Canais de entrega |
| `audit.ts` | Registro de auditoria imutável (fire-and-forget) |
| `admin-auth.ts` | Autenticação do painel operacional |

### `middleware/`

- `require-auth.ts` — sessão de **cuidador**, header `Authorization`
- `require-patient-access.ts` — token de **dispositivo do paciente**, header `X-Patient-Access`

Os dois nunca se cruzam: header diferente, middleware diferente, escopo diferente.

### `scripts/`

- `check-clock-usage.sh` — falha se lógica de domínio usar `new Date()` / `Date.now()` diretamente

---

## Os 5 invariantes que nunca podem ser violados

### 1. Dose sempre persistida no banco
Nenhum estado de dose existe apenas na memória do servidor ou no cliente.
Toda transição (pendente → tomada / pulada) produz um registro em `dose_records` com
`scheduled_dose_id`, `caregiver_id`, `taken_at` e `outcome`. A constraint
`UNIQUE(scheduled_dose_id)` impede duplicidade no nível do banco — um erro `23505`
retorna HTTP 409 para o cliente.

**Corolário:** "agora" é o relógio do **servidor**. O cliente não manda `takenAt` para
dizer "acabei de tomar" — dessincronia de segundos entre os dois relógios já recusou
registro legítimo.

### 2. Todo acesso a paciente validado no servidor contra o vínculo familiar
Nenhuma rota retorna dados de paciente sem verificar `patient.family_id = req.familyId`.
A verificação é feita em `lib/family-access.ts`. Em caso de falha: **HTTP 404, não 403** —
para não confirmar a existência de recurso alheio. O `familyId` vem sempre do JWT, nunca
da URL ou do body.

### 3. Logs nunca contêm nome de medicamento, condição de saúde ou identificador de paciente
Todo log passa por `safeLog`, que usa allowlist explícita — campo fora da lista vira
`[REDACTED]` automaticamente, sem depender de quem escreve o log saber o que omitir.

**Armadilha conhecida:** `safeLog` sanitiza o **contexto** (1º argumento), não a
**mensagem** (2º). Um segredo interpolado na mensagem contorna a proteção inteira. Um
teste varre o código-fonte atrás disso.

### 4. O produto nunca prescreve, calcula dose, interpreta aferição nem verifica interação medicamentosa
ZELO registra o que o cuidador fez — não decide o que fazer.
- Aferições (pressão, glicemia, peso) são armazenadas como string bruta, sem faixas de referência.
- Não há lógica de "dose está alta/baixa", sugestão de medicamento ou verificação de interação.
- O médico interpreta. O ZELO registra e exibe.

Vale para todas as fases futuras do produto.

### 5. Nada que proteja a segurança do paciente entra em paywall
Registrar dose, lembrete, escalonamento e modo idoso valem em **todos** os planos,
inclusive no gratuito. O paywall fica onde é sobre **crescer** — paciente novo, cuidador
novo, tratamento novo — e em recurso extra.

Esta regra precisou ser aplicada à força depois de um idoso, com o aparelho na mão,
receber `403 PLAN_READ_ONLY` ao apertar "Tomei".

---

## Regra de tom — dose perdida é âmbar, nunca vermelho

| Contexto | Cor | Hex |
|---|---|---|
| Dose tomada | Verde calmo | `#659A76` |
| Dose pendente / atrasada | Âmbar | `#E9AD51` |
| Qualquer alerta de dose | Âmbar | `#E9AD51` |
| Vermelho em contexto de dose | **PROIBIDO** | — |

Vermelho amplifica ansiedade. O ZELO reduz culpa. Âmbar comunica atenção sem pânico.
Nunca reverter sem decisão explícita de produto documentada aqui.

**Única exceção deliberada:** o botão de *sair do modo idoso* é vermelho — é ação
destrutiva de sessão, não estado de dose.

**Corolário aprendido na prática:** "nada que gere ansiedade" **nunca quis dizer esconder
falha**. Para quem olha a tela, silêncio e falha são a mesma coisa: parece quebrado.
Tom calmo, feedback sempre explícito. Nenhum caminho de código termina em `return` mudo.

---

## Modelo de dados — 31 tabelas

| Grupo | Tabelas |
|---|---|
| Tenant e pessoas | `families`, `patients`, `caregivers`, `users` |
| Sessão e identidade | `sessions`, `refresh_tokens`, `email_verifications`, `password_resets`, `oauth_login_codes` |
| Entrada na família | `caregiver_invites` |
| Acesso do paciente | `patient_access_tokens` |
| LGPD | `consent_records`, `export_tokens`, `deletion_requests` |
| Medicação | `medications`, `treatments`, `scheduled_doses`, `dose_records`, `photo_extractions` |
| Estoque | `stock_entries` |
| Rotina e saúde | `appointments`, `activities`, `health_measurements` |
| Relatório | `adherence_reports` |
| Notificação | `notifications`, `notification_preferences`, `push_subscriptions` |
| Assinatura | `subscriptions`, `subscription_plans` |
| Operação | `operational_alerts`, `audit_log` |

### Proteções no nível do banco

- `UNIQUE(treatment_id, scheduled_at)` em `scheduled_doses` — bloqueia dose duplicada
- `UNIQUE(scheduled_dose_id)` em `dose_records` — bloqueia registro duplo
- Trigger `audit_log_immutable` (BEFORE UPDATE OR DELETE em `audit_log`) — a auditoria é
  append-only. Vive em SQL puro, **fora do Drizzle**, em `lib/db/sql/audit-log-immutability.sql`:
  é fácil de esquecer ao montar um banco do zero e não é opcional.
- Toda FK com `onDelete: "set null"` precisa de coluna nullable — o contrário é contradição
  que o banco rejeita.

### Schema de produção

`lib/db/sql/producao-schema-completo.sql` contém as 31 tabelas. Use-o com
`lib/db/scripts/aplicar-sql.mjs`, que **verifica o resultado** no `information_schema` em
vez de confiar na ausência de erro — `drizzle-kit push` morre em silêncio no Shell do Replit.

---

## Gap conhecido e documentado: papel por família, não por paciente

O papel do cuidador hoje é **um valor por família** (`caregivers.role`), não por paciente.
A spec original pede granularidade por paciente ("cuidador do pai, observador da mãe, mesma
conta"). Isso exigiria uma tabela de junção cuidador × paciente e mudar o modelo de
autorização do JWT — que hoje carrega um `role` único por sessão — para resolver o papel a
cada requisição.

Está documentado no cabeçalho de `lib/capabilities.ts` e registrado como pendência em
[../STATE.md](../STATE.md). **Não existe tabela `patient_caregivers`** — documentação
anterior afirmava que sim, e isso nunca foi verdade.
