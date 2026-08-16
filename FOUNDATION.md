# ZELO — Documentação de Fundação

## O produto em 3 linhas

ZELO é um app de cuidado compartilhado para famílias com idosos.
Permite que múltiplos cuidadores coordenem o registro de medicamentos, consultas e
aferições de saúde de um paciente — sem duplicidade, sem culpa, com clareza.

---

## Stack tecnológica fechada

| Camada | Tecnologia | Notas |
|---|---|---|
| Frontend | React + Vite + TypeScript | PWA instalável, sem app nativo |
| Backend | Node.js + Express + TypeScript | esbuild para produção |
| Banco | PostgreSQL (Replit managed) | Drizzle ORM, schema-first |
| Validação | Zod v3 (api-zod) + Orval codegen | Spec OpenAPI → types + hooks |
| Monorepo | pnpm workspaces | `lib/db`, `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` |
| Testes | Node.js `node:test` (unit) + `tsx` (integração) | 26 testes, sem framework externo |
| Deploy | Replit (PWA web + API) | SESSION_SECRET no vault |

---

## Mapa dos módulos do backend (`artifacts/api-server/src/`)

```
routes/
  health.ts          — GET /healthz com verificação real de conectividade ao banco
  families.ts        — CRUD de famílias/tenants
  patients.ts        — CRUD de pacientes (isolado por familyId)
  caregivers.ts      — CRUD de cuidadores (isolado por familyId)
  medications.ts     — CRUD de medicamentos (isolado por familyId)
  dose-records.ts    — Registro de doses; responde 409 em duplicata
  notifications.ts   — Listagem e ack de notificações
  audit.ts           — Log de auditoria (somente leitura via API)
  dashboard.ts       — Resumo do dia, adesão, tokens do design system
  dev-clock.ts       — Controle do relógio [DEV ONLY — não existe em produção]

lib/
  clock.ts           — Relógio controlável (Clock.now(), Clock.advance())
  safe-logger.ts     — Logger com allowlist de campos; campos sensíveis → [REDACTED]
  family-access.ts   — Verificação de isolamento multi-tenant (retorna 404, não 403)
  audit.ts           — Registro de auditoria imutável (fire-and-forget)
  logger.ts          — Pino com redact de cookies/auth

scripts/
  check-clock-usage.sh — Lint: falha se lógica de domínio usar new Date() diretamente
```

---

## Os 4 invariantes que nunca podem ser violados

### 1. Dose sempre persistida no banco
Nenhum estado de dose existe apenas na memória do servidor ou no cliente.
Toda transição de estado de dose (pendente → tomada / pulada) produz um registro em
`dose_records` com `scheduled_dose_id`, `caregiver_id`, `taken_at` e `outcome`.
A constraint `UNIQUE(scheduled_dose_id)` em `dose_records` impede duplicidade
no nível do banco — um erro `23505` retorna HTTP 409 para o cliente.

### 2. Todo acesso a paciente validado no servidor contra o vínculo familiar
Nenhuma rota retorna dados de paciente sem verificar `patient.family_id = req.familyId`.
A verificação é feita em `lib/family-access.ts` (`verifyPatientBelongsToFamily`).
Em caso de falha: HTTP 404 (não 403 — para não confirmar existência de recurso alheio).
Nunca confiar no `familyId` enviado pelo cliente sem verificar no banco.

### 3. Logs nunca contêm nome de medicamento, condição de saúde ou identificador de paciente
Todo log de aplicação passa por `safeLog` (`lib/safe-logger.ts`), que usa uma
allowlist explícita de campos seguros. Campos fora da lista são substituídos por
`[REDACTED]` automaticamente — sem depender de quem escreve o log saber o que omitir.
12 testes automatizados verificam isso para cada categoria de dado sensível.

### 4. O produto nunca prescreve, calcula dose, interpreta aferição nem verifica interação medicamentosa
ZELO registra o que o cuidador fez — não decide o que fazer.
- Aferições (pressão, glicemia, peso) são armazenadas como string bruta, sem faixas de referência.
- Não há lógica de "dose está alta/baixa".
- Não há sugestão de medicamento.
- Não há verificação de interação medicamentosa.
- O médico interpreta. O ZELO registra e exibe.
Esta restrição vale para todas as fases futuras do produto.

---

## Regra de tom — dose perdida é âmbar, nunca vermelho

| Contexto | Cor | Hex |
|---|---|---|
| Dose tomada | Verde calmo | `#659A76` |
| Dose pendente / atrasada | Âmbar | `#E9AD51` |
| Qualquer alerta de dose | Âmbar | `#E9AD51` |
| Vermelho | **PROIBIDO** | — |

Vermelho amplifica ansiedade. O ZELO reduz culpa. Âmbar comunica atenção
sem pânico. Esta decisão de tom nunca pode ser revertida sem decisão explícita
do produto documentada aqui.

---

## Modelo de dados — tabelas existentes

| Tabela | Propósito |
|---|---|
| `families` | Tenant raiz — toda query de paciente é isolada por `family_id` |
| `patients` | Idoso sendo cuidado; tem `timezone` obrigatório |
| `caregivers` | Papel de cuidador por família; roles: primary/caregiver/hired/observer |
| `users` | Conta de autenticação do cuidador (auth vem na próxima fase) |
| `sessions` | Sessões web com hash do token |
| `refresh_tokens` | Tokens revogáveis individualmente por dispositivo |
| `consent_records` | Consentimento LGPD versionado — imutável por design |
| `caregiver_invites` | Convites por link com token com hash, uso único |
| `medications` | Catálogo de medicamentos por família |
| `treatments` | Prescrição de posologia; tipo de agenda em `schedule_config` JSON |
| `scheduled_doses` | Doses agendadas; `UNIQUE(treatment_id, scheduled_at)` |
| `dose_records` | Registro de resultado; `UNIQUE(scheduled_dose_id)` |
| `alert_escalations` | Escalonamento de alerta (separado de notifications — ver PLATFORM_DECISIONS.md) |
| `stock_entries` | Estoque de medicamentos por paciente |
| `appointments` | Consultas médicas |
| `health_measurements` | Aferições brutas (sem interpretação clínica) |
| `notifications` | Notificações enviadas (todos os tipos) |
| `push_subscriptions` | Assinaturas WebPush por dispositivo |
| `subscriptions` | Assinatura ativa por família |
| `subscription_plans` | Catálogo de planos (preço, limites) |
| `audit_log` | Log imutável — trigger no banco bloqueia UPDATE/DELETE |
