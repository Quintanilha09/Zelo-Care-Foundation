---
name: ZELO — Estado da fundação (tabelas e testes)
description: Schema, contagem de testes e invariantes críticas do banco
---

## Schema atual
- 21+ tabelas (incl. `patient_caregivers` adicionada na Fase 3)
- `patient_caregivers`: `(patientId, caregiverId, role)` UNIQUE pair — papel por paciente verificado no DB a cada requisição
- `caregivers.selectedPatientId` — persiste o paciente selecionado entre sessões
- `consent_records.patientId` (FK nullable, onDelete: set null) + `representativeType`
- `caregiver_invites.patientId` (FK nullable, onDelete: cascade)

## Testes
- **144 testes passando, 0 falhas** (após Fase 3)
- `test:all` em `artifacts/api-server/package.json` inclui `patient-role-matrix.test.ts`
- `--test-concurrency=1` obrigatório (isolamento entre testes de integração)

## Invariantes críticas
- Trigger de imutabilidade em `audit_logs`
- Lint de relógio: proibido usar `Date.now()` / `new Date()` diretamente — usar `Clock.now()`
- `before` hooks idempotentes (limpeza antes de inserir)
- Schema FK `set-null` não pode ser `notNull`

**Why:** Concorrência de testes corromperia dados; o Clock garante determinismo nos testes de JWT.
