# CONTEXT — Fase 03: Paciente e Cuidadores

> Artefato GSD. Saída da etapa Discuss.
> **Data:** 16/08/2026

---

## Ponto de partida

Schema já existe (`patients`, `caregivers`, `caregiver_invites`), herdado das fases anteriores. A Fase 02 já criou o primeiro cuidador (papel `primary_caregiver`) no cadastro. Esta fase constrói: cadastro de paciente de verdade, a matriz completa de 4 papéis × 5 capacidades, convite por link, e gestão/revogação de cuidador por paciente.

## Escopo — REQ-007 a REQ-010 / ZELO-12 a ZELO-15

1. Cadastro de paciente (nome, nascimento, foto, fuso horário obrigatório) + seletor de paciente ativo
2. Matriz de papéis e autorização por recurso, **por paciente**, não por família
3. Convite de cuidador por link expirável de uso único
4. Gestão de cuidadores e revogação com efeito imediato — reaproveita a blacklist de sessão já construída na Fase 02

## Correção trazida da auditoria da Fase 02

O consentimento de dado de saúde hoje só existe a nível de conta (capturado uma vez no cadastro). A spec exige consentimento **por paciente**, porque cada paciente pode ter um titular diferente (o próprio idoso, ou um representante legal) e famílias podem cadastrar mais de um paciente ao longo do tempo. Esta fase adiciona um registro de consentimento específico por paciente, sem remover o consentimento geral da conta que já existe.

## Decisão de execução

Mesmo padrão das fases anteriores: um prompt de atualização em linguagem natural cobrindo as 4 histórias, seguido de auditoria com evidência literal via `ask_question` antes de avançar.
