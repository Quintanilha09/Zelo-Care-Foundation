---
name: ZELO — Estado da fundação
description: Tabelas criadas, contagem de testes, proteções ativas e scripts disponíveis ao fim da fase de fundação
---

## Tabelas no PostgreSQL (21 total)

Fase original: families, patients, caregivers, medications, treatments, scheduled_doses, dose_records, stock_entries, appointments, health_measurements, notifications, audit_log, subscriptions

Adicionadas nesta fase: users, sessions, refresh_tokens, consent_records, caregiver_invites, subscription_plans, push_subscriptions, alert_escalations

## Proteções ativas no banco

- `UNIQUE(treatment_id, scheduled_at)` em `scheduled_doses` — bloqueia dose duplicada
- `UNIQUE(scheduled_dose_id)` em `dose_records` — bloqueia registro duplo
- Trigger `audit_log_immutable` BEFORE UPDATE OR DELETE em `audit_log` — lança EXCEPTION com mensagem "append-only: UPDATE e DELETE são proibidos"

## Contagem de testes (test:all)

41 testes, 0 falhas. Arquivos:
- clock.test.ts (9 testes)
- safe-logger.test.ts (12 testes)
- integrity.test.ts (5 testes — banco real, usa tsx)
- audit-immutability.test.ts (4 testes — banco real, usa tsx)
- dev-clock-routes.test.ts (8 testes — HTTP real em porta aleatória)
- seed-idempotency.test.ts (3 testes — banco real, usa tsx)

## Scripts disponíveis (@workspace/api-server)

- `pnpm run test` — unit (clock + safe-logger) via --experimental-strip-types
- `pnpm run test:all` — todos (incluindo banco real) via tsx
- `pnpm run seed` — seed idempotente via tsx
- `pnpm run lint:clock` — verifica new Date() / Date.now() sem argumentos em arquivos de domínio

## tsconfig do api-server

Tem `noEmit: true` e `allowImportingTsExtensions: true` — obrigatório para os testes que importam `.ts` via tsx.
O build usa esbuild (build.mjs), não tsc — noEmit não afeta o build.

**Why:** tsx aceita `.ts` extensions em imports; tsc sem allowImportingTsExtensions rejeita. A combinação noEmit+allowImportingTsExtensions resolve sem quebrar o build esbuild.

## Seed — chave de idempotência

Slug da família de demonstração: `"familia-ficticia-teste"` (coluna `slug` em families, UNIQUE).
Segunda execução detecta o slug e encerra sem inserir nada.
Para re-sedar: DELETE FROM families WHERE slug = 'familia-ficticia-teste' CASCADE.

## Documentação criada

- `FOUNDATION.md` — produto em 3 linhas, stack, mapa de módulos, 4 invariantes, regra de tom
- `PLATFORM_DECISIONS.md` — 4 decisões com alternativas descartadas (PWA, fila no banco, IA visão, cobrança web)
